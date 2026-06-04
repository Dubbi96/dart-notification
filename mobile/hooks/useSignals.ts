import { useQuery } from '@tanstack/react-query';
import { signalService } from '@services/signal.service';
import { eventStudyService } from '@services/event-study.service';

import type { SignalFilters } from '@app-types/signal.types';

export function useBuySignals(filters?: SignalFilters) {
  return useQuery({
    queryKey: ['signals', 'buy', filters?.personaType, filters?.grade, filters?.entryReady],
    queryFn: () => signalService.getBuySignals(filters),
    retry: 1,
  });
}

export function useExitSignals() {
  return useQuery({
    queryKey: ['signals', 'exit'],
    queryFn: () => signalService.getExitSignals(),
    retry: 1,
  });
}

export function useSignalDetail(id: string) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: () => signalService.getBuySignalDetail(id),
    enabled: !!id,
    retry: 1,
  });
}

export function useEventStudy(eventType?: string, marketType?: string) {
  return useQuery({
    queryKey: ['event-study', eventType, marketType],
    queryFn: () => eventStudyService.getResults(eventType, marketType),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}
