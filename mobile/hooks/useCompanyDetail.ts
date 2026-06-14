import { useQuery } from '@tanstack/react-query';
import { companyService } from '@services/company.service';

export function useCompanyDetail(corpCode: string) {
  return useQuery({
    queryKey: ['company', corpCode],
    queryFn: () => companyService.getByCorpCode(corpCode),
    enabled: !!corpCode,
    staleTime: 1000 * 60 * 30, // 30분 — 법인명·업종·종목코드 등 거의 불변인 기업 메타라 재진입 시 불필요 재요청 방지
  });
}
