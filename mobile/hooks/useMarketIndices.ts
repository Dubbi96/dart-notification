import { useQuery } from '@tanstack/react-query';
import { marketService } from '@services/market.service';

/**
 * 시장지수(KOSPI·KOSDAQ) 최신값 조회 훅 (DAR-160).
 * 홈 헤더 '시장 한눈에' 배지·신호 화면 시장국면 맥락에 재사용한다. 게스트 열람 가능.
 * 지수는 EOD 배치로 일 1회 적재 → 자주 변하지 않으므로 5분 신선.
 * queryKey: ['market-indices']
 */
export function useMarketIndices() {
  return useQuery({
    queryKey: ['market-indices'],
    queryFn: () => marketService.getLatestIndices(),
    staleTime: 5 * 60 * 1000,
  });
}
