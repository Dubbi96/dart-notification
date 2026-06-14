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

export interface ModelPriceResolution {
  /** 적용 단가(1K 토큰당). */
  price: { in: number; out: number };
  /** PRICE_PER_1K prefix 매칭 성공 여부. false면 DEFAULT_PRICE 폴백. */
  matched: boolean;
}

/**
 * 모델명을 PRICE_PER_1K prefix와 매칭해 단가를 해석한다.
 * 미매칭 시 DEFAULT_PRICE로 폴백하되 `matched=false`를 노출해
 * 호출부가 조용한 폴백을 감지·경보할 수 있게 한다(DAR-244).
 */
export function resolveModelPrice(model: string | undefined): ModelPriceResolution {
  const key = model ? Object.keys(PRICE_PER_1K).find((k) => model.startsWith(k)) : undefined;
  return key ? { price: PRICE_PER_1K[key], matched: true } : { price: DEFAULT_PRICE, matched: false };
}

/** PRICE_PER_1K에 단가가 등록된(prefix 매칭되는) 모델인지 여부. */
export function isPricedModel(model: string | undefined): boolean {
  return resolveModelPrice(model).matched;
}

export function estimateCostUsd(usage: TaskUsage): number {
  const { price } = resolveModelPrice(usage.model);
  return (usage.inputTokens / 1000) * price.in + (usage.outputTokens / 1000) * price.out;
}
