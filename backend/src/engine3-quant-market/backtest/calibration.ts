/**
 * calibration.ts — 신호 보정 루프 리포트: 순수함수 (M9 백테스트, DAR-83)
 *
 * ★Main Thesis B(수익 직결). 백테스트 실현 초과수익(signal-accuracy 의 byEventType /
 *   byScoreBand 집계)을 신호 점수 개선으로 잇는 폐루프의 "진단 절반". 현재는 측정만 되고
 *   환류되지 않는다 — 이 모듈은 EVENT_BASE_SCORES(정적 상수) 대비 실측 기반 **괴리(gap)** 와
 *   **권장 조정량(suggested delta)** 을 산출해 사람이 PR 로 검토할 diff 형 리포트를 만든다.
 *
 * ★★ 자동 적용 절대 금지 — 이 모듈은 EVENT_BASE_SCORES 를 **읽기 전용**으로만 참조한다.
 *    상수 객체를 수정/재할당하는 코드는 존재하지 않으며, 산출물은 "권고값"일 뿐이다.
 *    실제 상수 변경은 오직 사람의 PR 로만 이루어진다(코드가 상수를 자동 수정하는 경로 0).
 *
 * ★ read-only 산술/매핑만 — 신규 수집·외부호출·AI 개입 0. service 가 산출한
 *   SignalAccuracyReport 를 입력으로 받아 통계를 권고값으로 변환한다.
 *   lowSample/통계 미유의 버킷은 'HOLD'(보정 보류) 로 표기하여 과신을 방지한다.
 */

import { EVENT_BASE_SCORES } from '../buy-signal/config/buy-signal.config';
import {
  SignalAccuracyReport,
  AccuracyBucket,
  HorizonAccuracy,
  LOW_SAMPLE_THRESHOLD,
} from './signal-accuracy';

/**
 * 실현 초과수익(%) → base score 스케일(-100..100) 환산 계수.
 * 투명한 선형 가정: 누적 초과수익 SCORE_FULL_SCALE_AR_PCT(%) 를 |score| 100 으로 본다.
 * (예: D+20 +5% 초과수익 ⇒ impliedScore 50). 이 가정 자체가 사람 검토 대상이다.
 */
export const SCORE_FULL_SCALE_AR_PCT = 10;
export const SCORE_PER_AR_PCT = 100 / SCORE_FULL_SCALE_AR_PCT; // 10

/**
 * suggested delta 보수적 감쇠 계수(단일 백테스트 창의 과적합/노이즈에 과민반응 방지).
 * 권장 조정은 측정된 gap 의 절반만 제안한다 — 폐루프가 한 번에 과교정하지 않도록.
 */
export const CALIBRATION_DAMPENING = 0.5;

/**
 * 보정 권장 최소 임계. |gap| 이 이 값 미만이면 이미 충분히 정렬된 것으로 보고
 * delta 0(ALIGNED)으로 표기한다(미세 조정 잡음 억제).
 */
export const CALIBRATION_GAP_EPSILON = 5;

/** 보정 진단에 사용하는 기본 지평 — 더 긴 신호(D+20) 우선. */
export type CalibrationHorizon = 'd5' | 'd20';

/**
 * 버킷별 보정 판정:
 * - CALIBRATE: 표본 충분·유의·괴리 큼 → 권장 delta 제시(사람 검토용).
 * - ALIGNED:   표본 충분·유의하나 괴리 작음 → 이미 정렬, delta 0.
 * - HOLD:      lowSample/통계 미유의/실현표본 0/미등재 → 보정 보류(과신 방지).
 */
export type CalibrationStatus = 'CALIBRATE' | 'ALIGNED' | 'HOLD';

/** EVENT_BASE_SCORES 한 항목에 대한 보정 진단(diff 형 권고, 자동적용 금지) */
export interface EventScoreCalibration {
  eventType: string;
  /** 현재 상수값 EVENT_BASE_SCORES[eventType]. 미등재면 null. */
  currentBaseScore: number | null;
  horizon: CalibrationHorizon;
  /** 해당 지평 실현표본 수 */
  sampleCount: number;
  lowSample: boolean;
  /** t-검정 유의(p<0.05) 여부 */
  significant: boolean;
  /** 평균 실현 초과수익(%). 표본 0이면 null. ★이상치 오염 가능(투명성·참고용) */
  avgExcessReturn: number | null;
  /**
   * ★강건 실현 초과수익(%) — median(DAR-410). 표본 0이면 null.
   * impliedScore·gap·delta 산출의 ★기본 입력. 산술평균(avgExcessReturn)이 소수 극단치에
   * 오염돼 위험 이벤트(DELISTING_RISK/TRADING_SUSPENSION)에 거짓 양(+) 권고를 내는 것을 차단.
   */
  robustExcessReturn: number | null;
  /** 강건 실현수익 환산 점수(-100..100) — robustExcessReturn 기반. 표본 0이면 null */
  impliedScore: number | null;
  /** 괴리 = impliedScore - currentBaseScore. 산출불가 null */
  gap: number | null;
  /** 권장 조정량(감쇠·정수 반올림·clamp 반영). HOLD/ALIGNED 면 0 */
  suggestedDelta: number;
  /** 권장 신규 상수값 = clamp(current + delta, -100, 100). 산출불가 null */
  suggestedNewScore: number | null;
  status: CalibrationStatus;
  /** 사람용 근거(HOLD 사유·표본·유의성 등) */
  reason: string;
}

/**
 * 점수 구간(byScoreBand) 방향성 일관성 진단(진단 전용 — delta 제안 없음).
 * 상수가 아닌 임계값(SIGNAL_GRADE_THRESHOLDS)에 묶인 구간이라 단일 상수 보정 대상이 아니다.
 * 대신 "고점수 구간이 실제로 양(+) 초과수익을 내는가"의 방향 일관성만 표기한다.
 */
export interface ScoreBandConsistency {
  band: string;
  horizon: CalibrationHorizon;
  sampleCount: number;
  lowSample: boolean;
  significant: boolean;
  avgExcessReturn: number | null;
  /** 구간이 기대하는 방향(+1 상승기대 / -1 하락기대) */
  expectedDirection: 1 | -1;
  /** 실현 방향이 기대와 일치하는가. 산출불가/HOLD 시 null */
  directionConsistent: boolean | null;
  status: CalibrationStatus;
  reason: string;
}

/** 전체 보정 루프 리포트(읽기 전용 권고 — 코드가 상수를 자동 변경하지 않음) */
export interface CalibrationReport {
  /** 입력 신호 풀 요약 */
  source: {
    totalSignals: number;
    realizedD5: number;
    realizedD20: number;
  };
  /** EVENT_BASE_SCORES 보정 진단 — D+5 지평 */
  eventScoreCalibrationsD5: EventScoreCalibration[];
  /** EVENT_BASE_SCORES 보정 진단 — D+20 지평(기본 권장 축) */
  eventScoreCalibrationsD20: EventScoreCalibration[];
  /** byScoreBand 방향 일관성 진단(진단 전용) — D+20 */
  scoreBandConsistencyD20: ScoreBandConsistency[];
  /**
   * 등급별 confidence 보정계수 진단 (DAR-91) — D+20.
   * 백테스트 실현 승률이 등급 기대 미만(과대평가 등급)이면 디스카운트 계수(<1)를 산출해
   * signal-generation 이 라이브 신호의 calibratedConfidence 로 환류한다.
   * ★ 점수/confidence 한정 — 실주문·임계값과 무관. 계수 1.0 = 무보정.
   */
  gradeConfidenceCalibrationsD20: GradeConfidenceCalibration[];
  /** 사용한 환산 가정(투명성) */
  assumptions: {
    scoreFullScaleArPct: number;
    scorePerArPct: number;
    dampening: number;
    gapEpsilon: number;
    lowSampleThreshold: number;
  };
  /** ★ 자동적용 금지 고지(사람 PR 전용) */
  disclaimer: string;
}

const NO_AUTO_APPLY_DISCLAIMER =
  '이 리포트는 읽기 전용 권고입니다. EVENT_BASE_SCORES 등 상수는 코드가 자동으로 변경하지 않으며, ' +
  '사람이 본 diff 를 검토해 PR 로만 반영합니다. suggested delta 는 단일 백테스트 창 기반 권고값일 뿐입니다.';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 실현 초과수익(%) → base score 스케일(-100..100) 환산. null 보존, 정수 반올림. */
export function impliedScoreFromReturn(avgExcessReturn: number | null): number | null {
  if (avgExcessReturn === null) return null;
  return clamp(Math.round(avgExcessReturn * SCORE_PER_AR_PCT), -100, 100);
}

/** HorizonAccuracy 선택기 */
function pickHorizon(bucket: AccuracyBucket, horizon: CalibrationHorizon): HorizonAccuracy {
  return horizon === 'd5' ? bucket.d5 : bucket.d20;
}

/**
 * 단일 eventType 버킷 × 지평 → 보정 진단.
 * ★ EVENT_BASE_SCORES 는 읽기만 한다(인덱스 조회). 어떤 경우에도 수정하지 않는다.
 */
export function calibrateEventScore(
  bucket: AccuracyBucket,
  horizon: CalibrationHorizon,
): EventScoreCalibration {
  const eventType = bucket.key;
  const h = pickHorizon(bucket, horizon);
  const hasBase = Object.prototype.hasOwnProperty.call(EVENT_BASE_SCORES, eventType);
  const currentBaseScore = hasBase ? EVENT_BASE_SCORES[eventType] : null;

  const base: Omit<EventScoreCalibration, 'status' | 'reason'> = {
    eventType,
    currentBaseScore,
    horizon,
    sampleCount: h.sampleCount,
    lowSample: h.sampleCount < LOW_SAMPLE_THRESHOLD,
    significant: h.isSignificant,
    avgExcessReturn: h.avgExcessReturn,
    robustExcessReturn: h.robustExcessReturn,
    // ★impliedScore 는 강건(robust) 초과수익 기반 — 이상치 오염 차단(DAR-410)
    impliedScore: impliedScoreFromReturn(h.robustExcessReturn),
    gap: null,
    suggestedDelta: 0,
    suggestedNewScore: currentBaseScore,
  };

  // HOLD 사유 우선순위: 데이터 없음 → 미등재 → lowSample → 미유의
  if (h.sampleCount === 0) {
    return { ...base, status: 'HOLD', reason: '실현표본 없음 — 보정 보류' };
  }
  if (!hasBase) {
    return {
      ...base,
      status: 'HOLD',
      reason: `미등재 이벤트(EVENT_BASE_SCORES 기준값 없음) — 보정 보류, impliedScore 참고만`,
    };
  }
  if (base.lowSample) {
    return {
      ...base,
      status: 'HOLD',
      reason: `표본 부족(n=${h.sampleCount}<${LOW_SAMPLE_THRESHOLD}) — 보정 보류(과신 방지)`,
    };
  }
  if (!h.isSignificant) {
    return {
      ...base,
      status: 'HOLD',
      reason: `통계 미유의(p≥0.05, n=${h.sampleCount}) — 보정 보류(과신 방지)`,
    };
  }

  // 표본 충분·유의 → gap·delta 산출
  const cur = currentBaseScore as number;
  const implied = base.impliedScore as number;
  const gap = implied - cur;

  if (Math.abs(gap) < CALIBRATION_GAP_EPSILON) {
    return {
      ...base,
      gap,
      suggestedDelta: 0,
      suggestedNewScore: cur,
      status: 'ALIGNED',
      reason: `정렬됨(|gap|=${Math.abs(gap)}<${CALIBRATION_GAP_EPSILON}) — 조정 불필요`,
    };
  }

  // 감쇠 적용 후 정수 반올림 → clamp → 실효 delta(불변식 new = current + delta 보장)
  const rawDelta = Math.round(gap * CALIBRATION_DAMPENING);
  const newScore = clamp(cur + rawDelta, -100, 100);
  const effectiveDelta = newScore - cur;

  return {
    ...base,
    gap,
    suggestedDelta: effectiveDelta,
    suggestedNewScore: newScore,
    status: effectiveDelta === 0 ? 'ALIGNED' : 'CALIBRATE',
    reason:
      effectiveDelta === 0
        ? '권장 delta 가 0(반올림/clamp 흡수) — 조정 불필요'
        : `실측 implied=${implied} vs 현재 base=${cur} (gap=${gap}); 감쇠 후 권장 Δ=${effectiveDelta} → ${newScore} [사람 PR 검토 필요]`,
  };
}

/** 점수 구간 라벨 → 기대 방향(+1/-1). signal-accuracy.scoreBandOf 라벨 규약과 일치. */
function expectedDirectionOfBand(band: string): 1 | -1 {
  return band === '<0' ? -1 : 1;
}

/** 단일 byScoreBand 버킷 × 지평 → 방향 일관성 진단(진단 전용) */
export function checkScoreBandConsistency(
  bucket: AccuracyBucket,
  horizon: CalibrationHorizon,
): ScoreBandConsistency {
  const h = pickHorizon(bucket, horizon);
  const expectedDirection = expectedDirectionOfBand(bucket.key);
  const lowSample = h.sampleCount < LOW_SAMPLE_THRESHOLD;

  const base: Omit<ScoreBandConsistency, 'status' | 'reason' | 'directionConsistent'> = {
    band: bucket.key,
    horizon,
    sampleCount: h.sampleCount,
    lowSample,
    significant: h.isSignificant,
    avgExcessReturn: h.avgExcessReturn,
    expectedDirection,
  };

  if (h.sampleCount === 0) {
    return { ...base, directionConsistent: null, status: 'HOLD', reason: '실현표본 없음 — 보류' };
  }
  if (lowSample) {
    return {
      ...base,
      directionConsistent: null,
      status: 'HOLD',
      reason: `표본 부족(n=${h.sampleCount}<${LOW_SAMPLE_THRESHOLD}) — 보류(과신 방지)`,
    };
  }
  if (!h.isSignificant) {
    return {
      ...base,
      directionConsistent: null,
      status: 'HOLD',
      reason: `통계 미유의(p≥0.05) — 보류(과신 방지)`,
    };
  }

  const avg = h.avgExcessReturn as number;
  const realizedDir = avg > 0 ? 1 : -1;
  const consistent = realizedDir === expectedDirection;
  return {
    ...base,
    directionConsistent: consistent,
    status: consistent ? 'ALIGNED' : 'CALIBRATE',
    reason: consistent
      ? `방향 일관(기대 ${expectedDirection > 0 ? '+' : '-'}, 실현 ${avg}%)`
      : `방향 불일치(기대 ${expectedDirection > 0 ? '+' : '-'}, 실현 ${avg}%) — 구간 임계/가중치 사람 검토 권장`,
  };
}

/**
 * SignalAccuracyReport → 보정 루프 리포트.
 * ★ read-only — 상수를 변경하지 않는다. 사람의 PR 검토용 diff 자료를 만들 뿐.
 */
export function buildCalibrationReport(report: SignalAccuracyReport): CalibrationReport {
  return {
    source: {
      totalSignals: report.totalSignals,
      realizedD5: report.realizedD5,
      realizedD20: report.realizedD20,
    },
    eventScoreCalibrationsD5: report.byEventType.map((b) => calibrateEventScore(b, 'd5')),
    eventScoreCalibrationsD20: report.byEventType.map((b) => calibrateEventScore(b, 'd20')),
    scoreBandConsistencyD20: report.byScoreBand.map((b) => checkScoreBandConsistency(b, 'd20')),
    gradeConfidenceCalibrationsD20: report.byGrade.map((b) => calibrateGradeConfidence(b, 'd20')),
    assumptions: {
      scoreFullScaleArPct: SCORE_FULL_SCALE_AR_PCT,
      scorePerArPct: SCORE_PER_AR_PCT,
      dampening: CALIBRATION_DAMPENING,
      gapEpsilon: CALIBRATION_GAP_EPSILON,
      lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
    },
    disclaimer: NO_AUTO_APPLY_DISCLAIMER,
  };
}

// =====================================================================
// DAR-91 — 등급별 confidence 자기보정 계수 (calibration → 라이브 신호 환류)
//
// ★Main Thesis B(신호품질 직결). 위 EVENT_BASE_SCORES 진단은 "사람 PR 검토용 diff"에
//   머물렀다. 여기서는 백테스트가 드러낸 **등급별 실현 적중률 괴리**를 곧바로 라이브 신호의
//   confidence 디스카운트로 환류한다(폐루프의 "환류 절반").
//
// ★★ 안전3원칙 불가침:
//   - 보정은 **점수/confidence(calibratedConfidence)에 한정** — 실주문·자동승인과 무연결.
//   - 원본 buyScore·signal 등급·임계값(80/60/30)은 **불변**. 계수는 별도 필드로만 환류.
//   - 표본 부족/미유의/비매수 등급은 계수 1.0(무보정) — 단일 백테스트 창 과교정 방지.
// =====================================================================

/**
 * 등급별 기대 적중률(승률) prior — ★사람 검토 대상 투명 가정.
 * 매수 추천 등급일수록 더 높은 적중을 기대한다(상위등급 단조). 여기 없는 등급
 * (NEUTRAL/AVOID/BLOCKED 등 비매수 등급)은 confidence 디스카운트 대상이 아니다(계수 1.0).
 * 백테스트 실현 승률이 이 기대 미만이면 "과대평가 등급"으로 보고 confidence 를 디스카운트한다.
 */
export const EXPECTED_WIN_RATE_BY_GRADE: Readonly<Record<string, number>> = {
  STRONG_BUY_CANDIDATE: 0.55,
  BUY_CANDIDATE: 0.5,
  WATCH: 0.45,
};

/**
 * 보정계수 하한(과교정 방지). 단일 백테스트 창의 부진을 이유로 confidence 를 0 으로
 * 만들지 않는다. 최종 계수는 [CONFIDENCE_COEFFICIENT_FLOOR, 1.0] 으로 clamp 한다.
 */
export const CONFIDENCE_COEFFICIENT_FLOOR = 0.5;

/** 무보정 계수(폴백·정렬·비매수 등급). 명시 상수로 의미 고정. */
export const NO_DISCOUNT_COEFFICIENT = 1.0;

/**
 * 단일 등급의 confidence 보정 진단(승률 기반 디스카운트, 점수/confidence 한정).
 * ★ buyScore 원값은 건드리지 않는다 — coefficient 는 calibratedConfidence 산출 입력일 뿐.
 */
export interface GradeConfidenceCalibration {
  /** SignalGrade 값(STRONG_BUY_CANDIDATE 등) */
  grade: string;
  horizon: CalibrationHorizon;
  /** 해당 지평 실현표본 수 */
  sampleCount: number;
  lowSample: boolean;
  /** t-검정 유의(p<0.05) 여부 */
  significant: boolean;
  /** 실현 승률(초과수익>0 비율, 0~1). 표본 0이면 null */
  winRate: number | null;
  /** 등급별 기대 승률 prior. 비매수/미등재 등급이면 null */
  expectedWinRate: number | null;
  /** confidence 보정계수(1.0=무보정, <1=디스카운트). [FLOOR,1] */
  coefficient: number;
  status: CalibrationStatus;
  /** 사람용 근거(HOLD/ALIGNED/CALIBRATE 사유) */
  reason: string;
}

/** 계수 소수 3자리 반올림(결정론·표시 안정성). */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * 단일 등급 버킷 × 지평 → confidence 보정 진단.
 * - 비매수/미등재 등급, 실현표본 0, lowSample, 통계 미유의 → 계수 1.0(무보정·과신 방지).
 * - 표본 충분·유의 & 실현 승률 ≥ 기대 → 계수 1.0(디스카운트 없음, 증폭하지 않음).
 * - 표본 충분·유의 & 실현 승률 < 기대(과대평가) → 비율 기반 감쇠 계수(<1) 디스카운트.
 */
export function calibrateGradeConfidence(
  bucket: AccuracyBucket,
  horizon: CalibrationHorizon,
): GradeConfidenceCalibration {
  const grade = bucket.key;
  const h = pickHorizon(bucket, horizon);
  const expectedWinRate = Object.prototype.hasOwnProperty.call(
    EXPECTED_WIN_RATE_BY_GRADE,
    grade,
  )
    ? EXPECTED_WIN_RATE_BY_GRADE[grade]
    : null;
  const lowSample = h.sampleCount < LOW_SAMPLE_THRESHOLD;

  const base: Omit<GradeConfidenceCalibration, 'status' | 'reason' | 'coefficient'> = {
    grade,
    horizon,
    sampleCount: h.sampleCount,
    lowSample,
    significant: h.isSignificant,
    winRate: h.winRate,
    expectedWinRate,
  };

  // 비매수/미등재 등급 → confidence 디스카운트 대상 아님(계수 1.0)
  if (expectedWinRate === null) {
    return {
      ...base,
      coefficient: NO_DISCOUNT_COEFFICIENT,
      status: 'HOLD',
      reason: '비매수 등급(또는 미등재) — confidence 보정 대상 아님(계수 1.0)',
    };
  }
  // 과신 방지 폴백: 데이터 없음 → lowSample → 미유의
  if (h.sampleCount === 0 || h.winRate === null) {
    return {
      ...base,
      coefficient: NO_DISCOUNT_COEFFICIENT,
      status: 'HOLD',
      reason: '실현표본 없음 — 무보정(계수 1.0)',
    };
  }
  if (lowSample) {
    return {
      ...base,
      coefficient: NO_DISCOUNT_COEFFICIENT,
      status: 'HOLD',
      reason: `표본 부족(n=${h.sampleCount}<${LOW_SAMPLE_THRESHOLD}) — 무보정(과신 방지)`,
    };
  }
  if (!h.isSignificant) {
    return {
      ...base,
      coefficient: NO_DISCOUNT_COEFFICIENT,
      status: 'HOLD',
      reason: `통계 미유의(p≥0.05, n=${h.sampleCount}) — 무보정(과신 방지)`,
    };
  }

  const w = h.winRate;
  // 기대 충족/초과 → 디스카운트 없음(증폭 금지, 보수적)
  if (w >= expectedWinRate) {
    return {
      ...base,
      coefficient: NO_DISCOUNT_COEFFICIENT,
      status: 'ALIGNED',
      reason: `실현 승률(${w}) ≥ 기대(${expectedWinRate}) — 디스카운트 없음(계수 1.0)`,
    };
  }

  // 과대평가 등급 → 비율 기반 감쇠 디스카운트 + 하한 clamp
  const ratio = w / expectedWinRate; // <1
  const damped = 1 - CALIBRATION_DAMPENING * (1 - ratio);
  const coefficient = round3(clamp(damped, CONFIDENCE_COEFFICIENT_FLOOR, NO_DISCOUNT_COEFFICIENT));
  return {
    ...base,
    coefficient,
    status: 'CALIBRATE',
    reason:
      `과대평가 등급(실현 승률 ${w} < 기대 ${expectedWinRate}) — ` +
      `감쇠(${CALIBRATION_DAMPENING}) 후 confidence 계수 ${coefficient} 디스카운트 [점수 한정·실주문 무관]`,
  };
}

/**
 * 등급별 보정계수 맵(grade → coefficient). HOLD/ALIGNED(계수 1.0) 도 포함한다.
 * signal-generation 이 result.signal 로 조회해 calibratedConfidence 를 산출한다.
 */
export function gradeCoefficientMap(
  calibrations: GradeConfidenceCalibration[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of calibrations) m.set(c.grade, c.coefficient);
  return m;
}

/**
 * buyScore × 등급 보정계수 → calibratedConfidence(정수, clamp -100..100).
 * ★ 원본 buyScore 는 호출측에서 보존한다 — 이 함수는 별도 필드값만 만든다.
 * 계수 결측/미보정은 호출측에서 NO_DISCOUNT_COEFFICIENT(1.0)로 전달(무보정).
 */
export function applyConfidenceCoefficient(buyScore: number, coefficient: number): number {
  return clamp(Math.round(buyScore * coefficient), -100, 100);
}
