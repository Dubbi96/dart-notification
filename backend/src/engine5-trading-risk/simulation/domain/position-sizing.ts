// 포지션 사이징 & 후보 선정 — 순수 Rule (M10, DAR-40)
// AI 금지영역: 매수 후보 필터·수량 결정은 순수 Rule. AI 개입 0.

import { BuyCandidate } from './simulation.types';
import { SimulationConfig } from './simulation.config';

/**
 * 1회 매수 수량 결정 (순수 함수).
 * 예산 = 포트폴리오 평가액 × singleBuyMaxPct. 진입가로 나눈 정수 주식수.
 * 진입가 ≤ 0 이거나 1주도 못 사면 0 반환(스킵).
 */
export function sizePosition(
  entryPrice: number,
  portfolioValue: number,
  config: Pick<SimulationConfig, 'singleBuyMaxPct'>,
): number {
  if (entryPrice <= 0 || portfolioValue <= 0) return 0;
  const budget = portfolioValue * config.singleBuyMaxPct;
  const shares = Math.floor(budget / entryPrice);
  return shares > 0 ? shares : 0;
}

/**
 * 매수 후보 선정 (순수 함수).
 * - 이미 보유 중인 종목(stockCode) 제외(중복 매수 금지).
 * - 후보 내 동일 종목 중복은 buyScore 최고 1건만.
 * - buyScore 내림차순 정렬 후 가용 슬롯(maxWatchlistSymbols - 현재 보유수) 만큼만.
 */
export function selectBuyCandidates(
  candidates: BuyCandidate[],
  heldStockCodes: string[],
  config: Pick<SimulationConfig, 'maxWatchlistSymbols'>,
): BuyCandidate[] {
  const held = new Set(heldStockCodes);
  const availableSlots = Math.max(0, config.maxWatchlistSymbols - held.size);
  if (availableSlots === 0) return [];

  // 동일 종목 중복은 최고 점수 1건만 유지
  const bestByStock = new Map<string, BuyCandidate>();
  for (const c of candidates) {
    if (held.has(c.stockCode)) continue;
    const existing = bestByStock.get(c.stockCode);
    if (!existing || c.buyScore > existing.buyScore) {
      bestByStock.set(c.stockCode, c);
    }
  }

  return [...bestByStock.values()]
    .sort((a, b) => b.buyScore - a.buyScore)
    .slice(0, availableSlots);
}

/** Exit 액션이 청산(완전 매도) 대상인지 — 순수 함수 */
export function shouldExit(exitAction: string): boolean {
  return exitAction === 'EXIT' || exitAction === 'BLOCK_REBUY';
}
