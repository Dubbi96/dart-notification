// 회귀 안전망 (DAR-127): 가상 포트폴리오 — 가중평균 진입가·부분/전량 매도·실현손익·비중·결측가격.
// 기존 paper-portfolio.spec.ts 보완: 분기 경계(미보유 매도·전량청산 삭제·평가액 0 비중).
import { PaperPortfolio, TradeRecord } from './paper-portfolio';

const buy = (
  stockCode: string,
  filledShares: number,
  filledPrice: number,
  corpCode = `corp-${stockCode}`,
): TradeRecord => ({
  corpCode,
  stockCode,
  direction: 'BUY',
  filledShares,
  filledPrice,
  commission: 0,
  tax: 0,
  slippageCost: 0,
});

const sell = (stockCode: string, filledShares: number, filledPrice: number): TradeRecord => ({
  corpCode: `corp-${stockCode}`,
  stockCode,
  direction: 'SELL',
  filledShares,
  filledPrice,
  commission: 0,
  tax: 0,
  slippageCost: 0,
});

describe('PaperPortfolio (DAR-127 회귀 안전망)', () => {
  it('단순 매수 → 현금 차감·보유 생성', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade(buy('A', 10, 10_000));
    const s = p.getState({});
    expect(s.cash).toBe(900_000);
    expect(s.holdings).toHaveLength(1);
    expect(s.holdings[0].shares).toBe(10);
    expect(s.holdings[0].avgEntryPrice).toBe(10_000);
  });

  it('추가 매수 → 가중평균 진입가 갱신', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade(buy('A', 10, 10_000)); // 100,000
    p.applyTrade(buy('A', 10, 20_000)); // 200,000
    const s = p.getState({});
    expect(s.holdings[0].shares).toBe(20);
    expect(s.holdings[0].avgEntryPrice).toBe(15_000); // (10*10k + 10*20k)/20
  });

  it('비용(수수료·세금·슬리피지) 차감', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade({ ...buy('A', 10, 10_000), commission: 150, tax: 0, slippageCost: 50 });
    expect(p.getState({}).cash).toBe(1_000_000 - 100_000 - 200);
  });

  it('부분 매도 → 보유 잔량 유지·실현손익 반영', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade(buy('A', 10, 10_000));
    p.applyTrade(sell('A', 4, 15_000)); // 4주 차익 5,000원
    const s = p.getState({});
    expect(s.holdings[0].shares).toBe(6);
    expect(s.totalRealizedPnl).toBe(4 * (15_000 - 10_000));
    expect(s.cash).toBe(900_000 + 4 * 15_000);
  });

  it('전량 매도 → 보유 삭제(shares ≤ 0)', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade(buy('A', 10, 10_000));
    p.applyTrade(sell('A', 10, 12_000));
    const s = p.getState({});
    expect(s.holdings).toHaveLength(0);
    expect(s.totalRealizedPnl).toBe(10 * (12_000 - 10_000));
  });

  it('미보유 종목 매도 → 무시(no-op)', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade(sell('GHOST', 5, 10_000));
    const s = p.getState({});
    expect(s.cash).toBe(1_000_000);
    expect(s.holdings).toHaveLength(0);
    expect(s.totalRealizedPnl).toBe(0);
  });

  it('평가 시 priceMap 우선, 결측이면 평균 진입가로 폴백', () => {
    const p = new PaperPortfolio(1_000_000);
    p.applyTrade(buy('A', 10, 10_000));
    p.applyTrade(buy('B', 10, 10_000));
    const s = p.getState({ A: 12_000 }); // B는 결측 → 10,000 폴백
    const a = s.holdings.find((h) => h.stockCode === 'A')!;
    const b = s.holdings.find((h) => h.stockCode === 'B')!;
    expect(a.currentPrice).toBe(12_000);
    expect(a.unrealizedPnl).toBe(10 * (12_000 - 10_000));
    expect(b.currentPrice).toBe(10_000);
    expect(b.unrealizedPnl).toBe(0);
  });

  it('비중 = 보유 평가액 / 총평가액, 합 ≈ 1(현금 0일 때)', () => {
    const p = new PaperPortfolio(200_000);
    p.applyTrade(buy('A', 10, 10_000)); // 100,000
    p.applyTrade(buy('B', 10, 10_000)); // 100,000, 현금 0
    const s = p.getState({ A: 10_000, B: 10_000 });
    expect(s.cash).toBe(0);
    const totalWeight = s.holdings.reduce((sum, h) => sum + h.weight, 0);
    expect(totalWeight).toBeCloseTo(1);
  });

  it('총평가액 ≤ 0 → 비중 0(0/음수 나눗셈 방지)', () => {
    const p = new PaperPortfolio(0);
    // 현금 0에서 매수 → 현금 -100,000, 현재가 0 → 총평가 ≤ 0.
    p.applyTrade(buy('A', 10, 10_000));
    const s = p.getState({ A: 0 });
    expect(s.totalValue).toBeLessThanOrEqual(0);
    expect(s.holdings[0].weight).toBe(0);
  });
});
