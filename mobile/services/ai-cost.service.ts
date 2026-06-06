import type {
  ApiResponse,
  AiCostMetrics,
  AiCostHealth,
  AiCostPeriodSummary,
  AiCostLimitStatus,
  AiCrossEngineMetrics,
} from '@app-types/api.types';

import { api } from './api';

export const aiCostService = {
  getMetrics: (from?: string, to?: string) =>
    api
      .get<ApiResponse<AiCostMetrics>>('/ai-cost/metrics', { params: { from, to } })
      .then((r) => r.data.data),

  getHealth: () =>
    api
      .get<ApiResponse<AiCostHealth>>('/ai-cost/health')
      .then((r) => r.data.data),

  // DAR-98: AI 비용 거버넌스 4 엔드포인트 (읽기전용)
  getDaily: (date?: string) =>
    api
      .get<ApiResponse<AiCostPeriodSummary>>('/ai-cost/daily', { params: { date } })
      .then((r) => r.data.data),

  getMonthly: (year?: number, month?: number) =>
    api
      .get<ApiResponse<AiCostPeriodSummary>>('/ai-cost/monthly', { params: { year, month } })
      .then((r) => r.data.data),

  getLimitStatus: () =>
    api
      .get<ApiResponse<AiCostLimitStatus>>('/ai-cost/limit-status')
      .then((r) => r.data.data),

  getCrossEngine: (from?: string, to?: string) =>
    api
      .get<ApiResponse<AiCrossEngineMetrics>>('/ai-cost/cross-engine', { params: { from, to } })
      .then((r) => r.data.data),
};
