/**
 * simulation-price-source.realtime.spec.ts — 실시간 우선 평가 (DAR-140, DB 미사용)
 *
 * 검증: 신선한 KIS 실시간 현재가가 일봉(REAL)/합성(SYNTHETIC)보다 우선(source=REALTIME),
 *   stale/미주입은 폴백, SYNTHETIC 전용 모드는 실시간 무시(순수 합성 보존), 정직 라벨.
 *   + 장외 게이트(2026-07): 정규장 밖에서 fetch 된 quote 는 REALTIME 으로 쓰지 않는다(오염 차단).
 */

import { SimulationPriceSourceService } from './simulation-price-source.service';
import { RealtimeQuoteCache } from '../../engine3-quant-market/market-data/realtime-quote.cache';

type AnyFn = jest.Mock;

// 결정론 시계: 정규장(금 12:00 KST) 고정 — quote fetchedAtMs(=Date.now())의 정규장 게이트와
// getFresh 신선도(TTL) 판정이 테스트 실행 시각(벽시계)에 좌우되지 않게 한다.
const MARKET_NOW = new Date('2026-06-19T03:00:00Z').getTime(); // KST 금 12:00 (장중)
const AFTER_HOURS_NOW = new Date('2026-06-19T10:30:00Z').getTime(); // KST 금 19:30 (장외)

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

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  delete process.env.PAPER_SIM_REAL_FEED;
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(MARKET_NOW);
});
afterEach(() => {
  if (ORIG.s === undefined) delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  else process.env.PAPER_SIM_SYNTHETIC_FEED = ORIG.s;
  if (ORIG.r === undefined) delete process.env.PAPER_SIM_REAL_FEED;
  else process.env.PAPER_SIM_REAL_FEED = ORIG.r;
  nowSpy.mockRestore();
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

  // ── 장외 게이트(2026-07): 장외 fetch 가 REALTIME 으로 둔갑하는 오염 차단 ──
  it('정규장 밖(19:30 KST)에서 fetch 된 quote 는 신선해도 REALTIME 으로 쓰지 않는다(REAL 폴백)', async () => {
    nowSpy.mockReturnValue(AFTER_HOURS_NOW); // 지금 = 장외 19:30
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache();
    freshQuote(cache, '00126380', 70500); // fetchedAtMs = Date.now() = 장외 → TTL 로는 신선
    (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 200, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000), tradeDate: '20260619',
    });
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    const row = await svc.latestPriceRow('00126380', '20260619');
    expect(row?.source).toBe('REAL'); // 장외 fetch 분은 REALTIME 으로 승격 금지
    expect(row?.closePrice).toBe(205);
  });
});

// ── 개장 체결기용 openRowForDate — '당일' 시가 행만 정직 반환(스테일 금지) ──
describe('SimulationPriceSourceService.openRowForDate — 당일 시가 행(체결기)', () => {
  it('신선한 실시간 quote 가 오늘 것이면 REALTIME 행(openPrice=당일 시가) 반환', async () => {
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache();
    freshQuote(cache, '00126380', 70500); // open = 70400 (freshQuote 규약: price-100)
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    const row = await svc.openRowForDate('00126380', '20260619'); // = 스파이 시각의 UTC 날짜
    expect(row?.source).toBe('REALTIME');
    expect(row?.openPrice).toBe(70400);
  });

  it('실시간 부재 + 당일 REAL 일봉 존재 → REAL 행 반환, 당일 행이 없으면(전일봉만) null(이월)', async () => {
    const prisma = makePrismaMock();
    const cache = new RealtimeQuoteCache(); // 비어있음
    const svc = new SimulationPriceSourceService(prisma as never, cache);

    // 당일(20260619) 일봉 존재 → 반환.
    (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 199, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000), tradeDate: '20260619',
    });
    const today = await svc.openRowForDate('00126380', '20260619');
    expect(today?.source).toBe('REAL');
    expect(today?.openPrice).toBe(199);

    // 최신 일봉이 전일(20260618)뿐 → '당일' 아님 → null(스테일 시가 체결 금지 — 호출측 이월).
    (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
      openPrice: 199, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000), tradeDate: '20260618',
    });
    const stale = await svc.openRowForDate('00126380', '20260619');
    expect(stale).toBeNull();
  });
});
