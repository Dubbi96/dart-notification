import { useQuery } from '@tanstack/react-query';
import { eventStudyService } from '@services/event-study.service';

export function useCompanyEventStudy(
  corpCode: string,
  eventType?: string,
  marketType?: string,
) {
  return useQuery({
    queryKey: ['event-study', 'company', corpCode, eventType, marketType],
    queryFn: () => eventStudyService.getByCorpCode(corpCode, eventType, marketType),
    enabled: Boolean(corpCode),
  });
}

export function useEventStudyResults(eventType?: string, marketType?: string) {
  return useQuery({
    queryKey: ['event-study', eventType, marketType],
    queryFn: () => eventStudyService.getResults(eventType, marketType),
  });
}
