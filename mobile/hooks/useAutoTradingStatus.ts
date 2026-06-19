import { useQuery } from '@tanstack/react-query';
import { autoStatusService } from '@services/autoStatus.service';

// 자동매매 실행상태 준실시간 폴링 훅 — DAR-361.
// 킬스위치는 안전상 항상 최신이어야 하므로 30초 폴링(포그라운드 한정·배터리 절약).
// queryKey ['auto-trading-status'] — 캐시 무효화 단일 키.
const REFETCH_INTERVAL_MS = 30 * 1000;

export function useAutoTradingStatus(recentLimit = 3) {
  return useQuery({
    queryKey: ['auto-trading-status', recentLimit],
    queryFn: () => autoStatusService.getStatus(recentLimit),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 15 * 1000,
    retry: 1,
  });
}
