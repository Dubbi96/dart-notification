// 신호 보정 루프 리포트 도메인 타입 계약 — DAR-92(화면) / DAR-83·DAR-91(백엔드).
// GET /api/backtest/calibration 응답과 1:1.
// 백엔드 engine3-quant-market/backtest/calibration.ts (CalibrationReport) 와 동기화.
//
// ★ 읽기 전용 권고 리포트 — 화면은 권장 delta·보정계수를 "표시만" 한다.
//   상수(EVENT_BASE_SCORES) 변경은 코드가 아닌 사람의 PR 로만 이뤄진다(자동반영 금지).

/** 보정 진단 지평(D+5 또는 D+20) */
export type CalibrationHorizon = 'd5' | 'd20';

/**
 * 버킷 보정 판정:
 * - CALIBRATE: 표본 충분·유의·괴리 큼 → 권장 delta 제시(사람 검토용).
 * - ALIGNED:   표본 충분·유의하나 괴리 작음 → 이미 정렬, delta 0.
 * - HOLD:      lowSample/통계 미유의/실현표본 0/미등재 → 보정 보류(과신 방지).
 */
export type CalibrationStatus = 'CALIBRATE' | 'ALIGNED' | 'HOLD';

/** EVENT_BASE_SCORES 한 항목의 보정 진단(diff 형 권고) */
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
  /** 사람용 근거 */
  reason: string;
}

/** 등급별 confidence 보정 진단(승률 기반 디스카운트 계수, DAR-91) */
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
  /** 사람용 근거 */
  reason: string;
}

/** 점수 구간 방향 일관성 진단(진단 전용 — delta 제안 없음) */
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

/** 신호 보정 루프 리포트 전체 */
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
  /** 등급별 confidence 보정계수 진단(DAR-91) — D+20 */
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
