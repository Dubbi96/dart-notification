import type { ApiResponse } from '@app-types/api.types';
import type {
  TradingSignal,
  ExitSignal,
  SignalFilters,
} from '@app-types/signal.types';

import { api } from './api';

export const signalService = {
  getBuySignals: (filters?: SignalFilters) =>
    api
      .get<ApiResponse<TradingSignal[]>>('/signals', {
        params: {
          ...(filters?.personaType && { personaType: filters.personaType }),
          ...(filters?.grade && { grade: filters.grade }),
          ...(filters?.entryReady && { entryReady: true }),
        },
      })
      .then((r) => r.data.data),

  getBuySignalDetail: (id: string) =>
    api.get<ApiResponse<TradingSignal>>(`/signals/${id}`).then((r) => r.data.data),

  getExitSignals: () =>
    api.get<ApiResponse<ExitSignal[]>>('/signals/exit').then((r) => r.data.data),
};
