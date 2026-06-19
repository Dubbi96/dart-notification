import 'reflect-metadata';
import { MarketDataController } from './market-data.controller';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { MarketDataService } from './market-data.service';
import {
  StockQuoteService,
  MinuteCandlesResult,
} from './stock-quote.service';
import { KisApiService, KisMinuteCandle } from './kis-api.service';
import { CandleHistoryService } from './candle-history.service';

/**
 * DAR-352: 분봉 엔드포인트 노출. quote 와 동일하게 게스트 열람(OptionalJwtAuthGuard) 이어야 하고,
 * stockCode 를 서비스에 그대로 위임해 success 래핑한다. KIS 는 목킹한다.
 */
describe('MarketDataController.getMinuteCandles (DAR-352)', () => {
  function makeController(result: MinuteCandlesResult) {
    const getMinuteCandles = jest.fn().mockResolvedValue(result);
    const stockQuote = { getMinuteCandles } as unknown as StockQuoteService;
    const controller = new MarketDataController(
      {} as unknown as KrxMarketDataScheduler,
      stockQuote,
      {} as unknown as MarketDataService,
      {} as unknown as CandleHistoryService,
    );
    return { controller, getMinuteCandles };
  }

  const emptyResult: MinuteCandlesResult = {
    stockCode: '005930',
    source: 'UNAVAILABLE',
    asOf: '2026-06-19T00:00:00.000Z',
    candles: [],
  };

  it('minute-candles 메서드 가드가 OptionalJwtAuthGuard 여야 한다(게스트 401 금지)', () => {
    const { controller } = makeController(emptyResult);
    const guards =
      Reflect.getMetadata('__guards__', controller.getMinuteCandles) ?? [];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });

  it('stockCode 를 서비스에 위임하고 success 래핑한다', async () => {
    const { controller, getMinuteCandles } = makeController(emptyResult);

    const res = await controller.getMinuteCandles('005930');

    expect(getMinuteCandles).toHaveBeenCalledWith('005930');
    expect(res.success).toBe(true);
    expect(res.data).toBe(emptyResult);
  });

  it('stockCode 미전달 시 빈 문자열로 위임(500 금지)', async () => {
    const { controller, getMinuteCandles } = makeController(emptyResult);

    await controller.getMinuteCandles(undefined);

    expect(getMinuteCandles).toHaveBeenCalledWith('');
  });
});

/**
 * 서비스 단위: KIS 목킹으로 정직(source/asOf) + graceful(빈배열) 계약을 고정한다.
 * 결정론: nowMs 주입으로 asOf 고정.
 */
describe('StockQuoteService.getMinuteCandles (DAR-352)', () => {
  const NOW = Date.UTC(2026, 5, 19, 1, 30, 0); // 2026-06-19T01:30:00Z
  const ASOF = new Date(NOW).toISOString();

  const sampleCandles: KisMinuteCandle[] = [
    { time: '090100', open: 100, high: 102, low: 99, close: 101, volume: 500 },
    { time: '090200', open: 101, high: 103, low: 100, close: 102, volume: 600 },
  ];

  function makeService(kis?: Partial<KisApiService>) {
    // prisma·realtimeCache 는 분봉 경로에서 미사용 → 빈 객체로 충분.
    return new StockQuoteService(
      {} as never,
      undefined,
      kis as unknown as KisApiService,
    );
  }

  it('KIS 설정+캔들 반환 → source=KIS_REALTIME, asOf 고지, 캔들 그대로(오름차순)', async () => {
    const fetchMinuteCandles = jest.fn().mockResolvedValue(sampleCandles);
    const svc = makeService({ isConfigured: true, fetchMinuteCandles });

    const res = await svc.getMinuteCandles('005930', NOW);

    expect(fetchMinuteCandles).toHaveBeenCalledWith('005930', '', NOW);
    expect(res.source).toBe('KIS_REALTIME');
    expect(res.asOf).toBe(ASOF);
    expect(res.candles).toEqual(sampleCandles);
    expect(res.stockCode).toBe('005930');
  });

  it('KIS 미설정 → 실호출 0, source=UNAVAILABLE, 빈배열 graceful', async () => {
    const fetchMinuteCandles = jest.fn();
    const svc = makeService({ isConfigured: false, fetchMinuteCandles });

    const res = await svc.getMinuteCandles('005930', NOW);

    expect(fetchMinuteCandles).not.toHaveBeenCalled();
    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
    expect(res.asOf).toBe(ASOF);
  });

  it('KIS 어댑터 미배선(undefined) → 빈배열 graceful', async () => {
    const svc = makeService(undefined);

    const res = await svc.getMinuteCandles('005930', NOW);

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
  });

  it('장마감/실패로 0행 → source=UNAVAILABLE(빈배열)', async () => {
    const fetchMinuteCandles = jest.fn().mockResolvedValue([]);
    const svc = makeService({ isConfigured: true, fetchMinuteCandles });

    const res = await svc.getMinuteCandles('005930', NOW);

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
  });

  it('6자리 아닌 종목코드 → KIS 호출 없이 빈배열', async () => {
    const fetchMinuteCandles = jest.fn();
    const svc = makeService({ isConfigured: true, fetchMinuteCandles });

    const res = await svc.getMinuteCandles('12A', NOW);

    expect(fetchMinuteCandles).not.toHaveBeenCalled();
    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
    expect(res.stockCode).toBe('12A');
  });

  it('fetchMinuteCandles 가 throw(키 예외) → 흡수해 빈배열 graceful', async () => {
    const fetchMinuteCandles = jest
      .fn()
      .mockRejectedValue(new Error('KIS_APP_KEY 미설정'));
    const svc = makeService({ isConfigured: true, fetchMinuteCandles });

    const res = await svc.getMinuteCandles('005930', NOW);

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
  });
});
