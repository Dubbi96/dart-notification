import { TaskUsage } from '../types/ai-analyst.types';

/**
 * 토큰 → USD 비용 추정 (근사). 1K 토큰당 단가, 모델 prefix 매칭.
 * TODO(AI/DQ): 실제 사용 모델 단가로 확정. cc-engine-architecture §7 비용 목표.
 */
const PRICE_PER_1K: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-4o': { in: 0.0025, out: 0.01 },
  'claude-haiku': { in: 0.0008, out: 0.004 },
  'claude-sonnet': { in: 0.003, out: 0.015 },
};
const DEFAULT_PRICE = { in: 0.0005, out: 0.0015 };

export function estimateCostUsd(usage: TaskUsage): number {
  const key = Object.keys(PRICE_PER_1K).find((k) => usage.model?.startsWith(k));
  const price = key ? PRICE_PER_1K[key] : DEFAULT_PRICE;
  return (usage.inputTokens / 1000) * price.in + (usage.outputTokens / 1000) * price.out;
}
