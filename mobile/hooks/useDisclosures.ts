import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { disclosureService } from '@services/disclosure.service';

export function useDisclosures(
  disclosureType?: string,
  watchlistOnly?: boolean,
  keywords?: string[],
  from?: string,
) {
  return useInfiniteQuery({
    queryKey: ['disclosures', disclosureType, watchlistOnly, keywords, from],
    queryFn: ({ pageParam = 1 }) =>
      disclosureService.getList(pageParam, 20, disclosureType, watchlistOnly, keywords, from),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
  });
}

export function useDisclosureSearch(
  query: string,
  disclosureType?: string,
  sort?: 'latest' | 'relevance',
  from?: string,
) {
  return useInfiniteQuery({
    queryKey: ['disclosures', 'search', query, disclosureType, sort, from],
    queryFn: ({ pageParam = 1 }) =>
      disclosureService.search(query, pageParam, disclosureType, sort, from),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
    enabled: query.length >= 1,
  });
}

export function useDisclosureDetail(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure', rcpNo],
    queryFn: () => disclosureService.getDetail(rcpNo),
    enabled: !!rcpNo,
    staleTime: 1000 * 60 * 30, // 30분 — rcpNo 공시 상세는 발행 후 사실상 불변, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}

/** 공시 AI 이벤트 분석 — GET /disclosure-events/:rcpNo 실연동. 미존재 시 null. */
export function useDisclosureEvent(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-event', rcpNo],
    queryFn: () => disclosureService.getEvent(rcpNo),
    enabled: !!rcpNo,
    retry: false,
    staleTime: 1000 * 60 * 30, // 30분 — rcpNo 단건 이벤트 분석은 사실상 불변, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}

export function useDisclosureAnalysis(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-analysis', rcpNo],
    queryFn: () => disclosureService.getAnalysis(rcpNo),
    enabled: !!rcpNo,
    retry: false,
    // 30분 — rcpNo 단건 AI 요약은 사실상 불변. 재처리 후 갱신은 invalidate 경로로 즉시 반영되므로 staleTime은 자동 refetch만 억제(기업메타 정책 정렬)
    staleTime: 1000 * 60 * 30,
  });
}

/** 공시 본문 정량 fact — GET /disclosure-facts/:rcpNo 실연동(DAR-112). 추출 없으면 빈 배열. */
export function useDisclosureFiledFacts(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-facts', rcpNo],
    queryFn: () => disclosureService.getFiledFacts(rcpNo),
    enabled: !!rcpNo,
    retry: false,
    staleTime: 1000 * 60 * 30, // 30분 — rcpNo 본문 정량 fact는 발행 후 불변, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}
