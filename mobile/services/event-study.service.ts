import type { ApiResponse } from '@app-types/api.types';
import type { EventStudyResult } from '@app-types/signal.types';
import { api } from './api';

export const eventStudyService = {
  getResults: (eventType?: string, marketType?: string) =>
    api
      .get<ApiResponse<EventStudyResult[]>>('/event-study', {
        params: {
          ...(eventType && { eventType }),
          ...(marketType && { marketType }),
        },
      })
      .then((r) => r.data.data),

  getByCorpCode: (corpCode: string, eventType?: string, marketType?: string) =>
    api
      .get<ApiResponse<EventStudyResult[]>>(`/companies/${corpCode}/event-study`, {
        params: {
          ...(eventType && { eventType }),
          ...(marketType && { marketType }),
        },
      })
      .then((r) => r.data.data),
};
