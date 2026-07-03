import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 듀얼모멘텀 코어 트랙(자산배분·월단위) 스코어카드 훅 — DAR-495(BE: DAR-494/495).
// ★월 1회 리밸런싱 트랙이라 상태가 하루 단위로만 변한다(장중 폴링 불필요) → 단타(45s 폴링)와
//   달리 staleTime 을 넉넉히(5분) 두고 인터벌 폴링 없음. 실패 1회 재시도.
const CORE_TRACK_STALE_MS = 5 * 60 * 1000;

/** 코어 트랙 스코어카드 쿼리키(형제 refetch 매핑에서 참조). */
export const CORE_TRACK_QUERY_KEY = ['simulation', 'core-track', 'scorecard'] as const;

export function useCoreTrackScorecard() {
  return useQuery({
    queryKey: CORE_TRACK_QUERY_KEY,
    queryFn: () => simulationService.getCoreTrackScorecard(),
    staleTime: CORE_TRACK_STALE_MS,
    retry: 1,
  });
}
