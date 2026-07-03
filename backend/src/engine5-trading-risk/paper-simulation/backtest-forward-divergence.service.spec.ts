/**
 * backtest-forward-divergence.service.spec.ts — 조인 리포트·스냅샷 적재 결정론 검증 (DAR-479)
 *
 * mock prisma(BacktestRun 리플레이 지표) + mock StrategyForwardSimulationService(forward 성적표)로
 * strategyKey 조인·괴리 산출·멱등 upsert 적재를 고정한다. 신규 수집·체결·AI 0 — read-only 측정.
 */

import { BacktestForwardDivergenceService } from './backtest-forward-divergence.service';

// event-edge: 백테스트 창 90일·30건, forward 10일·8건 → 거래빈도만 크게 괴리.
const BACKTEST_ROWS = [
  {
    strategyKey: 'event-edge',
    status: 'COMPLETED',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-03-31T00:00:00Z'),
    summary: {
      metrics: { totalReturn: 12, winRate: 55, totalTrades: 30, avgHoldDays: 10 },
    },
  },
];

const FORWARD_COMPARISON = {
  initialCapital: 10_000_000,
  lowSampleThreshold: 5,
  ranking: { ranking: [], bestKey: null, allLowSample: false },
  strategies: [
    {
      key: 'event-edge',
      label: '이벤트엣지',
      tagline: 't',
      portfolioId: 'pf-ee',
      initialCapital: 10_000_000,
      equityCurve: [
        { snapshotDate: '20260601', totalValue: 10_000_000, returnPct: 0, kind: 'snapshot' },
        { snapshotDate: '20260610', totalValue: 10_200_000, returnPct: 2, kind: 'live' },
      ],
      latestSnapshotDate: '20260610',
      scorecard: {
        closedCount: 8,
        winCount: 4,
        lossCount: 4,
        winRate: 0.5,
        avgPnl: 1000,
        avgPnlPct: 1.5,
        avgHoldDays: 11,
        totalNetPnl: 8000,
        cumulativeReturnPct: 14,
        sampleSize: 8,
        lowSample: false,
      },
      openPositions: 1,
      rules: { entry: 'e', exit: 'x' },
      lowSample: false,
    },
  ],
};

function buildService() {
  const backtestRun = { findMany: jest.fn().mockResolvedValue(BACKTEST_ROWS) };
  const upsert = jest.fn().mockResolvedValue({});
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    backtestRun,
    backtestForwardDivergenceSnapshot: { upsert, findMany },
  };
  const strategyForward = {
    getStrategyForwardComparison: jest.fn().mockResolvedValue(FORWARD_COMPARISON),
  };
  const service = new BacktestForwardDivergenceService(
    prisma as never,
    strategyForward as never,
  );
  return { service, prisma, upsert, findMany, strategyForward };
}

describe('BacktestForwardDivergenceService.getDivergenceReport', () => {
  it('strategyKey 로 백테스트·forward 를 조인해 4지표 괴리를 산출한다(event-edge)', async () => {
    const { service } = buildService();
    const report = await service.getDivergenceReport();

    expect(report.lowSampleThresholds).toEqual({ backtest: 20, forward: 5 });
    const ee = report.strategies.find((s) => s.key === 'event-edge')!;
    expect(ee.lowSample).toBe(false);
    expect(ee.hasBacktest).toBe(true);
    expect(ee.hasForward).toBe(true);

    const byMetric = Object.fromEntries(ee.metrics.map((m) => [m.metric, m]));
    // 수익률: bt 12 vs fw 14 → gap 2 (ALIGNED)
    expect(byMetric.return.backtest).toBe(12);
    expect(byMetric.return.forward).toBe(14);
    expect(byMetric.return.gap).toBe(2);
    expect(byMetric.return.status).toBe('ALIGNED');
    // 승률: bt 0.55(=55%/100) vs fw 0.5 → gap -0.05 (ALIGNED)
    expect(byMetric.winRate.backtest).toBe(0.55);
    expect(byMetric.winRate.forward).toBe(0.5);
    // 거래빈도(월환산): bt 30/90*30=10 vs fw 8/10*30=24 → gap 14 (DIVERGED)
    expect(byMetric.tradeFrequency.backtest).toBe(10);
    expect(byMetric.tradeFrequency.forward).toBe(24);
    expect(byMetric.tradeFrequency.gap).toBe(14);
    expect(byMetric.tradeFrequency.status).toBe('DIVERGED');
    // 보유기간: bt 10 vs fw 11 → gap 1 (ALIGNED)
    expect(byMetric.holdDays.gap).toBe(1);

    expect(ee.diverged).toBe(true);
  });

  it('백테스트/forward 트랙 없는 전략은 LOW_SAMPLE(정직)로 표기한다', async () => {
    const { service } = buildService();
    const report = await service.getDivergenceReport();

    // event-edge 외 3전략은 backtest run·forward 성적표 부재 → 표본 0·LOW_SAMPLE
    const others = report.strategies.filter((s) => s.key !== 'event-edge');
    expect(others.length).toBe(3);
    for (const s of others) {
      expect(s.hasBacktest).toBe(false);
      expect(s.hasForward).toBe(false);
      expect(s.lowSample).toBe(true);
      expect(s.diverged).toBe(false);
      expect(s.metrics.every((m) => m.status === 'LOW_SAMPLE')).toBe(true);
    }
  });
});

describe('BacktestForwardDivergenceService.snapshotDailyDivergence', () => {
  it('전략마다 멱등키(strategyKey+snapshotDate)로 upsert 하고 괴리·원천값을 영속한다', async () => {
    const { service, upsert } = buildService();
    const res = await service.snapshotDailyDivergence('20260703');

    expect(res).toEqual({ snapshotDate: '20260703', snapshotted: 4 });
    expect(upsert).toHaveBeenCalledTimes(4);

    // event-edge upsert 페이로드 검증
    const eeCall = upsert.mock.calls.find(
      (c) => c[0].where.strategyKey_snapshotDate.strategyKey === 'event-edge',
    )!;
    const arg = eeCall[0];
    expect(arg.where.strategyKey_snapshotDate).toEqual({
      strategyKey: 'event-edge',
      snapshotDate: '20260703',
    });
    expect(arg.create.backtestReturnPct).toBe(12);
    expect(arg.create.forwardReturnPct).toBe(14);
    expect(arg.create.backtestTradesPerMonth).toBe(10);
    expect(arg.create.forwardTradesPerMonth).toBe(24);
    expect(arg.create.tradeFreqGap).toBe(14);
    expect(arg.create.backtestTradeCount).toBe(30);
    expect(arg.create.forwardTradeCount).toBe(8);
    expect(arg.create.lowSample).toBe(false);
    // update 페이로드는 create 에서 키만 뺀 동일 값(멱등 갱신)
    expect(arg.update.tradeFreqGap).toBe(14);
  });
});

describe('BacktestForwardDivergenceService.getDivergenceTrend', () => {
  it('스냅샷을 오름차순으로 반환하고 미적재면 빈 배열(정직)', async () => {
    const { service, findMany } = buildService();
    findMany.mockResolvedValueOnce([
      { snapshotDate: '20260703', returnGapPct: 2, winRateGap: -0.05, tradeFreqGap: 14, holdDaysGap: 1, lowSample: false },
      { snapshotDate: '20260702', returnGapPct: 1, winRateGap: 0, tradeFreqGap: 10, holdDaysGap: 0, lowSample: false },
    ]);
    const res = await service.getDivergenceTrend('event-edge');
    // desc 조회 → reverse → 오름차순
    expect(res.points.map((p) => p.snapshotDate)).toEqual(['20260702', '20260703']);

    const empty = await service.getDivergenceTrend('short-momentum');
    expect(empty.points).toEqual([]);
  });
});
