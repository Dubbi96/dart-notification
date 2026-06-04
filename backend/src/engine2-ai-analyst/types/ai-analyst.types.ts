/**
 * Engine2 (AI Analyst) 공용 타입.
 * 설계 정본: docs/roadmap/cc-engine-architecture.md §4-4, §4-6, §6
 */

/** AI 비용 등급 — L0(미사용) ~ L3(최고비용). cc-engine-architecture §4-6 */
export enum AiCostLevel {
  /** AI 미사용 (Rule 기반) */
  L0 = 'L0',
  /** 보조 — 이벤트 분류 보정 등 저비용 */
  L1 = 'L1',
  /** 필수 — 요약·Persona 해석 */
  L2 = 'L2',
  /** 필수 — Position Thesis (실제 매수 후보만) */
  L3 = 'L3',
}

export type Polarity = 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL';

/**
 * 비용 게이트 입력 — Engine1 산출물에서 추출한 최소 정보만 받는다(엔진 간 결합 최소화).
 * buyScore/isHolding 은 M6/M8 이후 채워진다(그 전엔 undefined).
 */
export interface AiGateInput {
  isManagementStock: boolean; // 관리종목 여부
  isTargetEventType: boolean; // 분석 대상 5종 이벤트 여부
  tradingValue: number; // 거래대금(원)
  confidence: number; // 이벤트 추출 신뢰도 0~1
  polarity?: Polarity;
  buyScore?: number; // M6 이후
  isHolding?: boolean; // M8 이후 (보유 종목 악재면 L3)
}

/** 4개 AI Task 식별자 — rcpNo + task 복합키로 멱등 캐시 */
export type AiTaskName =
  | 'summary'
  | 'event-classification'
  | 'persona-interpretation'
  | 'position-thesis';

/** AI 호출 기록 파라미터 — AIUsageLog 모델로 영속(M3 마이그레이션 예정) */
export interface AiUsageLogParams {
  rcpNo: string;
  task: AiTaskName;
  level: AiCostLevel;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiCostMetrics {
  totalCostUsd: number;
  callCount: number;
  l0Ratio: number; // L0(미사용) 비율 — 70%+ 유지 목표
  costPerDisclosure: number;
}
