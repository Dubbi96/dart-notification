import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { disclosureService } from '@services/disclosure.service';

export function useDisclosures() {
  return useInfiniteQuery({
    queryKey: ['disclosures'],
    queryFn: ({ pageParam = 1 }) => disclosureService.getList(pageParam),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
  });
}

export function useDisclosureDetail(id: string) {
  return useQuery({
    queryKey: ['disclosure', id],
    queryFn: () => disclosureService.getDetail(id),
    enabled: !!id,
  });
}
