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
