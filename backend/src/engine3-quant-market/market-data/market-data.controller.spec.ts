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
import { StockMinutePriceCollector } from './stock-minute-price.collector';

/**
 * DAR-352: 분봉 엔드포인트 노출. quote 와 동일하게 게스트 열람(OptionalJwtAuthGuard) 이어야 하고,
 * stockCode 를 서비스에 위임해 success 래핑한다. DAR-377: tradeDate 옵션 위임 + 수동 수집 엔드포인트.
 */
describe('MarketDataController.getMinuteCandles (DAR-352·DAR-377)', () => {
  function makeController(result: MinuteCandlesResult) {
    const getMinuteCandles = jest.fn().mockResolvedValue(result);
    const stockQuote = { getMinuteCandles } as unknown as StockQuoteService;
    const collectOnce = jest.fn().mockResolvedValue({ candlesSaved: 0 });
    const minuteCollector = { collectOnce } as unknown as StockMinutePriceCollector;
    const controller = new MarketDataController(
      {} as unknown as KrxMarketDataScheduler,
      stockQuote,
      {} as unknown as MarketDataService,
      {} as unknown as CandleHistoryService,
      minuteCollector,
    );
    return { controller, getMinuteCandles, collectOnce };
  }

  const emptyResult: MinuteCandlesResult = {
    stockCode: '005930',
    source: 'UNAVAILABLE',
    asOf: '2026-06-19T00:00:00.000Z',
    tradeDate: null,
    candles: [],
  };

  it('minute-candles 메서드 가드가 OptionalJwtAuthGuard 여야 한다(게스트 401 금지)', () => {
    const { controller } = makeController(emptyResult);
    const guards =
      Reflect.getMetadata('__guards__', controller.getMinuteCandles) ?? [];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });

  it('stockCode·tradeDate 를 서비스에 위임하고 success 래핑한다', async () => {
    const { controller, getMinuteCandles } = makeController(emptyResult);

    const res = await controller.getMinuteCandles('005930', '20260620');

    expect(getMinuteCandles).toHaveBeenCalledWith('005930', { tradeDate: '20260620' });
    expect(res.success).toBe(true);
    expect(res.data).toBe(emptyResult);
  });

  it('stockCode 미전달 시 빈 문자열로 위임(500 금지)', async () => {
    const { controller, getMinuteCandles } = makeController(emptyResult);

    await controller.getMinuteCandles(undefined);

    expect(getMinuteCandles).toHaveBeenCalledWith('', { tradeDate: undefined });
  });

  it('collect/minute-prices 는 collector.collectOnce 에 cap·tradeDate 를 위임한다 (DAR-377)', async () => {
    const { controller, collectOnce } = makeController(emptyResult);

    await controller.collectMinutePrices('50', '20260620');

    expect(collectOnce).toHaveBeenCalledWith({ cap: 50, tradeDate: '20260620' });
  });

  it('collect/minute-prices cap 미전달 → undefined 위임(기본 cap 사용) (DAR-377)', async () => {
    const { controller, collectOnce } = makeController(emptyResult);

    await controller.collectMinutePrices(undefined, undefined);

    expect(collectOnce).toHaveBeenCalledWith({ cap: undefined, tradeDate: undefined });
  });
});

/**
 * 서비스 단위: KIS·저장분(StockMinutePrice) 목킹으로 정직(source/asOf/tradeDate) + graceful(빈배열)
 * 계약을 고정한다. 결정론: nowMs 주입으로 asOf 고정. DAR-377: STORED 서빙·폴백 경로 추가.
 */
describe('StockQuoteService.getMinuteCandles (DAR-352·DAR-377)', () => {
  const NOW = Date.UTC(2026, 5, 19, 1, 30, 0); // 2026-06-19T01:30:00Z
  const ASOF = new Date(NOW).toISOString();

  const sampleCandles: KisMinuteCandle[] = [
    { time: '090100', open: 100, high: 102, low: 99, close: 101, volume: 500 },
    { time: '090200', open: 101, high: 103, low: 100, close: 102, volume: 600 },
  ];

  /** 저장 행(findMany select 형태 — DAR-381 ts 스키마). volume 은 BigInt 컬럼이지만 Number() 변환 경로 검증 위해 number 사용. */
  const storedRows = [
    { ts: new Date(Date.UTC(2026, 5, 19, 9, 1)), openPrice: 100, highPrice: 102, lowPrice: 99, closePrice: 101, volume: 500 },
    { ts: new Date(Date.UTC(2026, 5, 19, 9, 2)), openPrice: 101, highPrice: 103, lowPrice: 100, closePrice: 102, volume: 600 },
  ];

  function makeService(opts: {
    kis?: Partial<KisApiService>;
    storedLatest?: { tradeDate: string | null; ts: Date } | null;
    storedRows?: typeof storedRows;
  } = {}) {
    const findFirst = jest.fn().mockResolvedValue(opts.storedLatest ?? null);
    const findMany = jest.fn().mockResolvedValue(opts.storedRows ?? []);
    const prisma = { stockMinutePrice: { findFirst, findMany } };
    const svc = new StockQuoteService(
      prisma as never,
      undefined,
      opts.kis as unknown as KisApiService,
    );
    return { svc, findFirst, findMany };
  }

  it('KIS 설정+캔들 반환 → source=KIS_REALTIME, asOf 고지, tradeDate=null, 캔들 그대로', async () => {
    const fetchMinuteCandles = jest.fn().mockResolvedValue(sampleCandles);
    const { svc } = makeService({ kis: { isConfigured: true, fetchMinuteCandles } });

    const res = await svc.getMinuteCandles('005930', { nowMs: NOW });

    expect(fetchMinuteCandles).toHaveBeenCalledWith('005930', '', NOW);
    expect(res.source).toBe('KIS_REALTIME');
    expect(res.asOf).toBe(ASOF);
    expect(res.tradeDate).toBeNull();
    expect(res.candles).toEqual(sampleCandles);
    expect(res.stockCode).toBe('005930');
  });

  it('KIS 미설정 + 저장분 없음 → 실 KIS호출 0, source=UNAVAILABLE 빈배열 graceful', async () => {
    const fetchMinuteCandles = jest.fn();
    const { svc } = makeService({ kis: { isConfigured: false, fetchMinuteCandles } });

    const res = await svc.getMinuteCandles('005930', { nowMs: NOW });

    expect(fetchMinuteCandles).not.toHaveBeenCalled();
    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
    expect(res.asOf).toBe(ASOF);
  });

  it('KIS 어댑터 미배선(undefined) + 저장분 없음 → 빈배열 graceful', async () => {
    const { svc } = makeService({});

    const res = await svc.getMinuteCandles('005930', { nowMs: NOW });

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
  });

  it('KIS 0행 + 저장분 없음 → source=UNAVAILABLE(빈배열)', async () => {
    const fetchMinuteCandles = jest.fn().mockResolvedValue([]);
    const { svc } = makeService({ kis: { isConfigured: true, fetchMinuteCandles } });

    const res = await svc.getMinuteCandles('005930', { nowMs: NOW });

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
  });

  it('6자리 아닌 종목코드 → KIS·저장 조회 없이 빈배열', async () => {
    const fetchMinuteCandles = jest.fn();
    const { svc, findFirst } = makeService({ kis: { isConfigured: true, fetchMinuteCandles } });

    const res = await svc.getMinuteCandles('12A', { nowMs: NOW });

    expect(fetchMinuteCandles).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
    expect(res.stockCode).toBe('12A');
  });

  it('fetchMinuteCandles throw(키 예외) + 저장분 없음 → 흡수해 빈배열 graceful', async () => {
    const fetchMinuteCandles = jest.fn().mockRejectedValue(new Error('KIS_APP_KEY 미설정'));
    const { svc } = makeService({ kis: { isConfigured: true, fetchMinuteCandles } });

    const res = await svc.getMinuteCandles('005930', { nowMs: NOW });

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
  });

  // ── DAR-377: 저장분(StockMinutePrice) 서빙·폴백 ──────────────────────────────

  it('tradeDate 지정 → KIS 호출 없이 저장분 STORED 서빙(시간 오름차순·tradeDate 고지)', async () => {
    const fetchMinuteCandles = jest.fn();
    const { svc, findMany } = makeService({
      kis: { isConfigured: true, fetchMinuteCandles },
      storedRows,
    });

    const res = await svc.getMinuteCandles('005930', { tradeDate: '20260619', nowMs: NOW });

    expect(fetchMinuteCandles).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stockCode: '005930', tradeDate: '20260619' } }),
    );
    expect(res.source).toBe('STORED');
    expect(res.tradeDate).toBe('20260619');
    expect(res.candles).toEqual([
      { time: '0901', open: 100, high: 102, low: 99, close: 101, volume: 500 }, // hhmmFromTs(09:01 UTC)
      { time: '0902', open: 101, high: 103, low: 100, close: 102, volume: 600 },
    ]);
  });

  it('tradeDate 지정인데 저장분 없음 → UNAVAILABLE(과거 분봉은 KIS 로 메우지 않음)', async () => {
    const fetchMinuteCandles = jest.fn();
    const { svc } = makeService({
      kis: { isConfigured: true, fetchMinuteCandles },
      storedRows: [],
    });

    const res = await svc.getMinuteCandles('005930', { tradeDate: '20260101', nowMs: NOW });

    expect(fetchMinuteCandles).not.toHaveBeenCalled();
    expect(res.source).toBe('UNAVAILABLE');
    expect(res.tradeDate).toBeNull();
    expect(res.candles).toEqual([]);
  });

  it('당일 KIS 0행 + 저장 최근일 존재 → STORED 폴백(최근 거래일 서빙)', async () => {
    const fetchMinuteCandles = jest.fn().mockResolvedValue([]);
    const { svc, findFirst } = makeService({
      kis: { isConfigured: true, fetchMinuteCandles },
      storedLatest: { tradeDate: '20260618', ts: new Date(Date.UTC(2026, 5, 18, 15, 30)) },
      storedRows,
    });

    const res = await svc.getMinuteCandles('005930', { nowMs: NOW });

    expect(fetchMinuteCandles).toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalled();
    expect(res.source).toBe('STORED');
    expect(res.tradeDate).toBe('20260618');
    expect(res.candles).toHaveLength(2);
  });
});
