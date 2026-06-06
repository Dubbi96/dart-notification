import { useQuery } from '@tanstack/react-query';
import { stockStatusService } from '@services/stockStatus.service';

/**
 * 종목 위험상태 조회 훅 (DAR-99). 관리종목·거래정지·상폐위험(DART 공시 폴백·근사값)을
 * company 상세·signals 카드 배지에 노출한다. corpCode 우선, 없으면 stockCode.
 * queryKey: ['stock-risk-status', corpCode|stockCode]
 */
export function useStockRiskStatus(params: { corpCode?: string; stockCode?: string }) {
  const key = params.corpCode ?? params.stockCode ?? '';
  return useQuery({
    queryKey: ['stock-risk-status', key],
    queryFn: () => stockStatusService.getRiskStatus(params),
    enabled: Boolean(key),
    // 위험상태는 일 1회 적재(스케줄러)·공시 기반 → 자주 변하지 않음. 5분 신선.
    staleTime: 5 * 60 * 1000,
  });
}
