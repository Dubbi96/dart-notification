// Persona 철학 엔진(P-A 철학·P-B 적합도) 모바일 타입 (DAR-54)
// 백엔드 응답 계약을 1:1 반영한다 — engine2-ai-analyst/philosophy.
// 게스트 열람 가능(OptionalJwtAuthGuard). 모두 읽기 전용.

export type PhilosophyMetricOperator = 'GT' | 'LT' | 'EQ' | 'RANGE';

export type PhilosophySourceType =
  | 'BOOK'
  | 'SHAREHOLDER_LETTER'
  | 'INTERVIEW'
  | 'PUBLIC_STATEMENT';

export interface PhilosophyMetricView {
  metricKey: string;
  operator: PhilosophyMetricOperator;
  threshold: number;
  thresholdMax: number | null;
  weight: number;
  description: string;
}

export interface PhilosophySourceView {
  type: PhilosophySourceType;
  title: string;
  year: number;
  url: string | null;
}

/** 철학 1종(P-A 시드 — 원칙·체크리스트·지표·출처) */
export interface Philosophy {
  philosophyId: string;
  investorName: string;
  styleTags: string[];
  corePrinciples: string[];
  applicableAssets: string[];
  checklistItems: string[];
  riskProfile: string;
  scoreFormula: string | null;
  metrics: PhilosophyMetricView[];
  sources: PhilosophySourceView[];
}

/** 단일 지표 평가(통과/미달 근거 분해 단위) */
export interface MetricEvaluation {
  metricKey: string;
  operator: PhilosophyMetricOperator;
  threshold: number;
  thresholdMax: number | null;
  weight: number;
  description: string;
  /** 재무에서 해석한 실제 값(결측 시 null) */
  value: number | null;
  /** 평가 가능(값 존재) 여부 */
  available: boolean;
  /** 기준 통과 여부(결측이면 null) */
  passed: boolean | null;
  /** 0~1 달성도(결측이면 null) */
  achievement: number | null;
}

/** 종목 × 철학 1종 적합도 결과 */
export interface PhilosophyFitScore {
  philosophyId: string;
  investorName: string;
  /** 가용 지표 1개 이상이면 true. false면 score=null(재무만으로 평가 불가) */
  computable: boolean;
  /** 적합도 0~100. computable=false면 null */
  score: number | null;
  totalMetrics: number;
  evaluatedCount: number;
  omittedMetricKeys: string[];
  passedMetricKeys: string[];
  failedMetricKeys: string[];
  breakdown: MetricEvaluation[];
}

/** 적합도 산정에 사용한 재무 스냅샷 메타 */
export interface FinancialBasis {
  bsnsYear: string;
  reprtCode: string;
  fsDiv: string;
}

/** 종목 × 전체 철학 적합도(거장별 적합도) */
export interface CompanyPhilosophyFit {
  corpCode: string;
  financialBasis: FinancialBasis | null;
  /** 재무 결측으로 평가 불가하면 true(fits 빈 배열) */
  noFinancials: boolean;
  /** 철학별 적합도(점수 내림차순; computable=false는 후순위) */
  fits: PhilosophyFitScore[];
}

/** 철학 1종 × 종목 1건 적합도 응답 */
export interface PhilosophyFitResult {
  philosophyId: string;
  corpCode: string;
  financialBasis: FinancialBasis | null;
  noFinancials: boolean;
  fit: PhilosophyFitScore | null;
}
