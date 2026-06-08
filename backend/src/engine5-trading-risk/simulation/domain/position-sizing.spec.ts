// 회귀 안전망 (DAR-127): 포지션 사이징·매수후보 선정(중복 매수 금지·동일종목 dedup·슬롯 제한).
// 순수 Rule. 모의운용 진입 경로의 dedup·수량 회귀 방어.
import { sizePosition, selectBuyCandidates, shouldExit } from './position-sizing';
import { BuyCandidate } from './simulation.types';

const cand = (stockCode: string, buyScore: number, id = stockCode): BuyCandidate => ({
  tradingSignalId: `sig-${id}`,
  rcpNo: `rcp-${id}`,
  corpCode: `corp-${stockCode}`,
  stockCode,
  signal: 'BUY_CANDIDATE',
  buyScore,
  entryPrice: 10_000,
});

describe('sizePosition (DAR-127)', () => {
  it('예산 = 평가액×singleBuyMaxPct, 진입가로 나눈 정수 주식수', () => {
    // 1,000,000 × 0.03 = 30,000 budget / 10,000 = 3주
    expect(sizePosition(10_000, 1_000_000, { singleBuyMaxPct: 0.03 })).toBe(3);
  });
  it('정수 내림(소수 절사)', () => {
    // 30,000 / 7,000 = 4.28 → 4주
    expect(sizePosition(7_000, 1_000_000, { singleBuyMaxPct: 0.03 })).toBe(4);
  });
  it('1주도 못 사면 0', () => {
    expect(sizePosition(50_000, 1_000_000, { singleBuyMaxPct: 0.03 })).toBe(0);
  });
  it('진입가 ≤ 0 → 0', () => {
    expect(sizePosition(0, 1_000_000, { singleBuyMaxPct: 0.03 })).toBe(0);
    expect(sizePosition(-100, 1_000_000, { singleBuyMaxPct: 0.03 })).toBe(0);
  });
  it('포트폴리오 평가액 ≤ 0 → 0', () => {
    expect(sizePosition(10_000, 0, { singleBuyMaxPct: 0.03 })).toBe(0);
  });
});

describe('selectBuyCandidates (DAR-127 dedup·슬롯)', () => {
  const config = { maxWatchlistSymbols: 3 };

  it('이미 보유 중인 종목은 후보에서 제외(중복 매수 금지)', () => {
    const result = selectBuyCandidates([cand('A', 90), cand('B', 80)], ['A'], config);
    expect(result.map((c) => c.stockCode)).toEqual(['B']);
  });

  it('후보 내 동일 종목 중복은 buyScore 최고 1건만', () => {
    const result = selectBuyCandidates(
      [cand('A', 70, 'a1'), cand('A', 95, 'a2'), cand('A', 60, 'a3')],
      [],
      config,
    );
    expect(result).toHaveLength(1);
    expect(result[0].buyScore).toBe(95);
    expect(result[0].tradingSignalId).toBe('sig-a2');
  });

  it('buyScore 내림차순 정렬', () => {
    const result = selectBuyCandidates(
      [cand('A', 50), cand('B', 90), cand('C', 70)],
      [],
      config,
    );
    expect(result.map((c) => c.stockCode)).toEqual(['B', 'C', 'A']);
  });

  it('가용 슬롯 = maxWatchlistSymbols - 현재 보유수 만큼만', () => {
    // max 3, 보유 1(X) → 슬롯 2
    const result = selectBuyCandidates(
      [cand('A', 90), cand('B', 80), cand('C', 70)],
      ['X'],
      config,
    );
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.stockCode)).toEqual(['A', 'B']);
  });

  it('가용 슬롯 0 → 빈 배열(보유가 한도 이상)', () => {
    expect(selectBuyCandidates([cand('A', 90)], ['X', 'Y', 'Z'], config)).toEqual([]);
  });

  it('빈 후보 → 빈 배열', () => {
    expect(selectBuyCandidates([], [], config)).toEqual([]);
  });
});

describe('shouldExit (DAR-127)', () => {
  it.each([
    ['EXIT', true],
    ['BLOCK_REBUY', true],
    ['HOLD', false],
    ['WATCH', false],
    ['REDUCE', false],
    ['', false],
  ])('action=%p → %p', (action, expected) => {
    expect(shouldExit(action)).toBe(expected);
  });
});
