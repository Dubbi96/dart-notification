import { api } from './api';
import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type { WatchlistItem } from '@app-types/user.types';

export const watchlistService = {
  getList: () =>
    api
      .get<ApiResponse<WatchlistItem[]>>('/watchlist')
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  add: (corpCode: string, corpName: string) =>
    api
      .post<ApiResponse<WatchlistItem>>('/watchlist', { corpCode, corpName })
      .then((r) => r.data.data),

  remove: (id: string) =>
    api.delete<ApiResponse<void>>(`/watchlist/${id}`).then((r) => r.data),

  // DAR-165: 종목 조회 시각 갱신 → 신규 공시 unread 배지 소거
  markViewed: (corpCode: string) =>
    api
      .post<ApiResponse<{ updated: number }>>(`/watchlist/${corpCode}/viewed`)
      .then((r) => r.data.data),
};
