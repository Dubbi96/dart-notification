import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 분봉 단타 거래 타임라인(최신 진입순) 폴링 훅 — DAR-416(BE: DAR-411).
// 드릴다운 화면에서 소비. 장중 실시간 모의라 staleTime 30s, 실패 1회 재시도.
export function useIntradayScalpTrades() {
  return useQuery({
    queryKey: ['simulation', 'intraday-scalp', 'trades'],
    queryFn: () => simulationService.getIntradayScalpTrades(),
    staleTime: 30 * 1000,
    retry: 1,
  });
}
