import { useQuery } from '@tanstack/react-query';
import { searchService } from '@services/search.service';

/** 통합 검색은 2글자 이상일 때만 호출(백엔드 q<2 가드와 일치). */
export const MIN_SEARCH_LENGTH = 2;

export function shouldUnifiedSearch(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_LENGTH;
}

export function useUnifiedSearch(query: string) {
  const term = query.trim();
  return useQuery({
    queryKey: ['search', 'unified', term],
    queryFn: () => searchService.unified(term),
    enabled: shouldUnifiedSearch(term),
    staleTime: 1000 * 60 * 5, // 5분 — 같은 검색어 재입력 시 캐시 활용
  });
}
