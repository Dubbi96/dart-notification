import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 시스템 트레이딩 전략 변형 4종 성과 비교 폴링 훅 — DAR-405(BE: DAR-404).
// 백테스트 다중 트랙 결과라 자주 바뀌지 않음 → staleTime 60s, 실패 1회 재시도.
export function useStrategyComparison() {
  return useQuery({
    queryKey: ['simulation', 'strategy-comparison'],
    queryFn: () => simulationService.getStrategyComparison(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}
