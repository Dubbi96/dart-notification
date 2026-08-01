import { useQuery } from '@tanstack/react-query';
import { aosAllocationService } from '@services/aosAllocation.service';

export function useAosAllocation(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['aos', 'allocation', 'summary'],
    queryFn: () => aosAllocationService.getSummary(),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
