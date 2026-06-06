import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 모의 매매 사유 추적 + 성적표 조회 훅 — DAR-64. queryKey ['simulation','trade-history'].
// 일일 사이클 결과라 자주 바뀌지 않음 → staleTime 60s, 실패 1회 재시도.
export function useTradeHistory() {
  return useQuery({
    queryKey: ['simulation', 'trade-history'],
    queryFn: () => simulationService.getTradeHistory(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}
