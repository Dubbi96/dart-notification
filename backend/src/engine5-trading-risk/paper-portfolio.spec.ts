// paper-portfolio.spec.ts — 가상 포트폴리오 fixture 테스트 (M10-A, DAR-16)
import { PaperPortfolio } from './domain/paper-portfolio';

describe('PaperPortfolio', () => {
  let portfolio: PaperPortfolio;

  beforeEach(() => {
    portfolio = new PaperPortfolio(10_000_000); // 1000만원 초기현금
  });

  describe('매수 후 상태', () => {
    it('매수 후 현금 감소·보유 종목 추가', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 70000,
        commission: 105,
        tax: 0,
        slippageCost: 35,
      });
      const state = portfolio.getState({ '005930': 72000 });
      expect(state.cash).toBeLessThan(10_000_000);
      expect(state.holdings).toHaveLength(1);
      expect(state.holdings[0].stockCode).toBe('005930');
      expect(state.holdings[0].shares).toBe(10);
    });

    it('현재가 상승 시 미실현 이익 양수', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 70000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({ '005930': 80000 });
      expect(state.holdings[0].unrealizedPnl).toBeCloseTo(100000, 0);
      expect(state.holdings[0].unrealizedPnlPct).toBeCloseTo(100000 / 700000, 4);
    });

    it('현재가 하락 시 미실현 손실 음수', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 70000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({ '005930': 60000 });
      expect(state.holdings[0].unrealizedPnl).toBeCloseTo(-100000, 0);
    });
  });

  describe('매도 후 상태', () => {
    it('매도 후 보유 소진 시 holdings 제거', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 70000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'SELL',
        filledShares: 10,
        filledPrice: 75000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({});
      expect(state.holdings).toHaveLength(0);
      expect(state.totalRealizedPnl).toBeCloseTo(50000, 0);
    });

    it('부분 매도 후 잔여 shares 정확', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 70000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'SELL',
        filledShares: 4,
        filledPrice: 75000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({ '005930': 75000 });
      expect(state.holdings[0].shares).toBe(6);
    });
  });

  describe('비중 계산', () => {
    it('단일 종목 비중 sum = totalMarketValue / totalValue', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 100,
        filledPrice: 70000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({ '005930': 70000 });
      const expectedWeight = state.totalMarketValue / state.totalValue;
      expect(state.holdings[0].weight).toBeCloseTo(expectedWeight, 4);
    });

    it('복수 종목 비중 합계 ≈ totalMarketValue / totalValue', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 50,
        filledPrice: 70000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      portfolio.applyTrade({
        corpCode: 'A000660',
        stockCode: '000660',
        direction: 'BUY',
        filledShares: 30,
        filledPrice: 100000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({ '005930': 70000, '000660': 100000 });
      const weightSum = state.holdings.reduce((s, h) => s + h.weight, 0);
      expect(weightSum).toBeCloseTo(state.totalMarketValue / state.totalValue, 4);
    });
  });

  describe('가중평균 진입가', () => {
    it('추가 매수 시 가중평균 갱신', () => {
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 60000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      portfolio.applyTrade({
        corpCode: 'A005930',
        stockCode: '005930',
        direction: 'BUY',
        filledShares: 10,
        filledPrice: 80000,
        commission: 0,
        tax: 0,
        slippageCost: 0,
      });
      const state = portfolio.getState({ '005930': 70000 });
      expect(state.holdings[0].avgEntryPrice).toBeCloseTo(70000, 0);
    });
  });
});
