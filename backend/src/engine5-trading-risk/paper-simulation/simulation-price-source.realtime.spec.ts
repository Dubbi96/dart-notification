/**
 * simulation-price-source.realtime.spec.ts — 실시간 우선 평가 (DAR-140, DB 미사용)
 *
 * 검증: 신선한 KIS 실시간 현재가가 일봉(REAL)/합성(SYNTHETIC)보다 우선(source=REALTIME),
 *   stale/미주입은 폴백, SYNTHETIC 전용 모드는 실시간 무시(순수 합성 보존), 정직 라벨.
 */

import { SimulationPriceSourceService } from './simulation-price-source.service';
import { RealtimeQuoteCache } from '../../engine3-quant-market/market-data/realtime-quote.cache';

type AnyFn = jest.Mock;

function makePrismaMock() {
  return {
    simulatedDailyPrice: { findFirst: jest.fn() },
    stockDailyPrice: { findFirst: jest.fn(), findMany: jest.fn() },
    position: { findMany: jest.fn() },
    tradingSignal: { findMany: jest.fn() },
  };
}

const ORIG = {
  s: process.env.PAPER_SIM_SYNTHETIC_FEED,
  r: process.env.PAPER_SIM_REAL_FEED,
};

beforeEach(() => {
  delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  delete process.env.PAPER_SIM_REAL_FEED;
});
afterEach(() => {
  if (ORIG.s === undefined) delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  else process.env.PAPER_SIM_SYNTHETIC_FEED = ORIG.s;
  if (ORIG.r === undefined) delete process.env.PAPER_SIM_REAL_FEED;
  else process.env.PAPER_SIM_REAL_FEED = ORIG.r;
  jest.clearAllMocks();
});

function freshQuote(cache: RealtimeQuoteCache, corpCode: string, price: number) {
  cache.set({
    corpCode, stockCode: '005930', price, open: price - 100, high: price + 100, low: price - 200,
    volume: 5000, fetchedAtMs: Date.now(),
  });
}

describe('SimulationPriceSourceService — 실시간 우선(DAR-140)', () => {
  it('REAL 모드: 신선한 실시간가가 일봉보다 우선(source=REALTIME·일봉 미조회)', async () => {
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache();
    freshQuote(cache, '00126380', 70500);
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    const row = await svc.latestPriceRow('00126380', '20260608');
    expect(row?.source).toBe('REALTIME');
    expect(row?.closePrice).toBe(70500);
    // 실시간이 우선이라 일봉 테이블은 조회조차 안 한다.
    expect(prisma.stockDailyPrice.findFirst).not.toHaveBeenCalled();
  });

  it('실시간 미보유면 일봉(REAL)으로 폴백', async () => {
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache(); // 비어있음
    (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 200, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000), tradeDate: '20260601',
    });
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    const row = await svc.latestPriceRow('00126380', '20260608');
    expect(row?.source).toBe('REAL');
    expect(row?.closePrice).toBe(205);
  });

  it('stale 실시간가는 무시하고 폴백', async () => {
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache();
    cache.set({
      corpCode: '00126380', stockCode: '005930', price: 99999, open: 1, high: 1, low: 1, volume: 1,
      fetchedAtMs: Date.now() - 60 * 60_000, // 1시간 전 = stale
    });
    (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 200, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000), tradeDate: '20260601',
    });
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    const row = await svc.latestPriceRow('00126380', '20260608');
    expect(row?.source).toBe('REAL');
    expect(row?.closePrice).toBe(205);
  });

  it('SYNTHETIC 전용 모드는 실시간 무시(순수 합성 보존)', async () => {
    process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache();
    freshQuote(cache, '00126380', 70500);
    (prisma.simulatedDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 100, highPrice: 110, lowPrice: 90, closePrice: 105, volume: BigInt(1000), tradeDate: '20260608',
    });
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    const row = await svc.latestPriceRow('00126380', '20260608');
    expect(row?.source).toBe('SYNTHETIC');
    expect(row?.closePrice).toBe(105);
  });

  it('캐시 미주입(@Optional 미존재)이면 기존 동작(폴백)·회귀 0', async () => {
    const prisma = makePrismaMock();
    (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 200, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000), tradeDate: '20260601',
    });
    const svc = new SimulationPriceSourceService(prisma as never); // 캐시 미주입

    const row = await svc.latestPriceRow('00126380', '20260608');
    expect(row?.source).toBe('REAL');
    expect(row?.closePrice).toBe(205);
  });
});
