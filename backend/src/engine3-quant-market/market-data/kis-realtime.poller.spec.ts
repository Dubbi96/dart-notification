/**
 * kis-realtime.poller.spec.ts — KIS 실시간 폴러 (DAR-140, DB/네트워크 미사용)
 *
 * 검증: 키 미설정 graceful no-op(실호출 0), 설정 시 유니버스 폴링→캐시 적재, 에러 흡수.
 */

import { KisRealtimePoller } from './kis-realtime.poller';
import { KisApiService } from './kis-api.service';
import { RealtimeQuoteCache } from './realtime-quote.cache';

function makePrisma(open: Array<{ corpCode: string; stockCode: string }>, signals: Array<{ corpCode: string; stockCode: string }>) {
  return {
    position: { findMany: jest.fn().mockResolvedValue(open) },
    tradingSignal: { findMany: jest.fn().mockResolvedValue(signals) },
  } as never;
}

describe('KisRealtimePoller (DAR-140)', () => {
  it('KIS 키 미설정이면 no-op(폴링/캐시 0·어댑터 미호출)', async () => {
    const kis = { isConfigured: false, fetchCurrentPrice: jest.fn() } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const res = await poller.pollRealtime();
    expect(res).toEqual({ polled: 0, cached: 0 });
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
    expect(cache.size()).toBe(0);
  });

  it('설정 시 보유+후보 유니버스를 폴링해 캐시에 corpCode 키로 적재', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async (stockCode: string) => ({
        stockCode, price: stockCode === '005930' ? 70000 : 23500, open: 1, high: 1, low: 1, volume: 100,
      })),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma(
      [{ corpCode: '00126380', stockCode: '005930' }],
      [{ corpCode: '00164779', stockCode: '000660' }],
    );
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const res = await poller.pollRealtime();
    expect(res.polled).toBe(2);
    expect(res.cached).toBe(2);
    expect(cache.getFresh('00126380')?.price).toBe(70000);
    expect(cache.getFresh('00164779')?.price).toBe(23500);
  });

  it('price<=0 행은 캐시 미적재', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async () => ({ stockCode: 's', price: 0, open: 0, high: 0, low: 0, volume: 0 })),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const res = await poller.pollRealtime();
    expect(res.cached).toBe(0);
    expect(cache.size()).toBe(0);
  });

  it('어댑터 throw 는 흡수(cron 유지)', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    await expect(poller.pollRealtime()).resolves.toEqual({ polled: 0, cached: 0 });
  });
});
