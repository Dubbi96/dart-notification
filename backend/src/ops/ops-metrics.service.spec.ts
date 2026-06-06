import { OpsMetricsService } from './ops-metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { DataFreshnessService } from '../cron-health/data-freshness.service';
import { GraduationMetricsService } from '../engine5-trading-risk/simulation/graduation-metrics.service';
import { FreshnessReport } from '../cron-health/freshness';
import { GraduationMetrics } from '../engine5-trading-risk/simulation/graduation-metrics.service';

describe('OpsMetricsService (DAR-111)', () => {
  const NOW = new Date('2026-06-07T12:00:00.000Z');

  function makeFreshness(over: Partial<FreshnessReport> = {}): FreshnessReport {
    return {
      generatedAt: NOW.toISOString(),
      anyStale: false,
      staleJobs: [],
      jobs: [
        {
          jobKey: 'signal.generate',
          label: '매수 신호 생성',
          cadence: '평일 19:00',
          applicable: true,
          isStale: false,
          lastSuccessAt: '2026-06-07T10:00:00.000Z',
          lastStatus: 'SUCCESS',
          lastItemCount: 3,
          ageMinutes: 120,
          reason: '정상',
        },
      ],
      ...over,
    };
  }

  function makeGraduation(over: Partial<GraduationMetrics> = {}): GraduationMetrics {
    return {
      portfolioId: 'sim-pf',
      asOf: NOW.toISOString(),
      hitRate: { evaluated: 10, hits: 6, hitRatePct: 60 },
      cumulativeReturn: {
        initialCapital: 1_000_000,
        currentValue: 1_050_000,
        absolutePnl: 50_000,
        returnPct: 5,
      },
      aiCostEfficiency: {
        aiCostKrw: 1000,
        netPnlKrw: 50_000,
        netPnlAfterAiCost: 49_000,
        aiCostToNetPnlRatio: 0.02,
      },
      exitAccuracy: { evaluated: 8, correct: 5, accuracyPct: 62.5 },
      riskAdjusted: { sharpe: 1.2, mddPct: -8, observations: 30, measurable: true },
      benchmarkAlpha: {
        indexCode: '0001',
        portfolioReturnPct: 5,
        benchmarkReturnPct: 3,
        alphaPct: 2,
        fromDate: '20260501',
        toDate: '20260607',
        measurable: true,
      },
      simulationProgress: {
        windowDays: 30,
        startDate: '2026-05-20T00:00:00.000Z',
        asOf: NOW.toISOString(),
        elapsedDays: 18,
        remainingDays: 12,
        progressRatio: 0.6,
        awaitingMeasurement: false,
        windowComplete: false,
      },
      config: { hitRateHorizonDays: 5, exitAccuracyHorizonDays: 3, usdKrwRate: 1300 },
      ...over,
    };
  }

  function makeService(opts: {
    aggregate?: unknown;
    signalCounts?: number[]; // [24h, 7d, total]
    positionGroups?: Array<{ status: string; _count: { _all: number } }>;
    freshness?: () => Promise<FreshnessReport>;
    graduation?: () => Promise<GraduationMetrics>;
  }) {
    const counts = opts.signalCounts ?? [0, 0, 0];
    let countIdx = 0;
    const prisma = {
      aIUsageLog: {
        aggregate: jest
          .fn()
          .mockResolvedValue(
            opts.aggregate ?? {
              _count: { _all: 0 },
              _sum: { costUsd: null, inputTokens: null, outputTokens: null },
            },
          ),
      },
      tradingSignal: {
        count: jest.fn().mockImplementation(() => Promise.resolve(counts[countIdx++] ?? 0)),
      },
      position: {
        groupBy: jest.fn().mockResolvedValue(opts.positionGroups ?? []),
      },
    } as unknown as PrismaService;

    const freshness = {
      getFreshness: jest
        .fn()
        .mockImplementation(opts.freshness ?? (() => Promise.resolve(makeFreshness()))),
    } as unknown as DataFreshnessService;

    const graduation = {
      getMetrics: jest
        .fn()
        .mockImplementation(opts.graduation ?? (() => Promise.resolve(makeGraduation()))),
    } as unknown as GraduationMetricsService;

    return new OpsMetricsService(prisma, freshness, graduation);
  }

  it('핵심 카운터를 집계한다(AI누적·신호·모의포지션)', async () => {
    const service = makeService({
      aggregate: {
        _count: { _all: 42 },
        _sum: { costUsd: 1.2345, inputTokens: 1000, outputTokens: 500 },
      },
      signalCounts: [2, 9, 137],
      positionGroups: [
        { status: 'OPEN', _count: { _all: 4 } },
        { status: 'CLOSED', _count: { _all: 11 } },
      ],
    });

    const result = await service.getMetrics(NOW);

    expect(result.generatedAt).toBe(NOW.toISOString());
    expect(result.aiUsage).toEqual({
      totalCalls: 42,
      totalCostUsd: 1.2345,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
    });
    expect(result.signals).toEqual({ last24h: 2, last7d: 9, total: 137 });
    expect(result.simulationPositions).toEqual({ open: 4, closed: 11, total: 15 });
  });

  it('표본 0건이면 카운터가 모두 0(graceful 기본값)', async () => {
    const service = makeService({});
    const result = await service.getMetrics(NOW);
    expect(result.aiUsage).toEqual({
      totalCalls: 0,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(result.signals).toEqual({ last24h: 0, last7d: 0, total: 0 });
    expect(result.simulationPositions).toEqual({ open: 0, closed: 0, total: 0 });
  });

  it('freshness 를 경량 요약으로 매핑한다(DAR-110 연계)', async () => {
    const service = makeService({
      freshness: () =>
        Promise.resolve(
          makeFreshness({
            anyStale: true,
            staleJobs: ['market.collect'],
            jobs: [
              {
                jobKey: 'market.collect',
                label: '시세 수집',
                cadence: '평일 18:00',
                applicable: true,
                isStale: true,
                lastSuccessAt: null,
                lastStatus: 'FAILED',
                lastItemCount: null,
                ageMinutes: null,
                reason: '정체',
              },
            ],
          }),
        ),
    });
    const result = await service.getMetrics(NOW);
    expect(result.collection).toEqual({
      anyStale: true,
      staleJobs: ['market.collect'],
      jobs: [
        {
          jobKey: 'market.collect',
          lastSuccessAt: null,
          isStale: true,
          ageMinutes: null,
        },
      ],
    });
  });

  it('졸업지표 G1/G2/G3/G5 만 현재값·표본수로 노출한다', async () => {
    const service = makeService({});
    const result = await service.getMetrics(NOW);
    expect(result.graduation).not.toBeNull();
    const ids = result.graduation!.map((g) => g.id);
    expect(ids).toEqual(['G1', 'G2', 'G3', 'G5']);
    const g1 = result.graduation!.find((g) => g.id === 'G1')!;
    expect(g1.currentValue).toBe(60);
    expect(g1.sampleSize).toBe(10);
    expect(g1.pass).toBe(true);
  });

  it('freshness 산출 실패 시 collection=null(graceful, 카운터는 유지)', async () => {
    const service = makeService({
      signalCounts: [1, 1, 1],
      freshness: () => Promise.reject(new Error('DB down')),
    });
    const result = await service.getMetrics(NOW);
    expect(result.collection).toBeNull();
    expect(result.signals.total).toBe(1); // 본체 카운터는 정상
  });

  it('졸업지표 산출 실패 시 graduation=null(graceful)', async () => {
    const service = makeService({
      graduation: () => Promise.reject(new Error('no sim data')),
    });
    const result = await service.getMetrics(NOW);
    expect(result.graduation).toBeNull();
  });

  it('신호 카운트는 24h/7d 윈도 경계를 쿼리에 전달한다', async () => {
    const service = makeService({ signalCounts: [0, 0, 0] });
    await service.getMetrics(NOW);
    const countFn = (service as unknown as { prisma: { tradingSignal: { count: jest.Mock } } })
      .prisma.tradingSignal.count;
    // 1번째=24h, 2번째=7d, 3번째=total(인자 없음)
    const since24h = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(countFn).toHaveBeenNthCalledWith(1, { where: { createdAt: { gte: since24h } } });
    expect(countFn).toHaveBeenNthCalledWith(2, { where: { createdAt: { gte: since7d } } });
    expect(countFn).toHaveBeenNthCalledWith(3);
  });
});
