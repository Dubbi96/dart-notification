import { useQuery } from '@tanstack/react-query';
import { companyService } from '@services/company.service';

export function useCompanySearch(query: string) {
  return useQuery({
    queryKey: ['companies', 'search', query],
    queryFn: () => companyService.search(query),
    enabled: query.length >= 1,
  });
}

export function usePopularCompanies() {
  return useQuery({
    queryKey: ['companies', 'popular'],
    queryFn: companyService.getPopular,
    staleTime: 1000 * 60 * 60, // 1시간
  });
}
