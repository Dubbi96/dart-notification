import { useQuery } from '@tanstack/react-query';
import { insiderHoldingService } from '@services/insider-holding.service';

import type { InsiderHoldingsQuery } from '@app-types/insider-holding.types';

/**
 * 종목별 내부자/대량보유 동향 조회 훅 (DAR-88).
 * 최근 변동을 보고일 내림차순으로 가져온다.
 */
export function useCompanyInsiderHoldings(
  corpCode: string,
  query: Omit<InsiderHoldingsQuery, 'corpCode'> = {},
) {
  return useQuery({
    queryKey: ['insider-holdings', 'company', corpCode, query],
    queryFn: () => insiderHoldingService.list({ corpCode, limit: 20, ...query }),
    enabled: Boolean(corpCode),
    staleTime: 1000 * 60 * 30, // 30분 — 공시 기반 저빈도 내부자/대량보유 동향, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}
