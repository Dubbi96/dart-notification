import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { UpcomingEventsResult } from '@app-types/upcomingEvent.types';

// DAR-538: 관심기업 공시발 예정 이벤트 캘린더 (GET /upcoming-events, 인증 필요)
export const upcomingEventsService = {
  getList: (days?: number) =>
    api
      .get<ApiResponse<UpcomingEventsResult>>('/upcoming-events', {
        params: days !== undefined ? { days } : undefined,
      })
      .then((r) => r.data.data),
};
