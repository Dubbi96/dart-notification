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

  // 종목별 보장 쿼리(DAR-170)를 충실히 흉내내는 mock: where.stockCode 단건으로 필터 후
  // tradeDate desc 정렬·take 슬라이스. (이전엔 in 쿼리 전역 take 한 번이라 고정 행을 반환했다.)
  function makeService(rows: any[], realtime?: RealtimeQuoteCache) {
    const prisma = {
      stockDailyPrice: {
        findMany: jest.fn(async ({ where, take }: any) =>
          rows
            .filter((r) => r.stockCode === where.stockCode)
            .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1))
            .slice(0, take),
        ),
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

  it('다건 종목을 종목별 보장 쿼리로 조회하고 stockCode 키 맵을 반환', async () => {
    const { service, findMany } = makeService(dailyRows);
    const result = await service.getQuotes(['005930', '000660'], NOW);

    // 종목별 보장 쿼리: 종목당 1회, where 는 단건 stockCode(전역 in·예산 공유 아님).
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls.map((c: any[]) => c[0].where)).toEqual([
      { stockCode: '005930' },
      { stockCode: '000660' },
    ]);
    expect(result['005930']!.price).toBe(121);
    expect(result['005930']!.changePercent).toBe(10);
    expect(result['000660']!.price).toBe(50);
    expect(result['000660']!.previousClose).toBeNull();
  });

  it('일부 종목이 최근일 결측이어도 각 종목 quote 를 보장(거래캘린더 불일치·DAR-170)', async () => {
    // 정상 종목 A(005930): 최근 12거래일(20260601~20260612) 보유.
    // 거래정지 종목 B(000660): 훨씬 과거 3거래일(20260101~20260103)만 보유.
    // 과거 버그: 단일 in 쿼리 + 전역 take(종목수×6=12)·tradeDate desc 였다면, 가장 최신 12행은
    // 전부 A 차지 → B 는 0행 → DB에 데이터가 있는데도 quote=null·스파크라인 결손으로 위장.
    const aRows = Array.from({ length: 12 }, (_, i) => ({
      stockCode: '005930',
      corpCode: 'C1',
      tradeDate: `202606${String(1 + i).padStart(2, '0')}`,
      closePrice: 100 + i,
    }));
    const bRows = [
      { stockCode: '000660', corpCode: 'C2', tradeDate: '20260101', closePrice: 40 },
      { stockCode: '000660', corpCode: 'C2', tradeDate: '20260102', closePrice: 42 },
      { stockCode: '000660', corpCode: 'C2', tradeDate: '20260103', closePrice: 44 },
    ];
    const { service, findMany } = makeService([...aRows, ...bRows]);

    const result = await service.getQuotes(['005930', '000660'], NOW);

    // 종목별 보장 쿼리라 종목당 자기 몫 take(6)로 조회 → 전역 예산 고갈 없음.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls.map((c: any[]) => c[0].where)).toEqual([
      { stockCode: '005930' },
      { stockCode: '000660' },
    ]);

    // 정상 종목 A: 최신 종가(20260612 = 111).
    expect(result['005930']!.price).toBe(111);
    expect(result['005930']!.tradeDate).toBe('20260612');

    // 결측 종목 B: 예산 고갈로 누락되지 않고 quote 가 보장된다.
    expect(result['000660']).not.toBeNull();
    expect(result['000660']!.price).toBe(44);
    expect(result['000660']!.tradeDate).toBe('20260103');
    expect(result['000660']!.sparkline).toEqual([40, 42, 44]);
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
