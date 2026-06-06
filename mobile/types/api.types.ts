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
}

export interface AiCostMetrics {
  totalCostUsd: number;
  totalTokens: number;
  byTask: Record<string, { costUsd: number; tokens: number; count: number }>;
  byLevel: Record<string, { costUsd: number; count: number }>;
  period: { from: string; to: string };
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
