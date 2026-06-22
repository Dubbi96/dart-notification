import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 분봉 단타 forward 누적 성과·보유 현황 폴링 훅 — DAR-416(BE: DAR-411).
// 장중 실시간 모의라 status 는 자주 변함 → staleTime 30s, 실패 1회 재시도.
export function useIntradayScalp() {
  return useQuery({
    queryKey: ['simulation', 'intraday-scalp', 'status'],
    queryFn: () => simulationService.getIntradayScalpStatus(),
    staleTime: 30 * 1000,
    retry: 1,
  });
}
