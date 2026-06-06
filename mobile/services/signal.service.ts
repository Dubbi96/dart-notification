import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type {
  TradingSignal,
  ExitSignal,
  SignalFilters,
  SignalExploreFilters,
} from '@app-types/signal.types';

import { api } from './api';

export const signalService = {
  getBuySignals: (filters?: SignalFilters) =>
    api
      .get<ApiResponse<TradingSignal[]>>('/signals', {
        params: {
          ...(filters?.personaType && { personaType: filters.personaType }),
          ...(filters?.grade && { grade: filters.grade }),
          ...(filters?.entryReady && { entryReady: true }),
        },
      })
      .then((r) => r.data.data),

  /**
   * 등급무관 전체 시그널 탐색(DAR-46) — 페이지네이션 + 등급/페르소나/이벤트유형 필터 + 정렬.
   * 무한스크롤을 위해 meta(page/totalPages)를 함께 반환한다.
   */
  getSignals: (filters: SignalExploreFilters, page = 1, limit = 20) =>
    api
      .get<ApiResponse<TradingSignal[]>>('/signals', {
        params: {
          page,
          limit,
          ...(filters.grade && { grade: filters.grade }),
          ...(filters.personaType && { personaType: filters.personaType }),
          ...(filters.eventType && { eventType: filters.eventType }),
          ...(filters.sort && { sort: filters.sort }),
        },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  getBuySignalDetail: (id: string) =>
    api.get<ApiResponse<TradingSignal>>(`/signals/${id}`).then((r) => r.data.data),

  getExitSignals: () =>
    api.get<ApiResponse<ExitSignal[]>>('/signals/exit').then((r) => r.data.data),
};
