import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { watchlistService } from '@services/watchlist.service';
import { getDialogRef } from '@components/common/DialogProvider';
import { palette } from '@theme/colors';

import type { PaginationMeta } from '@app-types/api.types';
import type { WatchlistItem } from '@app-types/user.types';

export const WATCHLIST_KEY = ['watchlist'] as const;

interface WatchlistCache {
  data: WatchlistItem[];
  meta: PaginationMeta;
}

interface AddWatchlistVars {
  corpCode: string;
  corpName: string;
  stockCode?: string | null;
  market?: string | null;
}

export function useWatchlist(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: WATCHLIST_KEY,
    queryFn: watchlistService.getList,
    enabled: options?.enabled ?? true,
  });
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ corpCode, corpName }: AddWatchlistVars) =>
      watchlistService.add(corpCode, corpName),
    // 낙관적 추가: 캐시에 즉시 반영
    onMutate: async (vars: AddWatchlistVars) => {
      await queryClient.cancelQueries({ queryKey: WATCHLIST_KEY });
      const prev = queryClient.getQueryData<WatchlistCache>(WATCHLIST_KEY);
      if (prev && !prev.data.some((i) => i.corpCode === vars.corpCode)) {
        const optimistic: WatchlistItem = {
          id: `temp-${vars.corpCode}`,
          userId: '',
          corpCode: vars.corpCode,
          corpName: vars.corpName,
          stockCode: vars.stockCode ?? null,
          market: vars.market ?? null,
          lastDisclosureDate: null,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<WatchlistCache>(WATCHLIST_KEY, {
          data: [optimistic, ...prev.data],
          meta: { ...prev.meta, total: (prev.meta?.total ?? prev.data.length) + 1 },
        });
      }
      return { prev };
    },
    onError: (error, _vars, context) => {
      // 서버 오류 시 롤백
      if (context?.prev) {
        queryClient.setQueryData(WATCHLIST_KEY, context.prev);
      }
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 422) {
        getDialogRef().current?.showDialog({
          title: '등록 한도 초과',
          message: '관심 기업은 최대 30개까지 등록할 수 있습니다.',
          icon: { name: 'alert-circle', color: palette.yellow500 },
        });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => watchlistService.remove(id),
    // 낙관적 제거: 캐시에서 즉시 제외
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: WATCHLIST_KEY });
      const prev = queryClient.getQueryData<WatchlistCache>(WATCHLIST_KEY);
      if (prev) {
        queryClient.setQueryData<WatchlistCache>(WATCHLIST_KEY, {
          data: prev.data.filter((i) => i.id !== id),
          meta: {
            ...prev.meta,
            total: Math.max((prev.meta?.total ?? prev.data.length) - 1, 0),
          },
        });
      }
      return { prev };
    },
    onError: (_error, _id, context) => {
      if (context?.prev) {
        queryClient.setQueryData(WATCHLIST_KEY, context.prev);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });
}
