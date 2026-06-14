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
    staleTime: 1000 * 60 * 30, // 30분 — 산출 후 사실상 불변인 과거 이벤트 통계, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}

export function useEventStudyResults(eventType?: string, marketType?: string) {
  return useQuery({
    queryKey: ['event-study', eventType, marketType],
    queryFn: () => eventStudyService.getResults(eventType, marketType),
    staleTime: 1000 * 60 * 30, // 30분 — 산출 후 사실상 불변인 이벤트 통계 집계, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
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
    staleTime: 1000 * 60 * 30, // 30분 — 산출 후 사실상 불변인 버킷 표본 관측치, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}
