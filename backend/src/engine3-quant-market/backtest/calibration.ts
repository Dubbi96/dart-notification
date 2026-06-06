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
  /** 평균 실현 초과수익(%). 표본 0이면 null */
  avgExcessReturn: number | null;
  /** 실현수익 환산 점수(-100..100). 표본 0이면 null */
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
    impliedScore: impliedScoreFromReturn(h.avgExcessReturn),
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
