import { useQuery } from '@tanstack/react-query';
import { backtestService } from '@services/backtest.service';

// 신호 사후검증 정밀도 조회 훅 — DAR-73. queryKey ['backtest','signal-accuracy'].
// 가격 집계 기반이라 자주 안 바뀜 → staleTime 5분, 실패 1회 재시도.
export function useSignalAccuracy() {
  return useQuery({
    queryKey: ['backtest', 'signal-accuracy'],
    queryFn: () => backtestService.getSignalAccuracy(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
