import axios from 'axios';


import type { ApiResponse } from '@app-types/api.types';
import type {
  Position,
  PortfolioSummary,
  PositionThesis,
  PaperPortfolio,
} from '@app-types/portfolio.types';

import { api } from './api';

// ⚠️ 포지션/포트폴리오/모의투자 엔드포인트는 아직 백엔드에 없다(DAR-22).
// 404/네트워크 오류는 "빈 상태"로 우아하게 처리하고, 그 외 오류는 전파한다.

function isMissingEndpoint(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.response?.status === 404 || error.response === undefined);
}

async function emptyOnMissing<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise;
  } catch (error) {
    if (isMissingEndpoint(error)) return [];
    throw error;
  }
}

async function nullOnMissing<T>(promise: Promise<T | null>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isMissingEndpoint(error)) return null;
    throw error;
  }
}

export const portfolioService = {
  getPositions: () =>
    emptyOnMissing(
      api.get<ApiResponse<Position[]>>('/positions').then((r) => r.data.data),
    ),

  getSummary: () =>
    nullOnMissing(
      api.get<ApiResponse<PortfolioSummary>>('/portfolio/summary').then((r) => r.data.data),
    ),

  getPosition: (positionId: string) =>
    nullOnMissing(
      api.get<ApiResponse<Position>>(`/positions/${positionId}`).then((r) => r.data.data),
    ),

  getThesis: (positionId: string) =>
    nullOnMissing(
      api
        .get<ApiResponse<PositionThesis>>(`/positions/${positionId}/thesis`)
        .then((r) => r.data.data),
    ),

  getPaperPortfolio: () =>
    nullOnMissing(
      api.get<ApiResponse<PaperPortfolio>>('/paper-trading/portfolio').then((r) => r.data.data),
    ),
};
