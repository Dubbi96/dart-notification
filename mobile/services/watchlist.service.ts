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
};
