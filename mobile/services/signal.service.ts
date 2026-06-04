import axios from 'axios';


import type { ApiResponse } from '@app-types/api.types';
import type {
  TradingSignal,
  ExitSignal,
  SignalFilters,
} from '@app-types/signal.types';

import { api } from './api';

// ⚠️ 매수/매도 신호 엔드포인트는 아직 백엔드에 없다(DAR-22).
// 엔드포인트가 생기기 전까지 404/네트워크 오류는 "빈 상태"로 우아하게 처리한다.
// 그 외 오류는 그대로 전파해 화면이 에러 상태를 표시하도록 둔다.

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

export const signalService = {
  getBuySignals: (filters?: SignalFilters) =>
    emptyOnMissing(
      api
        .get<ApiResponse<TradingSignal[]>>('/signals', {
          params: {
            ...(filters?.personaType && { personaType: filters.personaType }),
            ...(filters?.grade && { grade: filters.grade }),
            ...(filters?.entryReady && { entryReady: true }),
          },
        })
        .then((r) => r.data.data),
    ),

  getBuySignalDetail: (id: string) =>
    nullOnMissing(
      api.get<ApiResponse<TradingSignal>>(`/signals/${id}`).then((r) => r.data.data),
    ),

  getExitSignals: () =>
    emptyOnMissing(
      api.get<ApiResponse<ExitSignal[]>>('/signals/exit').then((r) => r.data.data),
    ),
};
