import 'reflect-metadata';
import { MarketDataService } from './market-data.service';
import { MarketDataController } from './market-data.controller';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { StockQuoteService } from './stock-quote.service';

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
