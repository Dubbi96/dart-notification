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
    staleTime: 1000 * 60 * 30, // 30분 — 분기 1회 갱신되는 정적 재무 스냅샷, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}
