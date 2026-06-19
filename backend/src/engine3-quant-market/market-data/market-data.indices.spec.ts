import 'reflect-metadata';
import { MarketDataService } from './market-data.service';
import { MarketDataController } from './market-data.controller';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { StockQuoteService } from './stock-quote.service';
import { KisApiService } from './kis-api.service';

/**
 * DAR-160 회귀 가드: 시장지수 최신값 조회.
 * - 지수별 최근 2거래일(desc)로 전일대비 등락폭·등락률을 산출한다.
 * - 데이터가 없는 지수는 결과에서 생략(부분 표시), 1건뿐이면 등락 필드는 null.
 * - GET /market-data/indices/latest 는 게스트 열람 가능(메서드 OptionalJwtAuthGuard).
 */
describe('MarketDataService.fetchLatestIndices (DAR-160)', () => {
  function makeService(byCode: Record<string, Array<{ closeIndex: number; tradeDate: string }>>) {
    const findMany = jest.fn(async ({ where }: any) => {
      const rows = byCode[where.indexCode] ?? [];
      // 서비스는 orderBy desc·take 2 를 요청한다. 픽스처를 desc 로 정렬 후 슬라이스.
      return [...rows]
        .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1))
        .slice(0, 2)
        .map((r) => ({ ...r, indexCode: where.indexCode, indexName: where.indexCode === '0001' ? 'KOSPI' : 'KOSDAQ' }));
    });
    const prisma = { marketIndex: { findMany } } as unknown as PrismaService;
    return { service: new MarketDataService(prisma), findMany };
  }

  it('KOSPI·KOSDAQ 최신 종가와 전일대비 등락률을 산출한다', async () => {
    const { service } = makeService({
      '0001': [
        { closeIndex: 2700, tradeDate: '20260610' },
        { closeIndex: 2727, tradeDate: '20260611' }, // 최신: +27 / +1.0%
      ],
      '1001': [
        { closeIndex: 800, tradeDate: '20260610' },
        { closeIndex: 792, tradeDate: '20260611' }, // 최신: -8 / -1.0%
      ],
    });

    const res = await service.fetchLatestIndices();

    expect(res).toHaveLength(2);
    const kospi = res.find((r) => r.market === 'KOSPI')!;
    expect(kospi.indexCode).toBe('0001');
    expect(kospi.tradeDate).toBe('20260611');
    expect(kospi.closeIndex).toBe(2727);
    expect(kospi.prevCloseIndex).toBe(2700);
    expect(kospi.change).toBe(27);
    expect(kospi.changePercent).toBe(1);

    const kosdaq = res.find((r) => r.market === 'KOSDAQ')!;
    expect(kosdaq.change).toBe(-8);
    expect(kosdaq.changePercent).toBe(-1);
  });

  it('전일 데이터가 없으면(1건) 등락 필드는 null', async () => {
    const { service } = makeService({
      '0001': [{ closeIndex: 2700, tradeDate: '20260611' }],
      // 1001 미적재
    });

    const res = await service.fetchLatestIndices();

    expect(res).toHaveLength(1); // 미적재 KOSDAQ 는 생략
    expect(res[0].market).toBe('KOSPI');
    expect(res[0].closeIndex).toBe(2700);
    expect(res[0].prevCloseIndex).toBeNull();
    expect(res[0].change).toBeNull();
    expect(res[0].changePercent).toBeNull();
  });

  it('데이터가 전혀 없으면 빈 배열(배지 깨지지 않음)', async () => {
    const { service } = makeService({});
    const res = await service.fetchLatestIndices();
    expect(res).toEqual([]);
  });

  // DAR-367 표시 단계 방어선: 과거 오염 행이 전일 종가로 남아 -63.75% 같은 불가능한 등락률이
  // 산출되면 사용자에게 노출하지 않고 등락 필드를 모두 숨긴다(suspect=true).
  it('이슈 재현: close 3132 vs prevClose 8639(-63.75%) → 등락 미표시·suspect=true', async () => {
    const { service } = makeService({
      '0001': [
        { closeIndex: 8639.41, tradeDate: '20260604' }, // 과거 오염값
        { closeIndex: 3132.06, tradeDate: '20260605' }, // 최신(정상 종합지수)
      ],
    });

    const res = await service.fetchLatestIndices();
    const kospi = res.find((r) => r.market === 'KOSPI')!;

    expect(kospi.closeIndex).toBe(3132.06); // 최신 종가는 그대로 노출
    expect(kospi.suspect).toBe(true);
    expect(kospi.prevCloseIndex).toBeNull();
    expect(kospi.change).toBeNull(); // -63% 미표시
    expect(kospi.changePercent).toBeNull();
  });

  it('정상 등락은 suspect=false', async () => {
    const { service } = makeService({
      '0001': [
        { closeIndex: 2700, tradeDate: '20260610' },
        { closeIndex: 2727, tradeDate: '20260611' },
      ],
    });
    const res = await service.fetchLatestIndices();
    expect(res[0].suspect).toBe(false);
    expect(res[0].changePercent).toBe(1);
  });

  it('전일 종가 0 인 비정상 케이스는 등락률 null(0 나눗셈 회피)', async () => {
    const { service } = makeService({
      '0001': [
        { closeIndex: 0, tradeDate: '20260610' },
        { closeIndex: 2700, tradeDate: '20260611' },
      ],
    });
    const res = await service.fetchLatestIndices();
    expect(res[0].change).toBe(2700);
    expect(res[0].changePercent).toBeNull();
  });

  // DAR-170: EOD 데이터라 60s in-memory TTL 캐시로 홈 진입마다의 반복 DB 조회를 흡수한다.
  it('60s TTL 캐시: 윈도 내 재호출은 DB 재조회 없이 동일 결과를 반환', async () => {
    const { service, findMany } = makeService({
      '0001': [
        { closeIndex: 2700, tradeDate: '20260610' },
        { closeIndex: 2727, tradeDate: '20260611' },
      ],
    });

    const T0 = 1_000_000;
    const first = await service.fetchLatestIndices(T0);
    // KOSPI·KOSDAQ 각 1회 → 2회 DB 조회.
    expect(findMany).toHaveBeenCalledTimes(2);

    // TTL(60s) 내 재호출 → DB 추가 조회 0, 캐시된 동일 결과.
    const second = await service.fetchLatestIndices(T0 + 59_000);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
  });

  it('60s TTL 만료 후에는 DB 를 다시 조회한다', async () => {
    const { service, findMany } = makeService({
      '0001': [{ closeIndex: 2700, tradeDate: '20260611' }],
    });

    const T0 = 1_000_000;
    await service.fetchLatestIndices(T0);
    expect(findMany).toHaveBeenCalledTimes(2); // 0001 + 1001

    // 60s 경과(경계 초과) → 캐시 만료·재조회.
    await service.fetchLatestIndices(T0 + 60_000);
    expect(findMany).toHaveBeenCalledTimes(4);
  });
});

describe('MarketDataController.latestIndices (DAR-160)', () => {
  it('서비스 결과를 success 래핑한다', async () => {
    const quotes = [
      {
        indexCode: '0001',
        indexName: 'KOSPI',
        market: 'KOSPI' as const,
        tradeDate: '20260611',
        closeIndex: 2727,
        prevCloseIndex: 2700,
        change: 27,
        changePercent: 1,
      },
    ];
    const fetchLatestIndices = jest.fn().mockResolvedValue(quotes);
    const controller = new MarketDataController(
      {} as unknown as KrxMarketDataScheduler,
      {} as unknown as StockQuoteService,
      { fetchLatestIndices } as unknown as MarketDataService,
    );

    const res = await controller.latestIndices();

    expect(fetchLatestIndices).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ success: true, data: quotes });
  });

  it('지수 조회 핸들러는 게스트 열람 가능(OptionalJwtAuthGuard)', () => {
    const guards = Reflect.getMetadata('__guards__', MarketDataController.prototype.latestIndices) ?? [];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });
});

/**
 * DAR-371: KIS 실시간 지수 우선 + EOD 신선도 정직.
 * - KIS 가용 시 실시간 지수로 배지를 구동(source=REALTIME). stale 종가를 '현재'로 표시 금지.
 * - KIS 미설정/실패 시 EOD 일봉 폴백(source=EOD, tradeDate 가 종가 기준일).
 * - 실시간에도 ±20% sanity 가드(DAR-367) 유지.
 */
describe('MarketDataService.fetchLatestIndices — KIS 실시간 우선 (DAR-371)', () => {
  function makePrisma(byCode: Record<string, Array<{ closeIndex: number; tradeDate: string }>>) {
    const findMany = jest.fn(async ({ where }: any) => {
      const rows = byCode[where.indexCode] ?? [];
      return [...rows]
        .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1))
        .slice(0, 2)
        .map((r) => ({ ...r, indexCode: where.indexCode, indexName: where.indexCode === '0001' ? 'KOSPI' : 'KOSDAQ' }));
    });
    return { prisma: { marketIndex: { findMany } } as unknown as PrismaService, findMany };
  }

  function makeKis(opts: {
    configured: boolean;
    byCode?: Record<string, { price: number; prevClose: number; change: number; changePercent: number }>;
    throwOn?: string;
  }) {
    const fetchIndexPrice = jest.fn(async (code: string) => {
      if (opts.throwOn === code) throw new Error('boom');
      const v = opts.byCode?.[code];
      if (!v) return null;
      return { indexCode: code, open: v.price, high: v.price, low: v.price, ...v };
    });
    return {
      kis: { get isConfigured() { return opts.configured; }, fetchIndexPrice } as unknown as KisApiService,
      fetchIndexPrice,
    };
  }

  it('KIS 가용: 실시간 지수로 배지 구동(source=REALTIME)·DB 미조회', async () => {
    const { prisma, findMany } = makePrisma({ '0001': [{ closeIndex: 8160, tradeDate: '20260605' }] });
    const { kis } = makeKis({
      configured: true,
      byCode: {
        '0001': { price: 9033.15, prevClose: 9002.1, change: 31.05, changePercent: 0.34 },
        '1001': { price: 792, prevClose: 800, change: -8, changePercent: -1 },
      },
    });
    const service = new MarketDataService(prisma, kis);

    const res = await service.fetchLatestIndices(0);
    const kospi = res.find((r) => r.market === 'KOSPI')!;
    expect(kospi.source).toBe('REALTIME');
    expect(kospi.closeIndex).toBe(9033.15); // stale 8160 이 아니라 실시간 9033
    expect(kospi.changePercent).toBe(0.34);
    expect(kospi.suspect).toBe(false);
    expect(kospi.asOf).not.toBeNull();
    // 실시간으로 충족 → EOD DB 조회 안 함
    expect(findMany).not.toHaveBeenCalled();
  });

  it('KIS 미설정: EOD 일봉 폴백(source=EOD, asOf=null, tradeDate 가 종가 기준일)', async () => {
    const { prisma } = makePrisma({ '0001': [{ closeIndex: 8160.59, tradeDate: '20260605' }] });
    const { kis } = makeKis({ configured: false });
    const service = new MarketDataService(prisma, kis);

    const res = await service.fetchLatestIndices(0);
    const kospi = res.find((r) => r.market === 'KOSPI')!;
    expect(kospi.source).toBe('EOD');
    expect(kospi.asOf).toBeNull();
    expect(kospi.tradeDate).toBe('20260605');
    expect(kospi.closeIndex).toBe(8160.59);
  });

  it('KIS 실패(throw)·null → 해당 지수만 EOD 폴백(graceful)', async () => {
    const { prisma, findMany } = makePrisma({
      '0001': [{ closeIndex: 8160, tradeDate: '20260605' }],
      '1001': [{ closeIndex: 800, tradeDate: '20260605' }],
    });
    // 0001 은 throw, 1001 은 null → 둘 다 EOD 폴백
    const { kis } = makeKis({ configured: true, throwOn: '0001', byCode: {} });
    const service = new MarketDataService(prisma, kis);

    const res = await service.fetchLatestIndices(0);
    expect(res.every((r) => r.source === 'EOD')).toBe(true);
    expect(findMany).toHaveBeenCalled();
  });

  it('실시간 등락률 이상치(>±20%)는 suspect=true·등락 미표시(현재 지수는 노출)', async () => {
    const { prisma } = makePrisma({});
    const { kis } = makeKis({
      configured: true,
      // price 3132 vs prevClose 8639 → -63% (물리적 불가) → suspect
      byCode: { '0001': { price: 3132.06, prevClose: 8639.41, change: -5507.35, changePercent: -63.75 } },
    });
    const service = new MarketDataService(prisma, kis);

    const res = await service.fetchLatestIndices(0);
    const kospi = res.find((r) => r.market === 'KOSPI')!;
    expect(kospi.source).toBe('REALTIME');
    expect(kospi.closeIndex).toBe(3132.06);
    expect(kospi.suspect).toBe(true);
    expect(kospi.change).toBeNull();
    expect(kospi.changePercent).toBeNull();
    expect(kospi.prevCloseIndex).toBeNull();
  });
});
