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

// DAR-98: AI 비용 거버넌스 4 엔드포인트 훅 (읽기전용)
export function useAiCostDaily(date?: string) {
  return useQuery({
    queryKey: ['ai-cost', 'daily', date ?? 'today'],
    queryFn: () => aiCostService.getDaily(date),
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAiCostMonthly(year?: number, month?: number) {
  return useQuery({
    queryKey: ['ai-cost', 'monthly', year ?? 'cur', month ?? 'cur'],
    queryFn: () => aiCostService.getMonthly(year, month),
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAiCostLimitStatus() {
  return useQuery({
    queryKey: ['ai-cost', 'limit-status'],
    queryFn: () => aiCostService.getLimitStatus(),
    retry: 1,
    staleTime: 60 * 1000,
  });
}

export function useAiCostCrossEngine(from?: string, to?: string) {
  return useQuery({
    queryKey: ['ai-cost', 'cross-engine', from ?? 'def', to ?? 'def'],
    queryFn: () => aiCostService.getCrossEngine(from, to),
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}
