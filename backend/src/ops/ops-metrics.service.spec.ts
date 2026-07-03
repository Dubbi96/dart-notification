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
      hitRate: { evaluated: 25, hits: 15, hitRatePct: 60 },
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
      exitAccuracy: { evaluated: 25, correct: 16, accuracyPct: 64 },
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
    // DAR-474: 슬리피지 집계용 mock 행(부분 형태 — 서비스가 Number()로 정규화).
    paperTrades?: unknown[];
    paperTradesFindMany?: () => Promise<unknown[]>;
    scalpTrades?: unknown[];
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
      paperTrade: {
        findMany: jest
          .fn()
          .mockImplementation(
            opts.paperTradesFindMany ??
              (() => Promise.resolve(opts.paperTrades ?? [])),
          ),
      },
      intradayScalpTrade: {
        findMany: jest.fn().mockResolvedValue(opts.scalpTrades ?? []),
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
    expect(g1.sampleSize).toBe(25);
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

  // ─── DAR-474: 슬리피지 측정 표면 ──────────────────────────────────────
  describe('슬리피지 분포 집계(DAR-474)', () => {
    it('트랙(styleTag)별 평균·p95 KRW + 신호시점 기대가 대비 bps 를 산출한다', async () => {
      const service = makeService({
        paperTrades: [
          // 시스템 모의 매수 2건 — expectedPrice(신호시점) 보존분: bps 산정.
          {
            styleTag: 'paper-simulation',
            direction: 'BUY',
            slippage: 100,
            commission: 15,
            tax: 0,
            expectedPrice: 1000, // 신호시점 기대가
            entryPrice: 1010, // 체결일 시가(덮어쓰기됨) — bps 산정엔 미사용
            filledPrice: 1020, // 실제 체결가 → +2% = 200bps 불리
          },
          {
            styleTag: 'paper-simulation',
            direction: 'BUY',
            slippage: 50,
            commission: 10,
            tax: 0,
            expectedPrice: 2000,
            entryPrice: 2005,
            filledPrice: 2010, // +0.5% = 50bps
          },
        ],
      });

      const result = await service.getMetrics(NOW);
      expect(result.slippage).not.toBeNull();
      const track = result.slippage!.byTrack.find((t) => t.styleTag === 'paper-simulation')!;
      expect(track.tradeCount).toBe(2);
      expect(track.avgSlippageKrw).toBe(75); // (100+50)/2
      expect(track.p95SlippageKrw).toBe(100); // nearest-rank
      expect(track.totalFeesKrw).toBe(25); // 15+10 — ★슬리피지와 별도
      expect(track.avgSlippageBps).toBe(125); // (200+50)/2
      expect(track.p95SlippageBps).toBe(200);
      expect(track.bpsSampleSize).toBe(2);
      // overall = 전 트랙 합산
      expect(result.slippage!.overall.tradeCount).toBe(2);
      expect(result.slippage!.overall.avgSlippageBps).toBe(125);
    });

    it('단타 트랙은 totalFees(수수료+세금)를 슬리피지와 구분해 노출하고 bps 는 미산정(null)', async () => {
      const service = makeService({
        scalpTrades: [
          { styleTag: 'intraday-scalp', slippage: 100, commission: 30, tax: 20 },
        ],
      });
      const result = await service.getMetrics(NOW);
      const track = result.slippage!.byTrack.find((t) => t.styleTag === 'intraday-scalp')!;
      expect(track.tradeCount).toBe(1);
      expect(track.avgSlippageKrw).toBe(100); // 슬리피지
      expect(track.totalFeesKrw).toBe(50); // 수수료 30 + 세금 20 — ★슬리피지(100)와 구분
      expect(track.avgSlippageBps).toBeNull(); // expectedPrice 미보존 → 산정 불가
      expect(track.bpsSampleSize).toBe(0);
    });

    it('expectedPrice 부재 시 entryPrice 로 폴백하고 매도는 저가체결을 불리(+bps)로 정규화', async () => {
      const service = makeService({
        paperTrades: [
          {
            styleTag: 'strategy:momentum',
            direction: 'SELL',
            slippage: 30,
            commission: 5,
            tax: 3,
            expectedPrice: null, // 미보존(placeOrder 트랙)
            entryPrice: 5000, // 폴백 기준가
            filledPrice: 4950, // 1% 저가 체결 → 매도 불리 = +100bps
          },
        ],
      });
      const result = await service.getMetrics(NOW);
      const track = result.slippage!.byTrack.find((t) => t.styleTag === 'strategy:momentum')!;
      expect(track.avgSlippageBps).toBe(100); // -(-0.01)*10000
      expect(track.bpsSampleSize).toBe(1);
    });

    it('styleTag null 행은 (untagged) 버킷으로 집계된다', async () => {
      const service = makeService({
        paperTrades: [
          {
            styleTag: null,
            direction: 'SELL',
            slippage: 20,
            commission: 2,
            tax: 1,
            expectedPrice: null,
            entryPrice: 1000,
            filledPrice: 995,
          },
        ],
      });
      const result = await service.getMetrics(NOW);
      const tags = result.slippage!.byTrack.map((t) => t.styleTag);
      expect(tags).toContain('(untagged)');
    });

    it('표본 0건이면 분포는 graceful 빈값(카운트 0·평균 null)', async () => {
      const service = makeService({});
      const result = await service.getMetrics(NOW);
      expect(result.slippage).not.toBeNull();
      expect(result.slippage!.overall.tradeCount).toBe(0);
      expect(result.slippage!.overall.avgSlippageKrw).toBeNull();
      expect(result.slippage!.overall.avgSlippageBps).toBeNull();
      expect(result.slippage!.byTrack).toEqual([]);
    });

    it('집계 실패 시 slippage=null(graceful, 카운터 본체 유지)', async () => {
      const service = makeService({
        signalCounts: [1, 1, 1],
        paperTradesFindMany: () => Promise.reject(new Error('DB down')),
      });
      const result = await service.getMetrics(NOW);
      expect(result.slippage).toBeNull();
      expect(result.signals.total).toBe(1); // 본체 카운터 정상
    });
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
