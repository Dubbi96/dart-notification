import { useQuery } from '@tanstack/react-query';
import { companyService } from '@services/company.service';

export function useCompanyDetail(corpCode: string) {
  return useQuery({
    queryKey: ['company', corpCode],
    queryFn: () => companyService.getByCorpCode(corpCode),
    enabled: !!corpCode,
  });
}
