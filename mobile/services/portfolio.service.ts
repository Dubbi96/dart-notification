import type { ApiResponse } from '@app-types/api.types';
import type {
  Position,
  PortfolioSummary,
  PortfolioRiskSnapshot,
  PositionThesis,
  PaperPortfolio,
  TodayBriefing,
} from '@app-types/portfolio.types';

import { api } from './api';

export const portfolioService = {
  getPositions: () =>
    api.get<ApiResponse<Position[]>>('/positions').then((r) => r.data.data),

  getSummary: () =>
    api.get<ApiResponse<PortfolioSummary>>('/portfolio/summary').then((r) => r.data.data),

  getRiskSnapshot: () =>
    api
      .get<ApiResponse<PortfolioRiskSnapshot | null>>('/portfolio/risk/latest')
      .then((r) => r.data.data),

  getPosition: (positionId: string) =>
    api.get<ApiResponse<Position>>(`/positions/${positionId}`).then((r) => r.data.data),

  getThesis: (positionId: string) =>
    api
      .get<ApiResponse<PositionThesis>>(`/positions/${positionId}/thesis`)
      .then((r) => r.data.data),

  getPaperPortfolio: () =>
    api.get<ApiResponse<PaperPortfolio>>('/paper-trading/portfolio').then((r) => r.data.data),

  // W14 오늘의 브리핑 — 전 섹션 0건이면 data 는 null(0건 억제 계약).
  getTodayBriefing: () =>
    api
      .get<ApiResponse<TodayBriefing | null>>('/portfolio/briefing/today')
      .then((r) => r.data.data),
};
