import {
  buildQuote,
  StockQuoteService,
  MAX_QUOTE_STOCK_CODES,
} from './stock-quote.service';
import { RealtimeQuoteCache } from './realtime-quote.cache';

describe('buildQuote (순수 합성)', () => {
  const rowsAsc = [
    { corpCode: 'C1', tradeDate: '20260601', closePrice: 100 },
    { corpCode: 'C1', tradeDate: '20260602', closePrice: 110 },
    { corpCode: 'C1', tradeDate: '20260603', closePrice: 121 },
  ];

  it('일봉만: 최신 종가·전일대비%·스파크라인을 산출한다', () => {
    const q = buildQuote('005930', rowsAsc, null);
    expect(q).not.toBeNull();
    expect(q!.source).toBe('DAILY');
    expect(q!.price).toBe(121);
    expect(q!.previousClose).toBe(110);
    expect(q!.change).toBe(11);
    expect(q!.changePercent).toBe(10); // (121-110)/110 = 10.00%
    expect(q!.tradeDate).toBe('20260603');
    expect(q!.corpCode).toBe('C1');
    expect(q!.sparkline).toEqual([100, 110, 121]);
  });

  it('실시간이 있으면 현재가 우선, 직전 기준은 최신 일봉 종가', () => {
    const q = buildQuote('005930', rowsAsc, 133.1);
    expect(q!.source).toBe('REALTIME');
    expect(q!.price).toBe(133.1);
    expect(q!.previousClose).toBe(121);
    expect(q!.changePercent).toBe(10); // (133.1-121)/121 = 10.00%
  });

  it('일봉이 1행뿐이면 전일대비는 null, 가격/스파크라인은 유지', () => {
    const q = buildQuote('005930', [rowsAsc[0]], null);
    expect(q!.price).toBe(100);
    expect(q!.previousClose).toBeNull();
    expect(q!.change).toBeNull();
    expect(q!.changePercent).toBeNull();
    expect(q!.sparkline).toEqual([100]);
  });

  it('스파크라인은 최근 5개로 잘린다', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      corpCode: 'C1',
      tradeDate: `2026060${i}`,
      closePrice: 100 + i,
    }));
    const q = buildQuote('005930', many, null);
    expect(q!.sparkline).toEqual([103, 104, 105, 106, 107]);
  });

  it('일봉이 없으면 null(배지 미표시)', () => {
    expect(buildQuote('005930', [], 999)).toBeNull();
  });

  it('실시간가가 0 이하이면 무시하고 일봉 폴백', () => {
    const q = buildQuote('005930', rowsAsc, 0);
    expect(q!.source).toBe('DAILY');
    expect(q!.price).toBe(121);
  });
});

describe('StockQuoteService.getQuotes', () => {
  const NOW = 1_000_000;

  function makeService(rows: any[], realtime?: RealtimeQuoteCache) {
    const prisma = {
      stockDailyPrice: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as any;
    return {
      service: new StockQuoteService(prisma, realtime),
      findMany: prisma.stockDailyPrice.findMany,
    };
  }

  const dailyRows = [
    // 005930: 두 날 (desc 정렬로 전달)
    { stockCode: '005930', corpCode: 'C1', tradeDate: '20260603', closePrice: 121 },
    { stockCode: '005930', corpCode: 'C1', tradeDate: '20260602', closePrice: 110 },
    // 000660: 한 날
    { stockCode: '000660', corpCode: 'C2', tradeDate: '20260603', closePrice: 50 },
  ];

  it('다건 종목을 단일 in 쿼리로 조회하고 stockCode 키 맵을 반환', async () => {
    const { service, findMany } = makeService(dailyRows);
    const result = await service.getQuotes(['005930', '000660'], NOW);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      stockCode: { in: ['005930', '000660'] },
    });
    expect(result['005930']!.price).toBe(121);
    expect(result['005930']!.changePercent).toBe(10);
    expect(result['000660']!.price).toBe(50);
    expect(result['000660']!.previousClose).toBeNull();
  });

  it('데이터 없는 종목은 null 로 흡수', async () => {
    const { service } = makeService(dailyRows);
    const result = await service.getQuotes(['005930', '999999'], NOW);
    expect(result['999999']).toBeNull();
  });

  it('신선한 실시간 캐시가 있으면 REALTIME 우선', async () => {
    const cache = new RealtimeQuoteCache();
    cache.set({
      corpCode: 'C1',
      stockCode: '005930',
      price: 130,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      fetchedAtMs: NOW, // 신선
    });
    const { service } = makeService(dailyRows, cache);
    const result = await service.getQuotes(['005930'], NOW);
    expect(result['005930']!.source).toBe('REALTIME');
    expect(result['005930']!.price).toBe(130);
  });

  it('오래된 실시간 캐시는 무시하고 일봉 폴백', async () => {
    const cache = new RealtimeQuoteCache();
    cache.set({
      corpCode: 'C1',
      stockCode: '005930',
      price: 130,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      fetchedAtMs: NOW - 10 * 60_000, // 10분 전 → stale
    });
    const { service } = makeService(dailyRows, cache);
    const result = await service.getQuotes(['005930'], NOW);
    expect(result['005930']!.source).toBe('DAILY');
    expect(result['005930']!.price).toBe(121);
  });

  it('잘못된 종목코드(비6자리)·중복은 정규화로 제거, 빈 입력은 쿼리 미실행', async () => {
    const { service, findMany } = makeService([]);
    const result = await service.getQuotes(['abc', '005930', '005930', '12345'], NOW);
    expect(Object.keys(result)).toEqual(['005930']);
    expect(findMany).toHaveBeenCalledTimes(1);

    const empty = makeService([]);
    const r2 = await empty.service.getQuotes([], NOW);
    expect(r2).toEqual({});
    expect(empty.findMany).not.toHaveBeenCalled();
  });

  it('최대 종목 수를 넘는 입력은 제한된다', async () => {
    const { service } = makeService([]);
    const codes = Array.from({ length: MAX_QUOTE_STOCK_CODES + 10 }, (_, i) =>
      String(100000 + i),
    );
    const result = await service.getQuotes(codes, NOW);
    expect(Object.keys(result).length).toBe(MAX_QUOTE_STOCK_CODES);
  });
});
