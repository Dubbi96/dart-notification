import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

import type { StrategyKey } from '@app-types/strategy-comparison.types';

// 전략별 과거 매수/매도 타임라인 폴링 훅 — DAR-405(BE: DAR-404).
// key 가 유효한 전략일 때만 활성화(잘못된 딥링크 방어). 백테스트 결과라 staleTime 60s.
export function useStrategyTradeHistory(key: StrategyKey | undefined) {
  return useQuery({
    queryKey: ['simulation', 'strategy-trade-history', key],
    queryFn: () => simulationService.getStrategyTradeHistory(key as StrategyKey),
    enabled: !!key,
    staleTime: 60 * 1000,
    retry: 1,
  });
}
