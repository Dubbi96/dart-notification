import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { eventStudyService } from '@services/event-study.service';

const OBSERVATIONS_PAGE_SIZE = 20;

export function useCompanyEventStudy(
  corpCode: string,
  eventType?: string,
  marketType?: string,
) {
  return useQuery({
    queryKey: ['event-study', 'company', corpCode, eventType, marketType],
    queryFn: () => eventStudyService.getByCorpCode(corpCode, eventType, marketType),
    enabled: Boolean(corpCode),
  });
}

export function useEventStudyResults(eventType?: string, marketType?: string) {
  return useQuery({
    queryKey: ['event-study', eventType, marketType],
    queryFn: () => eventStudyService.getResults(eventType, marketType),
  });
}

/**
 * 버킷 구성 개별 관측치 드릴다운 (DAR-166).
 *
 * bucketKey 의 표본(개별 공시별 CAR)을 offset 페이지네이션으로 불러온다.
 * enabled 로 '표본 N건 보기' 펼침 시에만 호출(불필요한 요청 방지).
 */
export function useEventStudyObservations(bucketKey: string | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['event-study', 'observations', bucketKey],
    queryFn: ({ pageParam = 0 }) =>
      eventStudyService.getObservations(bucketKey!, pageParam, OBSERVATIONS_PAGE_SIZE),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.items.length : undefined,
    initialPageParam: 0,
    enabled: Boolean(bucketKey) && enabled,
  });
}
