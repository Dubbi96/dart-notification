/**
 * realtime-quote.cache.spec.ts — 실시간 현재가 캐시 (DAR-140, DB 미사용)
 *
 * 검증: corpCode 키 set/getFresh, 신선도(maxAge) 게이트(stale→null), 주입 now 결정성.
 */

import {
  RealtimeQuoteCache,
  RealtimeQuote,
  DEFAULT_REALTIME_MAX_AGE_MS,
} from './realtime-quote.cache';

function quote(corpCode: string, price: number, fetchedAtMs: number): RealtimeQuote {
  return { corpCode, stockCode: '005930', price, open: price, high: price, low: price, volume: 1000, fetchedAtMs };
}

describe('RealtimeQuoteCache (DAR-140)', () => {
  it('set 후 신선하면 getFresh 로 corpCode 키 조회', () => {
    const cache = new RealtimeQuoteCache();
    const now = 1_000_000;
    cache.set(quote('00126380', 23500, now));
    const got = cache.getFresh('00126380', now);
    expect(got?.price).toBe(23500);
    expect(got?.corpCode).toBe('00126380');
    expect(cache.size()).toBe(1);
  });

  it('maxAge 초과(stale)면 null — 오래된 값은 현재가로 미사용', () => {
    const cache = new RealtimeQuoteCache();
    const fetchedAt = 1_000_000;
    cache.set(quote('00126380', 23500, fetchedAt));
    const stale = fetchedAt + DEFAULT_REALTIME_MAX_AGE_MS + 1;
    expect(cache.getFresh('00126380', stale)).toBeNull();
    // 경계(정확히 maxAge)는 아직 유효
    expect(cache.getFresh('00126380', fetchedAt + DEFAULT_REALTIME_MAX_AGE_MS)?.price).toBe(23500);
  });

  it('미보유 종목은 null', () => {
    const cache = new RealtimeQuoteCache();
    expect(cache.getFresh('99999999', 1)).toBeNull();
  });

  it('동일 corpCode 재set 은 최신값으로 덮어쓴다', () => {
    const cache = new RealtimeQuoteCache();
    cache.set(quote('00126380', 23500, 1000));
    cache.set(quote('00126380', 24000, 2000));
    expect(cache.getFresh('00126380', 2000)?.price).toBe(24000);
    expect(cache.size()).toBe(1);
  });

  it('clear 는 캐시를 비운다', () => {
    const cache = new RealtimeQuoteCache();
    cache.set(quote('00126380', 23500, 1000));
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
