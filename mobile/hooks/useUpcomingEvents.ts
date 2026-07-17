import { useQuery } from '@tanstack/react-query';
import { upcomingEventsService } from '@services/upcomingEvents.service';

export const UPCOMING_EVENTS_KEY = ['upcoming-events'] as const;

// DAR-538: 관심기업 예정 이벤트 D-day 목록. 공시 파생 일정은 새 공시 수집 주기(분 단위)로만
// 변하고 D-day 기준일은 하루 단위라 30분 stale 허용.
export function useUpcomingEvents(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: UPCOMING_EVENTS_KEY,
    queryFn: () => upcomingEventsService.getList(),
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 30,
  });
}
