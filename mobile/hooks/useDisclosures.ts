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
  });
}

/** 공시 AI 이벤트 분석 — GET /disclosure-events/:rcpNo 실연동. 미존재 시 null. */
export function useDisclosureEvent(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-event', rcpNo],
    queryFn: () => disclosureService.getEvent(rcpNo),
    enabled: !!rcpNo,
    retry: false,
  });
}

export function useDisclosureAnalysis(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-analysis', rcpNo],
    queryFn: () => disclosureService.getAnalysis(rcpNo),
    enabled: !!rcpNo,
    retry: false,
  });
}
