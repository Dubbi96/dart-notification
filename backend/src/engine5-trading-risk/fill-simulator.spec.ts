// fill-simulator.spec.ts — 체결 시뮬레이터 fixture 테스트 (M10-A, DAR-16)
import { simulateFill, DEFAULT_FILL_PARAMS } from './domain/fill-simulator';
import { FillParams } from './domain/paper-trade.types';

describe('FillSimulator', () => {
  const params = DEFAULT_FILL_PARAMS;

  describe('정상 매수 체결', () => {
    it('100% 유동성에서 완전 체결', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 1.0 },
        params,
      );
      expect(result.status).toBe('FILLED');
      expect(result.filledShares).toBe(100);
      expect(result.fillRate).toBe(1);
    });

    it('매수 시 슬리피지로 체결가가 기준가보다 높음', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 1.0 },
        params,
      );
      expect(result.filledPrice).toBeGreaterThan(50000);
      expect(result.filledPrice).toBeCloseTo(50000 * (1 + params.slippagePct), 2);
    });

    it('매수 시 세금 0', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 1.0 },
        params,
      );
      expect(result.tax).toBe(0);
    });

    it('수수료 계산 정확성', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 1.0 },
        params,
      );
      const expected = result.filledPrice * 100 * params.commissionRate;
      expect(result.commission).toBeCloseTo(expected, 4);
    });
  });

  describe('매도 체결', () => {
    it('매도 시 슬리피지로 체결가가 기준가보다 낮음', () => {
      const result = simulateFill(
        { direction: 'SELL', orderedShares: 100, entryPrice: 50000, liquidityRatio: 1.0 },
        params,
      );
      expect(result.filledPrice).toBeLessThan(50000);
      expect(result.filledPrice).toBeCloseTo(50000 * (1 - params.slippagePct), 2);
    });

    it('매도 시 세금 부과', () => {
      const result = simulateFill(
        { direction: 'SELL', orderedShares: 100, entryPrice: 50000, liquidityRatio: 1.0 },
        params,
      );
      expect(result.tax).toBeGreaterThan(0);
      const expected = result.filledPrice * 100 * params.sellTaxRate;
      expect(result.tax).toBeCloseTo(expected, 4);
    });
  });

  describe('부분 체결', () => {
    it('유동성 5% → 부분체결', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 0.05 },
        params,
      );
      expect(result.status).toBe('PARTIAL');
      expect(result.filledShares).toBe(5);
      expect(result.fillRate).toBeCloseTo(0.05, 4);
    });

    it('유동성 0% → 거부', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 0 },
        params,
      );
      expect(result.status).toBe('REJECTED');
      expect(result.filledShares).toBe(0);
    });

    it('유동성 10% (임계치 경계) → PARTIAL', () => {
      const testParams: FillParams = { ...params, partialFillThreshold: 0.1 };
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, liquidityRatio: 0.09 },
        testParams,
      );
      expect(result.status).toBe('PARTIAL');
    });

    it('유동성 미제공 시 기본 1.0 — 완전 체결', () => {
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000 },
        params,
      );
      expect(result.status).toBe('FILLED');
    });
  });

  describe('커스텀 파라미터', () => {
    it('수수료율 0 → 수수료 없음', () => {
      const zeroCommission: FillParams = { ...params, commissionRate: 0 };
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000 },
        zeroCommission,
      );
      expect(result.commission).toBe(0);
    });

    it('슬리피지 0 → 체결가 = 기준가', () => {
      const zeroSlippage: FillParams = { ...params, slippagePct: 0 };
      const result = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000 },
        zeroSlippage,
      );
      expect(result.filledPrice).toBe(50000);
      expect(result.slippageCost).toBe(0);
    });
  });
});
