/**
 * etf-daily-backfill.service.spec.ts — ETF 과거 일봉 백필 (DAR-490 [견고화 W1·P11]).
 *
 * 검증(실 DB·네트워크 없음): 키 미설정 graceful, 날짜 구간 페이지네이션 + 연속 빈 창 조기종료,
 *   멱등 적재(createMany skipDuplicates)·손상행 배제(isValidDailyOhlc), S3 원본 보관 best-effort,
 *   하한 도달 종료, 커버리지 리포트(시작일·행수·갭 추정·상장 고지).
 */

import { EtfDailyBackfillService } from './etf-daily-backfill.service';
import { KisApiService } from './kis-api.service';
import { EtfDailyRawStoreService } from '../../common/storage/etf-daily-raw-store.service';
import { PrismaService } from '../../prisma/prisma.service';

interface Bar {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradingValue: number;
}

const bar = (over: Partial<Bar> = {}): Bar => ({
  tradeDate: '20200102',
  open: 10000,
  high: 10200,
  low: 9900,
  close: 10100,
  volume: 1000,
  tradingValue: 1_000_000,
  ...over,
});

const noSleep = () => Promise.resolve();
const NOW = new Date('2026-07-03T00:00:00Z');

function makePrisma(opts: { count?: number; coverageDates?: string[] } = {}) {
  const createMany = jest.fn().mockResolvedValue({ count: opts.count ?? 0 });
  const findMany = jest
    .fn()
    .mockResolvedValue((opts.coverageDates ?? []).map((tradeDate) => ({ tradeDate })));
  return {
    prisma: { etfDailyPrice: { createMany, findMany } } as unknown as PrismaService,
    createMany,
    findMany,
  };
}

function makeKis(configured: boolean, responses: Array<{ bars: Bar[]; raw?: unknown }> = []) {
  let i = 0;
  const fetchDailyPricesRaw = jest.fn(async () => {
    const r = responses[i] ?? { bars: [] as Bar[] };
    i++;
    return {
      bars: r.bars,
      raw: 'raw' in r ? r.raw : r.bars.length ? { output2: r.bars } : null,
    };
  });
  return {
    kis: { isConfigured: configured, fetchDailyPricesRaw } as unknown as KisApiService,
    fetchDailyPricesRaw,
  };
}

function makeRawStore(failing = false) {
  const save = failing
    ? jest.fn().mockRejectedValue(new Error('S3 down'))
    : jest.fn().mockResolvedValue('etf-daily-raw/x.json.gz');
  return { rawStore: { save } as unknown as EtfDailyRawStoreService, save };
}

describe('EtfDailyBackfillService (DAR-490)', () => {
  it('키 미설정 — configured=false·적재 0·createMany 미호출, 커버리지는 기존 DB 로 산출', async () => {
    const { prisma, createMany } = makePrisma({ coverageDates: ['20260101', '20260102'] });
    const { kis } = makeKis(false);
    const { rawStore } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const r = await svc.backfill({ codes: ['069500'], now: NOW, sleep: noSleep });

    expect(r.configured).toBe(false);
    expect(r.totals.rowsSaved).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    expect(r.message).toContain('미설정');
    expect(r.coverage[0].rowCount).toBe(2);
  });

  it('페이지네이션 — 데이터 창 2 + 연속 빈 창 2 이면 4콜 후 종료(조기종료)', async () => {
    const { prisma, createMany } = makePrisma({ count: 2 });
    const { kis, fetchDailyPricesRaw } = makeKis(true, [
      { bars: [bar({ tradeDate: '20260601' }), bar({ tradeDate: '20260602' })] },
      { bars: [bar({ tradeDate: '20260301' }), bar({ tradeDate: '20260302' })] },
      { bars: [] },
      { bars: [] },
    ]);
    const { rawStore, save } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const r = await svc.backfill({ codes: ['069500'], now: NOW, sleep: noSleep });
    const cr = r.perCode[0];

    expect(fetchDailyPricesRaw).toHaveBeenCalledTimes(4); // 데이터 2 + 빈 창 2(=maxEmptyWindows)
    expect(cr.windowsFetched).toBe(4);
    expect(cr.windowsWithData).toBe(2);
    expect(cr.rowsSaved).toBe(4); // createMany count 2 × 2창
    expect(cr.earliest).toBe('20260301');
    expect(cr.latest).toBe('20260602');
    expect(createMany).toHaveBeenCalledTimes(2); // 빈 창은 적재 안 함
    expect(save).toHaveBeenCalledTimes(2); // 원본 보관도 데이터 창만
    expect(cr.rawStored).toBe(2);
  });

  it('손상행 배제 — high<low 행은 createMany data 에서 제외·invalidSkipped 집계', async () => {
    const { prisma, createMany } = makePrisma({ count: 1 });
    const { kis } = makeKis(true, [
      {
        bars: [
          bar({ tradeDate: '20260601' }),
          bar({ tradeDate: '20260602', high: 100, low: 9999 }), // 물리적 불가(고<저)
        ],
      },
      { bars: [] },
      { bars: [] },
    ]);
    const { rawStore } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const r = await svc.backfill({ codes: ['069500'], now: NOW, sleep: noSleep });

    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1); // 손상행 제외 → 1행만 적재
    expect(data[0].tradeDate).toBe('20260601');
    expect(r.perCode[0].invalidSkipped).toBe(1);
  });

  it('원본 보관 best-effort — save 실패해도 DB 적재는 진행·rawFailed 집계', async () => {
    const { prisma, createMany } = makePrisma({ count: 2 });
    const { kis } = makeKis(true, [
      { bars: [bar({ tradeDate: '20260601' }), bar({ tradeDate: '20260602' })] },
      { bars: [] },
      { bars: [] },
    ]);
    const { rawStore, save } = makeRawStore(true); // save rejects
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const r = await svc.backfill({ codes: ['069500'], now: NOW, sleep: noSleep });

    expect(save).toHaveBeenCalledTimes(1);
    expect(r.perCode[0].rawStored).toBe(0);
    expect(r.perCode[0].rawFailed).toBe(1);
    expect(createMany).toHaveBeenCalledTimes(1); // 원본 실패와 무관하게 적재 진행
    expect(r.perCode[0].rowsSaved).toBe(2);
  });

  it('persistRaw=false — 원본 보관 스킵(save 미호출)·적재만', async () => {
    const { prisma } = makePrisma({ count: 2 });
    const { kis } = makeKis(true, [
      { bars: [bar({ tradeDate: '20260601' })] },
      { bars: [] },
      { bars: [] },
    ]);
    const { rawStore, save } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const r = await svc.backfill({
      codes: ['069500'],
      now: NOW,
      sleep: noSleep,
      persistRaw: false,
    });

    expect(save).not.toHaveBeenCalled();
    expect(r.perCode[0].rowsSaved).toBe(2);
  });

  it('하한(minStartYmd) 도달 — 창이 하한에 닿으면 1콜 후 종료', async () => {
    const { prisma } = makePrisma({ count: 1 });
    const { kis, fetchDailyPricesRaw } = makeKis(true, [
      { bars: [bar({ tradeDate: '20260602' })] },
      { bars: [bar({ tradeDate: '20260301' })] },
    ]);
    const { rawStore } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    // endYmd 20260703, minStartYmd 20260601, chunkDays 100 → 창0 시작 = max(20260601, 20260326) = 20260601 = 하한 → 종료.
    const r = await svc.backfill({
      codes: ['069500'],
      now: NOW,
      minStartYmd: '20260601',
      sleep: noSleep,
    });

    expect(fetchDailyPricesRaw).toHaveBeenCalledTimes(1);
    const call0 = fetchDailyPricesRaw.mock.calls[0] as unknown[];
    expect(call0[1]).toBe('20260601');
    expect(call0[2]).toBe('20260703');
    expect(r.perCode[0].windowsFetched).toBe(1);
  });

  it('커버리지 리포트 — 시작/끝·행수·최대갭·의심홀·상장 고지', async () => {
    const { prisma, findMany } = makePrisma({
      coverageDates: ['20200807', '20200810', '20200825'], // 20200810→20200825 = 15일 갭(>7)
    });
    const { kis } = makeKis(true);
    const { rawStore } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const cov = await svc.coverageReport(['360750']);
    const c = cov[0];

    expect(findMany).toHaveBeenCalledWith({
      where: { etfCode: '360750' },
      select: { tradeDate: true },
      orderBy: { tradeDate: 'asc' },
    });
    expect(c.startDate).toBe('20200807');
    expect(c.endDate).toBe('20200825');
    expect(c.rowCount).toBe(3);
    expect(c.maxGapCalendarDays).toBe(15);
    expect(c.suspiciousGaps).toEqual([{ from: '20200810', to: '20200825', calendarDays: 15 }]);
    expect(c.expectedTradingDays).toBeGreaterThan(0);
    expect(c.note).toContain('2020-08'); // 360750 상장월 정직 고지
  });

  it('커버리지 — 빈 DB 는 0행·null 구간·갭 없음', async () => {
    const { prisma } = makePrisma({ coverageDates: [] });
    const { kis } = makeKis(true);
    const { rawStore } = makeRawStore();
    const svc = new EtfDailyBackfillService(prisma, kis, rawStore);

    const cov = await svc.coverageReport(['069500']);
    const c = cov[0];

    expect(c.rowCount).toBe(0);
    expect(c.startDate).toBeNull();
    expect(c.endDate).toBeNull();
    expect(c.maxGapCalendarDays).toBe(0);
    expect(c.suspiciousGaps).toEqual([]);
    expect(c.note).toBeUndefined(); // 069500 은 상장월 참조 없음
  });
});
