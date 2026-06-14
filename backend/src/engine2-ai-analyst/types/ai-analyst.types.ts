/**
 * Engine2 (AI Analyst) 공용 타입.
 * 설계 정본: docs/roadmap/cc-engine-architecture.md §4-4, §4-6, §6
 */

import { AiQueueHealth } from '../../common/queues/queue.constants';

export { AiQueueHealth };

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
  l0Warning: boolean; // true when l0Ratio < 0.7
  // DAR-241: 멱등 캐시히트 횟수(비용0 재사용). callCount/cost 와 분리 집계 —
  // 캐시히트는 'AI 호출'이 아니므로 l0Ratio·비용 분모를 오염시키지 않는다.
  cacheHitCount: number;
}

export interface AiCostPeriodSummary {
  totalCostUsd: number;
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  l0Count: number;
  l1Count: number;
  l2Count: number;
  l3Count: number;
  l0Ratio: number;
  byTask: Record<AiTaskName, { costUsd: number; callCount: number }>;
  // DAR-241: 캐시히트 횟수(비용0 재사용). 실호출 집계와 분리. 0=관측 미발생.
  cacheHitCount: number;
}

export interface AiCostLimitStatus {
  dailyCostUsd: number;
  dailyLimitUsd: number;
  dailyExceeded: boolean;
  monthlyCostUsd: number;
  monthlyLimitUsd: number;
  monthlyExceeded: boolean;
  forcedLevel: AiCostLevel | null; // null = not forced
}

/**
 * 수용 기준(Acceptance Criteria) 기계 평가 — live-llm-smoke.ts 기준의 상시화.
 * 공시당 평균 비용 < $0.005 · L0(미사용) 비율 ≥ 70%.
 */
export interface AiCostAcceptance {
  costPerDisclosureUsd: number;
  costThresholdUsd: number; // 0.005
  costOk: boolean;
  l0Ratio: number;
  l0ThresholdRatio: number; // 0.7
  l0Ok: boolean;
  allOk: boolean;
}

/** 한도 대비 사용률 (일 $1 / 월 $20). 0~1+ (초과 시 1 이상). */
export interface AiCostLimitUsage {
  dailyUsedRatio: number;
  monthlyUsedRatio: number;
}

/**
 * 운영 알림 플래그 — 모니터링 전용.
 * ★실주문·Kill Switch에 직접 연결 금지(휴먼 승인 경계). 로그/응답에만 노출한다.
 */
export interface AiCostHealthAlert {
  violated: boolean;
  reasons: string[];
}

/** 라이브 AI 비용게이트 상시 모니터링 스냅샷 (G3 수익 대비 AI비용 실시간 방어). */
export interface AiCostHealthSnapshot {
  evaluatedAt: string; // ISO8601
  llmKeyConfigured: boolean; // false여도 과거 AIUsageLog 집계로 동작 (graceful)
  acceptance: AiCostAcceptance;
  daily: AiCostPeriodSummary;
  weekly: AiCostPeriodSummary;
  weekFrom: string;
  weekTo: string;
  limit: AiCostLimitStatus;
  limitUsage: AiCostLimitUsage;
  alert: AiCostHealthAlert;
  /**
   * DAR-89: AI_ANALYZE 큐 상태(실패 잡 수 등) — 라이브 AI 잡 유실 관측.
   * Redis 미가용/큐 미주입 시 null(graceful, health 자체는 DB 집계로 동작).
   */
  queue: AiQueueHealth | null;
}

/** LLM 호출 1회의 토큰·모델 정보 (비용 기록용) */
export interface TaskUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** AI Task 실행 결과 — 검증된 산출물 + 사용량(비용 기록) */
export interface TaskRunResult<T> {
  result: T;
  usage: TaskUsage;
}
