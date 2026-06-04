import { useQuery } from '@tanstack/react-query';
import { signalService } from '@services/signal.service';

import type { SignalFilters } from '@app-types/signal.types';

// 신호 엔드포인트가 아직 없으므로 retry는 끈다(불필요한 재시도/지연 방지).
// 서비스 레이어가 404를 빈 배열로 흡수하므로 화면은 깔끔한 빈 상태를 받는다.

export function useBuySignals(filters?: SignalFilters) {
  return useQuery({
    queryKey: ['signals', 'buy', filters?.personaType, filters?.grade, filters?.entryReady],
    queryFn: () => signalService.getBuySignals(filters),
    retry: false,
  });
}

export function useExitSignals() {
  return useQuery({
    queryKey: ['signals', 'exit'],
    queryFn: () => signalService.getExitSignals(),
    retry: false,
  });
}

export function useSignalDetail(id: string) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: () => signalService.getBuySignalDetail(id),
    enabled: !!id,
    retry: false,
  });
}
