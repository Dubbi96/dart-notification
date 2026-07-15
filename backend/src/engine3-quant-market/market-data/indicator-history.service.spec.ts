import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { IndicatorHistoryService } from './indicator-history.service';
import { MarketDataController } from './market-data.controller';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { MarketDataService } from './market-data.service';
import { StockQuoteService } from './stock-quote.service';
import { CandleHistoryService } from './candle-history.service';
import { StockMinutePriceCollector } from './stock-minute-price.collector';

/**
 * W13: GET /market-data/indicators 서비스·컨트롤러 배선 단위 테스트.
 * - 정직 계약: source=EOD, asOf(nowMs 주입 결정론), latestTradeDate(지표 기준일 — 구간 무관 최신),
 *   오름차순 반환, 페이지 가득 찼을 때만 nextCursor.
 * - graceful: 조회 실패 → UNAVAILABLE 빈 배열(500 금지), nullable 필드 그대로 통과(계산·보정 금지).
 * - 컨트롤러: 게스트 열람(OptionalJwtAuthGuard), 파라미터 위임+success 래핑, 검증 실패 → 400.
 */
describe('IndicatorHistoryService.getIndicators (W13)', () => {
  const NOW = Date.UTC(2026, 6, 15, 1, 0, 0); // 2026-07-15T01:00:00Z
  const ASOF = new Date(NOW).toISOString();

  /** newest-first 저장 행(서비스가 DESC 조회하는 형태). */
  const row = (tradeDate: string, over: Record<string, unknown> = {}) => ({
    tradeDate,
    ma5: 100,
    ma20: 98,
    ma60: 95,
    ma120: 90,
    rsi14: 55.5,
    macdLine: 1.2,
    macdSignal: 0.8,
    macdHistogram: 0.4,
    bollingerUpper: 110,
    bollingerMid: 100,
    bollingerLower: 90,
    atr14: 3.2,
    vwap: 99.5,
    volumeRatio20: 1.8,
    high52w: 120,
    low52w: 70,
    preDsclReturn: 2.5,
    ...over,
  });

  function makeService(opts: {
    rows?: ReturnType<typeof row>[];
    latest?: { tradeDate: string } | null;
    reject?: boolean;
  } = {}) {
    const findMany = opts.reject
      ? jest.fn().mockRejectedValue(new Error('relation missing'))
      : jest.fn().mockResolvedValue(opts.rows ?? []);
    const findFirst = jest.fn().mockResolvedValue(opts.latest ?? null);
    const prisma = { technicalIndicator: { findMany, findFirst } };
    const svc = new IndicatorHistoryService(prisma as never);
    return { svc, findMany, findFirst };
  }

  it('newest-first 조회를 오름차순으로 뒤집고 source=EOD·asOf·latestTradeDate 를 고지한다', async () => {
    const { svc, findMany } = makeService({
      rows: [row('20260714'), row('20260713')],
      latest: { tradeDate: '20260714' },
    });

    const res = await svc.getIndicators({ stockCode: '005930' }, NOW);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCode: '005930' },
        orderBy: { tradeDate: 'desc' },
        take: 200,
      }),
    );
    expect(res.source).toBe('EOD');
    expect(res.asOf).toBe(ASOF);
    expect(res.latestTradeDate).toBe('20260714');
    expect(res.count).toBe(2);
    expect(res.points.map((p) => p.tradeDate)).toEqual(['20260713', '20260714']);
    // 1d 캔들과 동일 time 규약(거래일 자정 UTC ISO) — tradeDate 조인 정합.
    expect(res.points[0].time).toBe('2026-07-13T00:00:00.000Z');
    expect(res.points[1].rsi14).toBe(55.5);
    expect(res.points[1].volumeRatio20).toBe(1.8);
    expect(res.points[1].preDsclReturn).toBe(2.5);
  });

  it('from/to/before 는 KST 거래일 문자열 필터(gte/lte/lt)로 위임된다(기간 제한)', async () => {
    const { svc, findMany } = makeService({ rows: [] });

    await svc.getIndicators(
      {
        stockCode: '005930',
        from: '20260101',
        to: '20260630',
        before: '20260401',
        limit: '50',
      },
      NOW,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stockCode: '005930',
          tradeDate: { gte: '20260101', lte: '20260630', lt: '20260401' },
        },
        take: 50,
      }),
    );
  });

  it('페이지가 가득 찼을 때만 nextCursor(가장 오래된 거래일 ISO) — 캔들 계약 동일', async () => {
    const { svc } = makeService({
      rows: [row('20260714'), row('20260713')],
      latest: { tradeDate: '20260714' },
    });

    const full = await svc.getIndicators({ stockCode: '005930', limit: 2 }, NOW);
    expect(full.nextCursor).toBe('2026-07-13T00:00:00.000Z');

    const partial = await svc.getIndicators({ stockCode: '005930', limit: 5 }, NOW);
    expect(partial.nextCursor).toBeNull();
  });

  it('nullable 지표 필드는 계산·보정 없이 그대로 통과한다(빈 값은 모바일이 — 처리)', async () => {
    const { svc } = makeService({
      rows: [row('20260714', { rsi14: null, preDsclReturn: null, ma20: null })],
      latest: { tradeDate: '20260714' },
    });

    const res = await svc.getIndicators({ stockCode: '005930' }, NOW);

    expect(res.points[0].rsi14).toBeNull();
    expect(res.points[0].preDsclReturn).toBeNull();
    expect(res.points[0].ma20).toBeNull();
    expect(res.points[0].ma5).toBe(100);
  });

  it('latestTradeDate 는 조회 구간과 무관한 종목 전체 최신(지표 기준일 — T+1 stale 고지 근거)', async () => {
    const { svc, findFirst } = makeService({
      rows: [row('20260301')],
      latest: { tradeDate: '20260714' },
    });

    const res = await svc.getIndicators(
      { stockCode: '005930', from: '20260201', to: '20260301' },
      NOW,
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCode: '005930' },
        orderBy: { tradeDate: 'desc' },
      }),
    );
    expect(res.latestTradeDate).toBe('20260714');
  });

  it('조회 실패 → source=UNAVAILABLE 빈 배열 graceful(500 금지)', async () => {
    const { svc } = makeService({ reject: true });

    const res = await svc.getIndicators({ stockCode: '005930' }, NOW);

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.points).toEqual([]);
    expect(res.latestTradeDate).toBeNull();
    expect(res.nextCursor).toBeNull();
    expect(res.asOf).toBe(ASOF);
  });

  it('형식 불량 tradeDate 행은 방어적으로 제외한다(빈 오버레이 graceful)', async () => {
    const { svc } = makeService({
      rows: [row('20260714'), row('bad-date')],
      latest: { tradeDate: '20260714' },
    });

    const res = await svc.getIndicators({ stockCode: '005930' }, NOW);

    expect(res.count).toBe(1);
    expect(res.points[0].tradeDate).toBe('20260714');
  });
});

describe('MarketDataController.getIndicators (W13)', () => {
  function makeController(svc: Partial<IndicatorHistoryService>) {
    return new MarketDataController(
      {} as unknown as KrxMarketDataScheduler,
      {} as unknown as StockQuoteService,
      {} as unknown as MarketDataService,
      {} as unknown as CandleHistoryService,
      {} as unknown as StockMinutePriceCollector,
      {} as never, // EtfDailyBackfillService (이 테스트에서 미사용)
      svc as unknown as IndicatorHistoryService,
    );
  }

  it('indicators 메서드 가드가 OptionalJwtAuthGuard 여야 한다(게스트 401 금지 — quote/candles 동일)', () => {
    const controller = makeController({});
    const guards =
      Reflect.getMetadata('__guards__', controller.getIndicators) ?? [];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });

  it('쿼리 파라미터를 서비스에 위임하고 success 래핑한다', async () => {
    const result = { stockCode: '005930', source: 'EOD', points: [] };
    const getIndicators = jest.fn().mockResolvedValue(result);
    const controller = makeController({ getIndicators } as never);

    const res = await controller.getIndicators(
      '005930',
      '20260101',
      '20260630',
      '20260401',
      '100',
    );

    expect(getIndicators).toHaveBeenCalledWith({
      stockCode: '005930',
      from: '20260101',
      to: '20260630',
      before: '20260401',
      limit: '100',
    });
    expect(res.success).toBe(true);
    expect(res.data).toBe(result);
  });

  it('검증 실패(IndicatorQueryError)는 400 BadRequest 로 매핑된다', async () => {
    // 실제 서비스 인스턴스(정규화가 stockCode 검증에서 throw — DB 미도달).
    const svc = new IndicatorHistoryService({} as never);
    const controller = makeController(svc);

    await expect(controller.getIndicators('12A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
