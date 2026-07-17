import 'reflect-metadata';
import {
  StockMinutePriceCollector,
  MINUTE_COLLECT_DEFAULT_CAP,
} from './stock-minute-price.collector';
import { KisApiService, KisMinuteCandle } from './kis-api.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DAR-377: 분봉 forward 축적 수집기.
 * 결정론: sleep 주입(실타이머 없음)·KIS/Prisma 목킹. 검증 포인트:
 *  - 우선순위 유니버스(보유→신호→관심→거래량) 중복제거 + 쿼터(cap) slice + 커버리지 정직 리포트.
 *  - KIS time(HHMMSS)→HHMM 변환·이상행 스킵·멱등 적재(createMany skipDuplicates).
 *  - KIS 미설정 graceful·cron 정규장/락 게이트.
 */

const noSleep = (_ms: number) => Promise.resolve();

function sampleCandles(): KisMinuteCandle[] {
  return [
    { time: '090100', open: 100, high: 102, low: 99, close: 101, volume: 500 },
    { time: '090200', open: 101, high: 103, low: 100, close: 102, volume: 600 },
  ];
}

function makeScheduler(tradeDate = '20260619'): KrxMarketDataScheduler {
  return {
    // ★DAR-423: 분봉 collector 는 인트라데이 전용 해석기를 사용(장중 today, 장외 직전 거래일).
    resolveIntradayTradeDate: jest.fn().mockResolvedValue(tradeDate),
    resolveLatestAvailableTradeDate: jest.fn().mockResolvedValue(tradeDate),
  } as unknown as KrxMarketDataScheduler;
}

interface PrismaOpts {
  positions?: Array<{ corpCode: string; stockCode: string }>;
  signals?: Array<{ corpCode: string; stockCode: string }>;
  watch?: Array<{ company: { corpCode: string; stockCode: string } | null }>;
  latestDaily?: { tradeDate: string } | null;
  topVolume?: Array<{ corpCode: string; stockCode: string }>;
  createCount?: number;
}

function makePrisma(opts: PrismaOpts = {}) {
  const createMany = jest.fn().mockResolvedValue({ count: opts.createCount ?? 2 });
  const prisma = {
    position: { findMany: jest.fn().mockResolvedValue(opts.positions ?? []) },
    tradingSignal: { findMany: jest.fn().mockResolvedValue(opts.signals ?? []) },
    watchList: { findMany: jest.fn().mockResolvedValue(opts.watch ?? []) },
    stockDailyPrice: {
      findFirst: jest.fn().mockResolvedValue(opts.latestDaily ?? null),
      findMany: jest.fn().mockResolvedValue(opts.topVolume ?? []),
    },
    stockMinutePrice: { createMany },
  };
  return { prisma: prisma as unknown as PrismaService, createMany };
}

describe('StockMinutePriceCollector.collectOnce — 수집·커버리지 (DAR-377)', () => {
  it('KIS 미설정 → 실호출 0, candlesSaved 0 + message graceful', async () => {
    const { prisma } = makePrisma();
    const kis = { isConfigured: false, fetchMinuteCandlesFullDay: jest.fn() } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler());

    const res = await collector.collectOnce({ sleep: noSleep });

    expect((kis.fetchMinuteCandlesFullDay as jest.Mock)).not.toHaveBeenCalled();
    expect(res.candlesSaved).toBe(0);
    expect(res.tradeDate).toBe('20260619');
    expect(res.message).toContain('미설정');
  });

  it('우선순위 유니버스(보유→신호→관심→거래량) 중복제거 + 전건 수집 + 커버리지 리포트', async () => {
    const { prisma, createMany } = makePrisma({
      positions: [{ corpCode: 'C1', stockCode: '000001' }],
      signals: [{ corpCode: 'C2', stockCode: '000002' }],
      watch: [{ company: { corpCode: 'C3', stockCode: '000003' } }],
      latestDaily: { tradeDate: '20260619' },
      topVolume: [
        { corpCode: 'C1', stockCode: '000001' }, // 보유와 중복 → 제거
        { corpCode: 'C4', stockCode: '000004' },
      ],
      createCount: 2,
    });
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue(sampleCandles());
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler());

    const res = await collector.collectOnce({ sleep: noSleep });

    // 유니버스 = 000001,000002,000003,000004 (중복 000001 제거) → 4 종목.
    expect(res.totalCandidates).toBe(4);
    expect(res.requested).toBe(4);
    expect(res.skippedByQuota).toBe(0);
    expect(res.covered).toBe(4);
    expect(res.empty).toBe(0);
    expect(res.candlesSaved).toBe(8); // 4 종목 × createCount 2
    expect(fetchMinuteCandlesFullDay).toHaveBeenCalledTimes(4);
    // 멱등 적재 — skipDuplicates.
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('cap 초과 → slice + skippedByQuota 정직 보고', async () => {
    const { prisma } = makePrisma({
      positions: [
        { corpCode: 'C1', stockCode: '000001' },
        { corpCode: 'C2', stockCode: '000002' },
        { corpCode: 'C3', stockCode: '000003' },
      ],
    });
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue(sampleCandles());
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler());

    const res = await collector.collectOnce({ cap: 2, sleep: noSleep });

    expect(res.totalCandidates).toBe(3);
    expect(res.requested).toBe(2);
    expect(res.skippedByQuota).toBe(1);
    expect(fetchMinuteCandlesFullDay).toHaveBeenCalledTimes(2);
  });

  it('KIS time(HHMMSS)→HHMM 변환·이상행(close<=0·잘못된 시각) 스킵 후 적재', async () => {
    const { prisma, createMany } = makePrisma({
      positions: [{ corpCode: 'C1', stockCode: '000001' }],
      createCount: 1,
    });
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue([
      { time: '090100', open: 100, high: 102, low: 99, close: 101, volume: 500 },
      { time: '090200', open: 0, high: 0, low: 0, close: 0, volume: 0 }, // close<=0 스킵
      { time: 'XX', open: 1, high: 1, low: 1, close: 1, volume: 1 }, // 잘못된 시각 스킵
    ]);
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler());

    await collector.collectOnce({ sleep: noSleep });

    const arg = createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0]).toMatchObject({
      stockCode: '000001',
      tradeDate: '20260619',
      ts: new Date(Date.UTC(2026, 5, 19, 9, 1)), // HHMMSS 090100 → 분 단위 ts
      closePrice: 101,
    });
    expect(arg.data[0].volume).toBe(BigInt(500));
  });

  it('빈 캔들(장 시작 직후·거래없음) → empty 카운트, createMany 미호출', async () => {
    const { prisma, createMany } = makePrisma({
      positions: [{ corpCode: 'C1', stockCode: '000001' }],
    });
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue([]);
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler());

    const res = await collector.collectOnce({ sleep: noSleep });

    expect(res.covered).toBe(0);
    expect(res.empty).toBe(1);
    expect(res.candlesSaved).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('tradeDate 강제 지정 → 그대로 적재 거래일로 사용(스케줄러 해석 안 함)', async () => {
    const scheduler = makeScheduler();
    const { prisma } = makePrisma({ positions: [{ corpCode: 'C1', stockCode: '000001' }] });
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue(sampleCandles());
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, scheduler);

    const res = await collector.collectOnce({ tradeDate: '20260101', sleep: noSleep });

    expect(res.tradeDate).toBe('20260101');
    expect(scheduler.resolveIntradayTradeDate).not.toHaveBeenCalled();
  });

  it('기본 cap 은 MINUTE_COLLECT_DEFAULT_CAP(100)', () => {
    expect(MINUTE_COLLECT_DEFAULT_CAP).toBe(100);
  });
});

describe('StockMinutePriceCollector — DAR-531 유령 분봉 봉인(실데이터일 불일치 적재 거부)', () => {
  // 개장 직후(당일 분봉 미형성) KIS 가 반환한 '전일(7/16) 하루치 분봉'이 tradeDate=오늘(7/17)로
  //   오라벨돼 미래 시각 봉으로 둔갑하던 함정(2026-07-17 prod). 봉 자신의 영업일(stck_bsop_date)이
  //   요청 거래일과 다르면 적재 거부한다 — 재현: 전일치 응답 → 적재 0.

  it('전일 오라벨 응답(봉 tradeDate=전일) 전량 → 적재 0·거부 카운트·빈종목 처리', async () => {
    const { prisma, createMany } = makePrisma({
      positions: [{ corpCode: 'C1', stockCode: '000001' }],
    });
    // 요청 거래일 20260717 이지만 KIS 는 전일(20260716) 세션 전체를 반환.
    const prevDayCandles: KisMinuteCandle[] = [
      { time: '114900', tradeDate: '20260716', open: 100, high: 102, low: 99, close: 101, volume: 500 },
      { time: '141500', tradeDate: '20260716', open: 101, high: 103, low: 100, close: 102, volume: 600 },
    ];
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue(prevDayCandles);
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler('20260717'));

    const res = await collector.collectOnce({ sleep: noSleep });

    expect(res.candlesSaved).toBe(0); // ★적재 0 — 미래봉 유령 진입 원천 차단
    expect(res.rejectedByDate).toBe(2); // 2봉 전부 거부(실데이터일 20260716 ≠ 요청 20260717)
    expect(res.covered).toBe(0); // 오늘치 실봉 0 → 커버 아님
    expect(res.empty).toBe(1);
    expect(createMany).not.toHaveBeenCalled(); // DB 적재 시도 자체가 없음
  });

  it('혼재 응답(당일봉+전일 오라벨봉) → 당일봉만 적재, 전일봉 거부 카운트', async () => {
    const { prisma, createMany } = makePrisma({
      positions: [{ corpCode: 'C1', stockCode: '000001' }],
      createCount: 1,
    });
    const mixed: KisMinuteCandle[] = [
      { time: '090100', tradeDate: '20260717', open: 100, high: 102, low: 99, close: 101, volume: 500 }, // 당일 — 적재
      { time: '114900', tradeDate: '20260716', open: 101, high: 103, low: 100, close: 102, volume: 600 }, // 전일 오라벨 — 거부
    ];
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue(mixed);
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler('20260717'));

    const res = await collector.collectOnce({ sleep: noSleep });

    expect(res.rejectedByDate).toBe(1);
    expect(res.candlesSaved).toBe(1);
    expect(res.covered).toBe(1);
    const arg = createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1); // 당일봉 1건만 적재 대상
    expect(arg.data[0]).toMatchObject({
      tradeDate: '20260717',
      ts: new Date(Date.UTC(2026, 6, 17, 9, 1)), // 09:01 당일봉
    });
  });

  it('봉에 실영업일 결측(레거시/미제공) → 하위호환: 요청 거래일로 적재(거부 0)', async () => {
    const { prisma, createMany } = makePrisma({
      positions: [{ corpCode: 'C1', stockCode: '000001' }],
      createCount: 2,
    });
    // tradeDate 필드 없는 캔들(기존 sampleCandles 형태) — 결측이면 거부하지 않고 요청일로 적재.
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue([
      { time: '090100', open: 100, high: 102, low: 99, close: 101, volume: 500 },
      { time: '090200', open: 101, high: 103, low: 100, close: 102, volume: 600 },
    ]);
    const kis = { isConfigured: true, fetchMinuteCandlesFullDay } as unknown as KisApiService;
    const collector = new StockMinutePriceCollector(prisma, kis, makeScheduler('20260717'));

    const res = await collector.collectOnce({ sleep: noSleep });

    expect(res.rejectedByDate).toBe(0);
    expect(res.candlesSaved).toBe(2);
    expect(res.covered).toBe(1);
    expect(createMany).toHaveBeenCalled();
  });
});

describe('StockMinutePriceCollector.collectMinutePricesCron — 게이트 (DAR-377)', () => {
  const IN_HOURS = new Date('2026-06-19T03:00:00Z'); // 금 12:00 KST = 정규장
  const OUT_HOURS = new Date('2026-06-19T10:30:00Z'); // 금 19:30 KST = 장외

  function makeCollector(kisConfigured: boolean) {
    const { prisma } = makePrisma({ positions: [{ corpCode: 'C1', stockCode: '000001' }] });
    const fetchMinuteCandlesFullDay = jest.fn().mockResolvedValue(sampleCandles());
    const kis = {
      isConfigured: kisConfigured,
      fetchMinuteCandlesFullDay,
    } as unknown as KisApiService;
    return new StockMinutePriceCollector(prisma, kis, makeScheduler());
  }

  it('정규장 밖 → skipped(실호출 0)', async () => {
    const collector = makeCollector(true);
    const res = await collector.collectMinutePricesCron(OUT_HOURS);
    expect(res).toEqual({ skipped: true });
  });

  it('정규장이지만 KIS 미설정 → skipped(no-op)', async () => {
    const collector = makeCollector(false);
    const res = await collector.collectMinutePricesCron(IN_HOURS);
    expect(res).toEqual({ skipped: true });
  });

  it('이미 수집 중(락) → skipped', async () => {
    const collector = makeCollector(true);
    (collector as unknown as { isCollecting: boolean }).isCollecting = true;
    const res = await collector.collectMinutePricesCron(IN_HOURS);
    expect(res).toEqual({ skipped: true });
  });

  it('정규장+설정+비락 → 실제 수집 실행(커버리지 반환)', async () => {
    const collector = makeCollector(true);
    const res = await collector.collectMinutePricesCron(IN_HOURS);
    expect(res).toMatchObject({ covered: 1, candlesSaved: expect.any(Number) });
  });
});
