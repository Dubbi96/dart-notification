import { useQuery } from '@tanstack/react-query';
import { aiCostService } from '@services/ai-cost.service';

export function useAiCostMetrics() {
  return useQuery({
    queryKey: ['ai-cost', 'metrics'],
    queryFn: () => aiCostService.getMetrics(),
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAiCostHealth() {
  return useQuery({
    queryKey: ['ai-cost', 'health'],
    queryFn: () => aiCostService.getHealth(),
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}
