import { useQuery } from '@tanstack/react-query';
import { personaService } from '@services/persona.service';

// persona별 성과 + 현재 장 적합 persona 추천 폴링 훅 — DAR-131.
// 일일 사이클 + 레짐 분류 결과라 자주 바뀌지 않음 → staleTime 60s, 실패 1회 재시도.
export function usePersonaOverview() {
  return useQuery({
    queryKey: ['persona', 'overview'],
    queryFn: () => personaService.getOverview(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}
