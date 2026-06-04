import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { watchlistService } from '@services/watchlist.service';
import { getDialogRef } from '@components/common/DialogProvider';
import { palette } from '@theme/colors';

export function useWatchlist(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: watchlistService.getList,
    enabled: options?.enabled ?? true,
  });
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ corpCode, corpName }: { corpCode: string; corpName: string }) =>
      watchlistService.add(corpCode, corpName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 422) {
        getDialogRef().current?.showDialog({
          title: '등록 한도 초과',
          message: '관심 기업은 최대 30개까지 등록할 수 있습니다.',
          icon: { name: 'alert-circle', color: palette.yellow500 },
        });
      }
    },
  });
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: watchlistService.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  });
}
