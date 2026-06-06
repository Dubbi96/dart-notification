import { useQuery } from '@tanstack/react-query';
import { financialsService } from '@services/financials.service';

/**
 * 종목 최신 재무지표 조회 훅 (DAR-96).
 * 월간 크론이 적재한 CompanyFinancial 스냅샷을 종목 상세 펀더멘털 카드에 노출한다.
 * queryKey: ['financials', corpCode, fsDiv]
 */
export function useFinancials(corpCode: string, fsDiv?: string) {
  return useQuery({
    queryKey: ['financials', corpCode, fsDiv ?? 'CFS'],
    queryFn: () => financialsService.getLatest(corpCode, fsDiv),
    enabled: Boolean(corpCode),
  });
}
