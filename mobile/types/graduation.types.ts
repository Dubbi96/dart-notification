// 졸업 게이트 측정 도메인 타입 계약 — DAR-67 / DAR-68.
// GET /api/graduation/metrics 응답과 1:1.
// 백엔드 simulation/domain/graduation-gates.ts (GraduationReport/GraduationGate) 와 동기화.
// DAR-68: 위험조정(G6 MDD)·벤치마크(G7 KOSPI alpha) 게이트 + Sharpe 참고지표 추가.

export type GateId = 'G1' | 'G2' | 'G3' | 'G5' | 'G6' | 'G7';
export type GateComparator = 'gte' | 'gt' | 'lte';
export type GateUnit = 'percent' | 'ratio';

/** 졸업 게이트 1개 — 현재값 vs 기준 · 통과여부 · 표본수 */
export interface GraduationGate {
  id: GateId;
  /** 사람이 읽는 지표명 */
  label: string;
  /** 현재 측정값(percent: 0~100, ratio: 배수). 표본 부족·측정 불가면 null */
  currentValue: number | null;
  /** 통과 기준치 */
  threshold: number;
  comparator: GateComparator;
  unit: GateUnit;
  /** 통과 여부 — 표본 부족·측정 불가면 null(정직 표기) */
  pass: boolean | null;
  /** 표본수(표본 기반 게이트만, 그 외 null) */
  sampleSize: number | null;
  /** 표본 부족 경고 */
  lowSample: boolean;
  /** 측정 가능 여부(G3: 순익 ≤ 0이면 측정 불가) */
  measurable: boolean;
}

/** 졸업 측정 리포트 */
export interface GraduationReport {
  portfolioId: string;
  /** 산출 시각(ISO) */
  asOf: string;
  gates: GraduationGate[];
  /** 통과 게이트 수 */
  passedCount: number;
  /** 전체 게이트 수 */
  totalGates: number;
  /** 전부 통과(졸업 도달) 여부 */
  allPassed: boolean;
  /** 졸업 진척률(0~1) */
  progress: number;
  /** 표본 부족 게이트가 하나라도 있으면 true(과신 경고) */
  lowSample: boolean;
  /**
   * Sharpe 비율(연환산, 무위험수익률 0) — DAR-68 참고지표(통과/미달 게이트 아님).
   * 측정 불가(평가액 표본 부족)면 null.
   */
  sharpe: number | null;
}

// 신호→진입 퍼널 도메인 타입 계약 — DAR-162 / DAR-109.
// GET /api/graduation/funnel 응답과 1:1.
// 백엔드 simulation/domain/signal-funnel.ts (FunnelReport/FunnelDayReport/FunnelTotals) 와 동기화.
// '당일 생성 신호 → 진입 후보 통과 → 실제 체결'의 일별/누적 전환율. 분모 0이면 rate=null(가짜 비율 금지).

/** 일별 퍼널 + 파생 전환율 */
export interface FunnelDayReport {
  /** 거래일 YYYYMMDD */
  tradeDate: string;
  /** 당일 생성 신호 수 */
  signalsGenerated: number;
  /** 진입 후보 통과 수 */
  candidatesPassed: number;
  /** 실제 체결 수 */
  filled: number;
  /** 채택률 = 후보 통과 / 생성 신호 (0~1, 신호 0이면 null) */
  adoptionRate: number | null;
  /** 체결률 = 체결 / 후보 통과 (0~1, 후보 0이면 null) */
  fillRate: number | null;
  /** 신호→체결 전환율 = 체결 / 생성 신호 (0~1, 신호 0이면 null) */
  conversionRate: number | null;
}

/** 누적 퍼널(전 기간 합산) + 전환율 + 운용일수 */
export interface FunnelTotals {
  days: number;
  signalsGenerated: number;
  candidatesPassed: number;
  filled: number;
  adoptionRate: number | null;
  fillRate: number | null;
  conversionRate: number | null;
}

/** 신호→진입 퍼널 리포트 */
export interface FunnelReport {
  /** 거래일 오름차순 일별 퍼널 */
  daily: FunnelDayReport[];
  /** 전 기간 누적 */
  totals: FunnelTotals;
}
