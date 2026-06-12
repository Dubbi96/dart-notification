import type { ApiResponse } from '@app-types/api.types';
import type {
  EventStudyResult,
  EventStudyObservationsPage,
} from '@app-types/signal.types';

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

  /** 버킷 구성 개별 관측치 드릴다운 (DAR-166). bucketKey 의 표본을 페이지네이션으로 조회. */
  getObservations: (bucketKey: string, offset = 0, limit = 20) =>
    api
      .get<ApiResponse<EventStudyObservationsPage>>(
        `/event-study/${encodeURIComponent(bucketKey)}/observations`,
        { params: { offset, limit } },
      )
      .then((r) => r.data.data),
};
