// fill-simulator.spec.ts — 체결 시뮬레이터 fixture 테스트 (M10-A, DAR-16)
import {
  simulateFill,
  DEFAULT_FILL_PARAMS,
  krxTickSize,
  roundToTick,
} from './domain/fill-simulator';
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
      expect(result.filledPrice).toBeGreaterThan(50000); // 슬리피지는 항상 비용(불변식)
      // F8: 50000×1.0005=50025 → KRX 100틱 올림(불리한 방향) → 50100. 호가단위 정수.
      expect(result.filledPrice).toBe(50100);
      expect(result.filledPrice % 100).toBe(0);
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
      expect(result.filledPrice).toBeLessThan(50000); // 슬리피지는 항상 비용(불변식)
      // F8: 50000×0.9995=49975 → KRX 50틱 내림(불리한 방향) → 49950. 호가단위 정수.
      expect(result.filledPrice).toBe(49950);
      expect(result.filledPrice % 50).toBe(0);
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

  // ── F8(2026-06-27): KRX 호가단위 정렬 ──
  describe('KRX 호가단위(krxTickSize/roundToTick)', () => {
    it('가격대별 호가단위 계단', () => {
      expect(krxTickSize(1999)).toBe(1);
      expect(krxTickSize(4999)).toBe(5);
      expect(krxTickSize(19999)).toBe(10);
      expect(krxTickSize(49999)).toBe(50);
      expect(krxTickSize(199999)).toBe(100);
      expect(krxTickSize(499999)).toBe(500);
      expect(krxTickSize(500001)).toBe(1000);
    });

    it('BUY 올림 / SELL 내림(불리한 방향)', () => {
      expect(roundToTick(50025, 'BUY')).toBe(50100); // 100틱 올림
      expect(roundToTick(49975, 'SELL')).toBe(49950); // 50틱 내림
      // 이미 호가단위 위면 불변
      expect(roundToTick(50000, 'BUY')).toBe(50000);
      expect(roundToTick(50000, 'SELL')).toBe(50000);
    });
  });

  // ── F8 Phase2(2026-06-27): 거래량 기반 동적 슬리피지·부분체결(매수 전용) ──
  describe('F8 Phase2 — 동적 슬리피지·부분체결', () => {
    it('소액 매수(참여율<<10%) → base 근처 슬리피지·전량체결(모의 규모 거동 ~불변)', () => {
      const r = simulateFill(
        { direction: 'BUY', orderedShares: 100, entryPrice: 50000, dayVolume: 10_000_000 },
        params,
      );
      expect(r.status).toBe('FILLED');
      expect(r.filledShares).toBe(100);
      expect(r.filledPrice).toBe(50100); // 임팩트 무시가능 → base+틱
    });

    it('중간 참여율(10% ADV) → 시장충격으로 슬리피지 상승(전량체결)', () => {
      const r = simulateFill(
        { direction: 'BUY', orderedShares: 100_000, entryPrice: 50000, dayVolume: 1_000_000 },
        params,
      );
      expect(r.status).toBe('FILLED');
      expect(r.filledShares).toBe(100_000);
      expect(r.filledPrice).toBeGreaterThan(50100); // base 대비 동적 슬리피지 상승
    });

    it('초과 참여율(>100% ADV) → 부분체결(가용 유동성까지)·강한 슬리피지', () => {
      const r = simulateFill(
        { direction: 'BUY', orderedShares: 2_000_000, entryPrice: 50000, dayVolume: 1_000_000 },
        params,
      );
      expect(r.status).toBe('PARTIAL');
      // 참여율 2.0 → liquidity 0.10/2.0=0.05 → floor(2,000,000×0.05)=100,000
      expect(r.filledShares).toBe(100_000);
      expect(r.filledPrice).toBeGreaterThan(50100);
    });

    it('매도는 dayVolume 무시(참여율 0) → base 슬리피지·전량체결(부분체결 미적용)', () => {
      const r = simulateFill(
        { direction: 'SELL', orderedShares: 2_000_000, entryPrice: 50000, dayVolume: 1_000_000 },
        params,
      );
      expect(r.status).toBe('FILLED');
      expect(r.filledShares).toBe(2_000_000);
      expect(r.filledPrice).toBe(49950); // SELL base floor
    });

    it('dayVolume 미제공 매수 → 기존 동작(전량·base)', () => {
      const r = simulateFill(
        { direction: 'BUY', orderedShares: 2_000_000, entryPrice: 50000 },
        params,
      );
      expect(r.status).toBe('FILLED');
      expect(r.filledShares).toBe(2_000_000);
      expect(r.filledPrice).toBe(50100);
    });
  });
});
