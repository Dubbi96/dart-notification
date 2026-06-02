import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { disclosureService } from '@services/disclosure.service';

export function useDisclosures(disclosureType?: string, watchlistOnly?: boolean, keywords?: string[]) {
  return useInfiniteQuery({
    queryKey: ['disclosures', disclosureType, watchlistOnly, keywords],
    queryFn: ({ pageParam = 1 }) => disclosureService.getList(pageParam, 20, disclosureType, watchlistOnly, keywords),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
  });
}

export function useDisclosureSearch(query: string, disclosureType?: string) {
  return useInfiniteQuery({
    queryKey: ['disclosures', 'search', query, disclosureType],
    queryFn: ({ pageParam = 1 }) => disclosureService.search(query, pageParam, disclosureType),
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
