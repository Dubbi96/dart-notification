import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';
import { isKstMarketOpen } from '@utils/marketQuoteDisplay';

// 분봉 단타 forward 누적 성과·보유 현황 폴링 훅 — DAR-416(BE: DAR-411).
// 장중 실시간 모의라 status 는 자주 변함 → staleTime 30s, 실패 1회 재시도.
// UXR-13 이월(C-1/H4): 전략 탭에 머무는 동안 단타 카드가 stale 로 고정되지 않도록
// 장중에만 45s 폴링(useSimulationStatus 준실시간 캐던스 정합, 매 틱 장개장 재판정).
// 장외/주말·백그라운드 폴링 0(과폴링 금지) — useMinuteCandles 의 장중 게이트 패턴.
const MARKET_OPEN_REFETCH_INTERVAL_MS = 45 * 1000;

export function useIntradayScalp() {
  return useQuery({
    queryKey: ['simulation', 'intraday-scalp', 'status'],
    queryFn: () => simulationService.getIntradayScalpStatus(),
    staleTime: 30 * 1000,
    refetchInterval: () =>
      isKstMarketOpen(new Date()) ? MARKET_OPEN_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
