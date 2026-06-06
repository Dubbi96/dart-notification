import {
  FinancialCollectionService,
  ALL_QUARTERLY_REPORT_CODES,
} from './financial-collection.service';
import { FinancialCollectionScheduler } from './financial-collection.scheduler';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartApiUnavailableError,
  CompanyFinancialMetrics,
} from '../dart-api/dart-api.service';

const FULL_METRICS: CompanyFinancialMetrics = {
  revenue: 1_000_000,
  operatingProfit: 200_000,
  netIncome: 150_000,
  totalAssets: 5_000_000,
  totalLiabilities: 2_000_000,
  totalEquity: 3_000_000,
  eps: 5_000,
  roe: 5,
  roa: 3,
  debtRatio: 66.67,
};

function makeDartApi(overrides: Partial<DartApiService> = {}): jest.Mocked<DartApiService> {
  return {
    fetchSingleCompanyFinancials: jest
      .fn()
      .mockResolvedValue({ status: '000', message: '', list: [{ rcept_no: 'r1' }] }),
    extractFinancialMetrics: jest.fn().mockReturnValue(FULL_METRICS),
    ...overrides,
  } as unknown as jest.Mocked<DartApiService>;
}

function codes(...vals: string[]): { corpCode: string }[] {
  return vals.map((corpCode) => ({ corpCode }));
}

function makePrisma(overrides: Record<string, any> = {}): jest.Mocked<PrismaService> {
  return {
    tradingSignal: { findMany: jest.fn().mockResolvedValue([]) },
    disclosureEvent: { findMany: jest.fn().mockResolvedValue([]) },
    watchList: { findMany: jest.fn().mockResolvedValue([]) },
    stockDailyPrice: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({ stockCode: '005930' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    disclosure: { findMany: jest.fn().mockResolvedValue([]) },
    companyFinancial: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    financialCollectionLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as jest.Mocked<PrismaService>;
}

describe('DAR-55 selectAllMarketTargets — 전종목 우선순위 큐', () => {
  it('신호 → 이벤트 → 관심 → 시총상위 → 나머지 순서·dedup', async () => {
    const prisma = makePrisma({
      tradingSignal: { findMany: jest.fn().mockResolvedValue(codes('S1', 'S2')) },
      disclosureEvent: { findMany: jest.fn().mockResolvedValue(codes('S2', 'E1')) },
      watchList: { findMany: jest.fn().mockResolvedValue(codes('W1', 'S1')) },
      stockDailyPrice: {
        findFirst: jest.fn().mockResolvedValue({ tradeDate: '20260605' }),
        findMany: jest.fn().mockResolvedValue(codes('T1', 'S2', 'T2')),
      },
      company: {
        findMany: jest.fn().mockResolvedValue(codes('Z9', 'S1', 'C1')),
      },
    });
    const svc = new FinancialCollectionService(prisma, makeDartApi());

    const result = await svc.selectAllMarketTargets();
    // 상위 티어 우선 1회만, 순서 보존
    expect(result).toEqual(['S1', 'S2', 'E1', 'W1', 'T1', 'T2', 'Z9', 'C1']);
  });

  it('시총상위 — 최신 거래일 tradingValue desc 프록시 사용', async () => {
    const findFirst = jest.fn().mockResolvedValue({ tradeDate: '20260605' });
    const findMany = jest.fn().mockResolvedValue(codes('T1'));
    const prisma = makePrisma({
      stockDailyPrice: { findFirst, findMany },
    });
    const svc = new FinancialCollectionService(prisma, makeDartApi());

    await svc.selectAllMarketTargets();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { tradeDate: 'desc' } }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tradeDate: '20260605', tradingValue: { not: null } },
        orderBy: { tradingValue: 'desc' },
      }),
    );
  });

  it('limit 지정 시 상위 N 만 — 하위 티어 단축', async () => {
    const companyFind = jest.fn().mockResolvedValue(codes('Z1', 'Z2'));
    const prisma = makePrisma({
      tradingSignal: { findMany: jest.fn().mockResolvedValue(codes('S1', 'S2')) },
      company: { findMany: companyFind },
    });
    const svc = new FinancialCollectionService(prisma, makeDartApi());

    const result = await svc.selectAllMarketTargets(2);
    expect(result).toEqual(['S1', 'S2']);
  });
});

describe('DAR-55 캡 해제 — collectBatch limit 미지정 시 50개 초과 수집', () => {
  it('PRIORITY scope: 신호 60개면 60개 전부 수집(기존 50 캡 없음)', async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => ({ corpCode: `S${i}` }));
    const prisma = makePrisma({
      tradingSignal: { findMany: jest.fn().mockResolvedValue(sixty) },
    });
    const dart = makeDartApi();
    const svc = new FinancialCollectionService(prisma, dart);

    const r = await svc.collectBatch({ bsnsYear: '2024', rateLimitMs: 0 });
    expect(r.target).toBe(60);
    expect(r.saved).toBe(60);
    expect(dart.fetchSingleCompanyFinancials).toHaveBeenCalledTimes(60);
  });

  it("ALL scope: 전종목 우선순위 큐로 70개 수집", async () => {
    const seventy = Array.from({ length: 70 }, (_, i) => ({ corpCode: `C${i}` }));
    const prisma = makePrisma({
      company: {
        findUnique: jest.fn().mockResolvedValue({ stockCode: '005930' }),
        findMany: jest.fn().mockResolvedValue(seventy),
      },
    });
    const dart = makeDartApi();
    const svc = new FinancialCollectionService(prisma, dart);

    const r = await svc.collectBatch({ bsnsYear: '2024', scope: 'ALL', rateLimitMs: 0 });
    expect(r.target).toBe(70);
    expect(r.saved).toBe(70);
  });

  it('명시 corpCodes + limit 미지정 — slice 없이 전부', async () => {
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, makeDartApi());
    const many = Array.from({ length: 55 }, (_, i) => `X${i}`);

    const r = await svc.collectBatch({ bsnsYear: '2024', corpCodes: many, rateLimitMs: 0 });
    expect(r.target).toBe(55);
  });
});

describe('DAR-55 backfillTimeSeries — 분기 시계열', () => {
  it('reprtCode 11011~11014 × 연도 전체를 collectBatch 순회', async () => {
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, makeDartApi());
    const spy = jest.spyOn(svc, 'collectBatch');

    const r = await svc.backfillTimeSeries({
      bsnsYears: ['2024', '2023'],
      corpCodes: ['A'],
      rateLimitMs: 0,
    });

    // 2 연도 × 4 보고서 = 8 조합
    expect(r.periods).toBe(8);
    expect(spy).toHaveBeenCalledTimes(8);
    const calledReprt = spy.mock.calls.map((c) => c[0].reprtCode);
    for (const rc of ALL_QUARTERLY_REPORT_CODES) {
      expect(calledReprt).toContain(rc);
    }
    expect(r.totalSaved).toBe(8); // 종목1 × 8조합 모두 SAVED
  });

  it('명시 reprtCodes 만 백필', async () => {
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, makeDartApi());
    const spy = jest.spyOn(svc, 'collectBatch');

    const r = await svc.backfillTimeSeries({
      bsnsYears: ['2024'],
      reprtCodes: ['11013'],
      corpCodes: ['A'],
      rateLimitMs: 0,
    });
    expect(r.periods).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].reprtCode).toBe('11013');
  });

  it('DART 키 미설정 — 첫 조합 FAILED 후 즉시 중단(이후 조합 호출 안 함)', async () => {
    const dart = makeDartApi({
      fetchSingleCompanyFinancials: jest
        .fn()
        .mockRejectedValue(new DartApiUnavailableError('DART_API_KEY 미설정')),
    });
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, dart);

    const r = await svc.backfillTimeSeries({
      bsnsYears: ['2024', '2023'],
      corpCodes: ['A'],
      rateLimitMs: 0,
    });
    // 첫 조합에서 graceful 중단 → periods 1
    expect(r.periods).toBe(1);
    expect(dart.fetchSingleCompanyFinancials).toHaveBeenCalledTimes(1);
  });
});

describe('DAR-93 성장률 산출·영속 (recomputeGrowthForCorpCodes)', () => {
  function finRow(o: Record<string, any>): Record<string, any> {
    return {
      id: o.id,
      bsnsYear: o.bsnsYear,
      reprtCode: o.reprtCode ?? '11011',
      revenue: o.revenue ?? null,
      operatingProfit: o.operatingProfit ?? null,
      eps: o.eps ?? null,
      revenueGrowthYoY: null,
      operatingProfitGrowthYoY: null,
      epsGrowthYoY: null,
      revenueGrowthQoQ: null,
      operatingProfitGrowthQoQ: null,
      epsGrowthQoQ: null,
      ...o,
    };
  }

  it('전년 행이 있으면 YoY 성장률을 산출해 update', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      companyFinancial: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          finRow({ id: 'a', bsnsYear: '2023', revenue: 1000n, operatingProfit: 100n, eps: 500 }),
          finRow({ id: 'b', bsnsYear: '2024', revenue: 1200n, operatingProfit: 150n, eps: 600 }),
        ]),
        update,
      },
    });
    const svc = new FinancialCollectionService(prisma, makeDartApi());

    const updated = await svc.recomputeGrowthForCorpCodes(['A']);
    // 2024 행만 YoY 산출(2023 은 직전·전년 없음 → 전부 null = 변동 없음 → 스킵)
    expect(updated).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b' },
        data: expect.objectContaining({
          revenueGrowthYoY: 20,
          operatingProfitGrowthYoY: 50,
          epsGrowthYoY: 20,
        }),
      }),
    );
  });

  it('재무 행 없으면 update 호출 없음(graceful)', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      companyFinancial: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update },
    });
    const svc = new FinancialCollectionService(prisma, makeDartApi());
    expect(await svc.recomputeGrowthForCorpCodes(['A'])).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('backfillTimeSeries 가 적재 후 성장률 재계산을 호출한다', async () => {
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, makeDartApi());
    const spy = jest.spyOn(svc, 'recomputeGrowthForCorpCodes');

    const r = await svc.backfillTimeSeries({
      bsnsYears: ['2024'],
      corpCodes: ['A'],
      rateLimitMs: 0,
    });
    expect(spy).toHaveBeenCalledWith(['A'], 'CFS');
    expect(r.growthUpdated).toBe(0); // findMany 기본 [] → 갱신 0
  });

  it('computeGrowth:false 면 재계산 생략', async () => {
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, makeDartApi());
    const spy = jest.spyOn(svc, 'recomputeGrowthForCorpCodes');

    await svc.backfillTimeSeries({
      bsnsYears: ['2024'],
      corpCodes: ['A'],
      rateLimitMs: 0,
      computeGrowth: false,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('DART 키 미설정으로 중단되면 성장률 재계산 생략', async () => {
    const dart = makeDartApi({
      fetchSingleCompanyFinancials: jest
        .fn()
        .mockRejectedValue(new DartApiUnavailableError('DART_API_KEY 미설정')),
    });
    const prisma = makePrisma();
    const svc = new FinancialCollectionService(prisma, dart);
    const spy = jest.spyOn(svc, 'recomputeGrowthForCorpCodes');

    const r = await svc.backfillTimeSeries({
      bsnsYears: ['2024'],
      corpCodes: ['A'],
      rateLimitMs: 0,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r.growthUpdated).toBe(0);
  });
});

describe('DAR-55 FinancialCollectionScheduler', () => {
  function makeCollection(): jest.Mocked<FinancialCollectionService> {
    return {
      backfillTimeSeries: jest.fn().mockResolvedValue({
        periods: 1,
        totalSaved: 1,
        totalSkipped: 0,
        totalFailed: 0,
        results: [],
      }),
    } as unknown as jest.Mocked<FinancialCollectionService>;
  }

  it('weeklyBulkCollect — scope:ALL 로 전년도 분기 백필', async () => {
    const collection = makeCollection();
    const sched = new FinancialCollectionScheduler(makePrisma(), collection);

    await sched.weeklyBulkCollect();
    expect(collection.backfillTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'ALL', triggeredBy: 'CRON' }),
    );
  });

  it('earningsSeasonCollect — 마감월(3월) 실행, 비마감월(2월) 스킵', async () => {
    const collection = makeCollection();
    const sched = new FinancialCollectionScheduler(makePrisma(), collection);

    const march = new Date(2026, 2, 10); // month index 2 = 3월
    const r1 = await sched.earningsSeasonCollect(march);
    expect('skipped' in r1).toBe(false);
    expect(collection.backfillTimeSeries).toHaveBeenCalledTimes(1);

    const feb = new Date(2026, 1, 10); // 2월
    const r2 = await sched.earningsSeasonCollect(feb);
    expect(r2).toEqual({ skipped: true, reason: '실적시즌(3·5·8·11월) 아님' });
    expect(collection.backfillTimeSeries).toHaveBeenCalledTimes(1); // 추가 호출 없음
  });

  it('periodicReportEvent — 신규 REGULAR 공시 종목만 EVENT 백필', async () => {
    const collection = makeCollection();
    const prisma = makePrisma({
      disclosure: {
        findMany: jest.fn().mockResolvedValue([{ corpCode: 'P1' }, { corpCode: 'P2' }]),
      },
    });
    const sched = new FinancialCollectionScheduler(prisma, collection);

    const now = new Date(2026, 4, 16);
    const r = await sched.periodicReportEvent(now);
    expect('skipped' in r).toBe(false);
    expect(prisma.disclosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ disclosureType: 'REGULAR' }),
        distinct: ['corpCode'],
      }),
    );
    expect(collection.backfillTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        corpCodes: ['P1', 'P2'],
        triggeredBy: 'EVENT',
        bsnsYears: ['2026', '2025'],
      }),
    );
  });

  it('periodicReportEvent — 신규 정기공시 없으면 스킵', async () => {
    const collection = makeCollection();
    const sched = new FinancialCollectionScheduler(makePrisma(), collection);

    const r = await sched.periodicReportEvent(new Date(2026, 4, 16));
    expect(r).toEqual({ skipped: true, reason: '신규 정기보고서 공시 없음' });
    expect(collection.backfillTimeSeries).not.toHaveBeenCalled();
  });
});
