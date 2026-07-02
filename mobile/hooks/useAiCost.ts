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
// DAR-471: AI 비용 화면 '고급/거버넌스' 블록은 기본 접힘 → 펼칠 때만 발화하도록 enabled 게이팅 위임.
//   options.enabled 미지정 시 기존 동작(즉시 조회) 보존.
interface AiCostQueryOptions {
  enabled?: boolean;
}

export function useAiCostDaily(date?: string, options?: AiCostQueryOptions) {
  return useQuery({
    queryKey: ['ai-cost', 'daily', date ?? 'today'],
    queryFn: () => aiCostService.getDaily(date),
    enabled: options?.enabled ?? true,
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAiCostMonthly(year?: number, month?: number, options?: AiCostQueryOptions) {
  return useQuery({
    queryKey: ['ai-cost', 'monthly', year ?? 'cur', month ?? 'cur'],
    queryFn: () => aiCostService.getMonthly(year, month),
    enabled: options?.enabled ?? true,
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAiCostLimitStatus(options?: AiCostQueryOptions) {
  return useQuery({
    queryKey: ['ai-cost', 'limit-status'],
    queryFn: () => aiCostService.getLimitStatus(),
    enabled: options?.enabled ?? true,
    retry: 1,
    staleTime: 60 * 1000,
  });
}

export function useAiCostCrossEngine(from?: string, to?: string, options?: AiCostQueryOptions) {
  return useQuery({
    queryKey: ['ai-cost', 'cross-engine', from ?? 'def', to ?? 'def'],
    queryFn: () => aiCostService.getCrossEngine(from, to),
    enabled: options?.enabled ?? true,
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });
}
