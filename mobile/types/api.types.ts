export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
  unreadCount?: number;
  // DAR-161: 알림 인박스 타입별 미읽음 카운트(DISCLOSURE/SIGNAL/EXIT/THESIS_VIOLATED).
  unreadByType?: Record<string, number>;
  // DAR-430: 카테고리(3 버킷)별 미읽음 카운트(disclosure/signal/trade).
  unreadByCategory?: Record<string, number>;
}

export interface AiCostMetrics {
  totalCostUsd: number;
  totalTokens: number;
  byTask: Record<string, { costUsd: number; tokens: number; count: number }>;
  byLevel: Record<string, { costUsd: number; count: number }>;
  period: { from: string; to: string };
}

/**
 * AI 비용 기간 집계 (GET /ai-cost/daily·monthly, DAR-98).
 * 백엔드 AiCostPeriodSummary 1:1. 읽기전용.
 */
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
  byTask: Record<string, { costUsd: number; callCount: number }>;
}

/**
 * AI 비용 한도 현황 (GET /ai-cost/limit-status, DAR-98).
 * 일 $1 / 월 $20 한도 대비 소진. forcedLevel='L0'이면 한도초과로 AI 강등됨. 읽기전용.
 */
export interface AiCostLimitStatus {
  dailyCostUsd: number;
  dailyLimitUsd: number;
  dailyExceeded: boolean;
  monthlyCostUsd: number;
  monthlyLimitUsd: number;
  monthlyExceeded: boolean;
  forcedLevel: string | null; // null = 강등 없음
}

/**
 * Cross-engine 단위비용 (GET /ai-cost/cross-engine, DAR-98).
 * 백엔드 CostMetrics 1:1. KRW 기준. 0 = 표본 없음, ratio -1 = 순익 없음. 읽기전용.
 */
export interface AiCrossEngineMetrics {
  costPerDisclosure: number;
  costPerSignal: number;
  costPerTrade: number;
  aiCostToNetPnlRatio: number;
}

/** 라이브 AI 비용게이트 상시 모니터링 헬스 (GET /ai-cost/health, DAR-75) */
export interface AiCostHealth {
  evaluatedAt: string;
  llmKeyConfigured: boolean;
  acceptance: {
    costPerDisclosureUsd: number;
    costThresholdUsd: number;
    costOk: boolean;
    l0Ratio: number;
    l0ThresholdRatio: number;
    l0Ok: boolean;
    allOk: boolean;
  };
  limit: {
    dailyCostUsd: number;
    dailyLimitUsd: number;
    dailyExceeded: boolean;
    monthlyCostUsd: number;
    monthlyLimitUsd: number;
    monthlyExceeded: boolean;
  };
  limitUsage: { dailyUsedRatio: number; monthlyUsedRatio: number };
  alert: { violated: boolean; reasons: string[] };
}
