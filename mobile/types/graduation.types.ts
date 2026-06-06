// 졸업 게이트 측정 도메인 타입 계약 — DAR-67.
// GET /api/graduation/metrics 응답과 1:1.
// 백엔드 simulation/domain/graduation-gates.ts (GraduationReport/GraduationGate) 와 동기화.

export type GateId = 'G1' | 'G2' | 'G3' | 'G5';
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
}
