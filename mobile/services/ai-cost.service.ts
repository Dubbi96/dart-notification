import type { ApiResponse, AiCostMetrics, AiCostHealth } from '@app-types/api.types';

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
};
