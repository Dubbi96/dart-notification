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

// ─── P-C 결합(거장 철학 × AI 관점) — DAR-72 백엔드 계약 1:1 반영 (DAR-82) ───
// 신규 AI 호출 0: 저장된 personaViews + 철학 적합도(Rule)만 결합한다.

/** AI persona-interpretation(L2) 성향 키 */
export type AiPersonaKey = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'EVENT_DRIVEN';

/** AI 뷰 레이블(이산화 결과) */
export type PersonaViewLabel = 'POSITIVE' | 'WATCH' | 'NEUTRAL' | 'NEGATIVE';

/** 결합 신뢰도(DAR-56 신뢰규약: 근거·표본·신뢰도 동반) */
export interface FusionConfidence {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  /** 0~1 — 두 축의 커버리지 가중 */
  value: number;
  /** 표본 수 = AI 뷰 가용(0|1) + 평가된 철학 지표 수 */
  sampleCount: number;
}

/** 거장 철학 × AI 관점 결합 결과 1건 */
export interface PersonaPhilosophyFusion {
  philosophyId: string;
  investorName: string;
  /** 철학 스타일 → 대응시킨 AI persona */
  mappedPersona: AiPersonaKey;
  /** persona-fit 입력으로 쓴 AI 뷰 레이블·텍스트(설명용) */
  personaView: {
    view: PersonaViewLabel | null;
    available: boolean;
    interpretation: string | null;
  };
  /** persona-fit Rule 점수 0~100. 미가용 시 null */
  personaFitScore: number | null;
  /** philosophy-fit Rule 점수 0~100. 미가용 시 null */
  philosophyScore: number | null;
  /** 결합점수 0~100(Rule 가중·재정규화). 두 축 모두 결측이면 null */
  fusionScore: number | null;
  /** 결합점수 산출 가능 여부 */
  computable: boolean;
  confidence: FusionConfidence;
  /** 근거(설명) */
  basis: string[];
}

/** 종목 × 거장 철학 × AI 관점 결합(전체 거장) */
export interface CompanyPersonaPhilosophyFusion {
  corpCode: string;
  /** 철학 적합도 산정에 쓴 재무 스냅샷 메타(없으면 null) */
  financialBasis: FinancialBasis | null;
  /** 재무 결측(철학 축 전부 미가용) */
  noFinancials: boolean;
  /** AI 관점 산출물 출처(없으면 null) */
  aiBasis: { rcpNo: string; createdAt: string } | null;
  /** 거장별 결합 결과(결합점수 내림차순; computable=false 후순위) */
  fusions: PersonaPhilosophyFusion[];
}
