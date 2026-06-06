/**
 * Persona 철학 엔진 P-A — 도메인 타입 (DAR-48)
 *
 * 유명 투자자 철학을 구조화·정량화한 순수 데이터 타입.
 * AI 미개입(순수 데이터/구조). P-B 스코어러가 이 타입을 입력으로 사용한다.
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §2-1
 */

/** 정량 지표 비교 연산자 (Prisma enum PhilosophyMetricOperator 와 동일) */
export type PhilosophyMetricOperator = 'GT' | 'LT' | 'EQ' | 'RANGE';

/** 철학 출처 유형 (Prisma enum PhilosophySourceType 와 동일) */
export type PhilosophySourceType =
  | 'BOOK'
  | 'SHAREHOLDER_LETTER'
  | 'INTERVIEW'
  | 'PUBLIC_STATEMENT';

/** 철학별 정량 지표 매핑 (ROE·부채비율·PER·해자 등) */
export interface PhilosophyMetricSeed {
  /** 지표 키 (예: 'ROE', 'DEBT_RATIO', 'PER', 'MOAT_SCORE') */
  metricKey: string;
  operator: PhilosophyMetricOperator;
  /** 기준값 (RANGE 의 경우 하한) */
  threshold: number;
  /** RANGE 상한 (operator='RANGE' 일 때만) */
  thresholdMax?: number;
  /** 가중치 0~1 (해당 철학 내 합산 = 1) */
  weight: number;
  description: string;
}

/** 철학 출처 (공개 자료 기반) */
export interface PhilosophySourceSeed {
  type: PhilosophySourceType;
  title: string;
  year: number;
  url?: string;
}

/** 유명 투자자 철학 시드 단위 */
export interface InvestorPhilosophySeed {
  /** 고유 식별자 자연키 (예: 'BUFFETT', 'LYNCH') */
  philosophyId: string;
  investorName: string;
  /** 스타일 태그 (기존 4 persona 와 연계 가능) */
  styleTags: string[];
  corePrinciples: string[];
  applicableAssets: string[];
  checklistItems: string[];
  /** 리스크 성향 */
  riskProfile: string;
  /** 스코어 산식 설명 (참고용) */
  scoreFormula?: string;
  metrics: PhilosophyMetricSeed[];
  sources: PhilosophySourceSeed[];
}
