/**
 * etf-daily-source.spec.ts — ETF 일봉 소스 어댑터 (DAR-484 [견고화 W1·P10]).
 *
 * 검증: KisEtfDailySource 가 KisApiService 를 감싸 소스중립 EtfDailyBar 로 통과(isAvailable=키상태),
 *   KrxEtpDailySource 는 미구독(isAvailable=false)·호출 시 명시적 throw(401 사실 기록).
 */

import { KisEtfDailySource } from './kis-etf-daily.source';
import { KisApiService, KisDailyBar } from './kis-api.service';
import {
  KrxEtpDailySource,
  EtfEtpSourceNotSubscribedError,
} from './etf-daily-source';

function makeKis(configured: boolean, bars: KisDailyBar[] = []): KisApiService {
  return {
    get isConfigured() {
      return configured;
    },
    fetchDailyPrices: jest.fn().mockResolvedValue(bars),
  } as unknown as KisApiService;
}

describe('KisEtfDailySource (DAR-484)', () => {
  it('sourceName 은 KIS', () => {
    expect(new KisEtfDailySource(makeKis(true)).sourceName).toBe('KIS');
  });

  it('isAvailable 은 KIS 키 설정 상태를 따른다', () => {
    expect(new KisEtfDailySource(makeKis(true)).isAvailable()).toBe(true);
    expect(new KisEtfDailySource(makeKis(false)).isAvailable()).toBe(false);
  });

  it('fetchDailyBars 는 KisApiService.fetchDailyPrices 를 구간 인자로 호출하고 소스중립 형태로 반환', async () => {
    const kis = makeKis(true, [
      {
        tradeDate: '20260703',
        open: 10000,
        high: 10200,
        low: 9900,
        close: 10100,
        volume: 123456,
        tradingValue: 1_250_000_000,
      },
    ]);
    const src = new KisEtfDailySource(kis);
    const bars = await src.fetchDailyBars('069500', {
      startYmd: '20260624',
      endYmd: '20260703',
      nowMs: 42,
    });
    expect(kis.fetchDailyPrices).toHaveBeenCalledWith('069500', '20260624', '20260703', 42);
    expect(bars).toEqual([
      {
        tradeDate: '20260703',
        open: 10000,
        high: 10200,
        low: 9900,
        close: 10100,
        volume: 123456,
        tradingValue: 1_250_000_000,
      },
    ]);
  });
});

describe('KrxEtpDailySource (DAR-484 — 미구독 스텁)', () => {
  it('sourceName 은 KRX_ETP · isAvailable=false(401 미구독)', () => {
    const src = new KrxEtpDailySource();
    expect(src.sourceName).toBe('KRX_ETP');
    expect(src.isAvailable()).toBe(false);
  });

  it('fetchDailyBars 는 미구현 — 명시적 에러(조용한 빈 데이터 방지)', async () => {
    const src = new KrxEtpDailySource();
    await expect(
      src.fetchDailyBars('069500', { startYmd: '20260624', endYmd: '20260703' }),
    ).rejects.toBeInstanceOf(EtfEtpSourceNotSubscribedError);
  });
});
