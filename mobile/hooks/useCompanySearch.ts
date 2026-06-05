import { useQuery } from '@tanstack/react-query';
import { companyService } from '@services/company.service';

/** 2글자 이상이거나 6자리 종목코드일 때만 자동완성 API를 호출한다. */
export function shouldSearch(query: string): boolean {
  const term = query.trim();
  return term.length >= 2 || /^\d{6}$/.test(term);
}

export function useCompanySearch(query: string) {
  const term = query.trim();
  return useQuery({
    queryKey: ['companies', 'search', term],
    queryFn: () => companyService.search(term),
    enabled: shouldSearch(term),
    staleTime: 1000 * 60 * 5, // 5분 — 같은 검색어 재입력 시 캐시 활용
  });
}

export function usePopularCompanies() {
  return useQuery({
    queryKey: ['companies', 'popular'],
    queryFn: companyService.getPopular,
    staleTime: 1000 * 60 * 60, // 1시간
  });
}
