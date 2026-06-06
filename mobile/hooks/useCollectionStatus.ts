import { useQuery } from '@tanstack/react-query';
import { collectionStatusService } from '@services/collection-status.service';

// 수집 현황 집계 조회 훅 — DAR-63. queryKey ['collection-status'].
// 집계는 자주 바뀌지 않으므로 staleTime 2분, 실패 1회 재시도.
export function useCollectionStatus() {
  return useQuery({
    queryKey: ['collection-status'],
    queryFn: () => collectionStatusService.getStatus(),
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}
