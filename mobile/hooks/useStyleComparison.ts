import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 철학 스타일별 모의운용 성과 비교 폴링 훅 — DAR-76.
// 일일 사이클 결과라 자주 바뀌지 않음 → staleTime 60s, 실패 1회 재시도.
export function useStyleComparison() {
  return useQuery({
    queryKey: ['simulation', 'style-comparison'],
    queryFn: () => simulationService.getStyleComparison(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}
