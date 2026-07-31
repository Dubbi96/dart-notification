import { PrismaService } from '../../../prisma/prisma.service';
import { CanonicalAosBacktestRecord } from '../domain/versioned-backtest.types';
import { RecordAosBacktestRunService } from './record-aos-backtest-run.service';

describe('RecordAosBacktestRunService', () => {
  it('모든 결과를 단일 transaction 안에서 append-only createMany로 멱등 기록한다', async () => {
    const tx = {
      aosBacktestRun: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'run-1' }),
      },
      aosBacktestWindow: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      aosBacktestTrade: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      aosBacktestAttribution: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      aosBacktestAcceptanceCriterion: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    } as unknown as PrismaService;
    const service = new RecordAosBacktestRunService(prisma);

    const result = await service.record(record());

    expect(Object.isFrozen(result)).toBe(true);
    expect(result.id).toBe('run-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.aosBacktestRun.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.aosBacktestWindow.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.aosBacktestTrade.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.aosBacktestAttribution.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.aosBacktestAcceptanceCriterion.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});

function record(): CanonicalAosBacktestRecord {
  const metrics = {
    totalReturn: 1,
    annualizedReturn: 1,
    winRate: 100,
    avgWin: 1,
    avgLoss: 0,
    profitFactor: 1,
    mdd: 0,
    sharpe: 1,
    totalTrades: 1,
    wonTrades: 1,
    lostTrades: 0,
    avgHoldDays: 1,
    monthlyReturns: {},
    byEventType: {},
    byPersona: {},
    worstTrades: [],
    realWorldGate: {
      allMarketConditions: true,
      netPositiveAfterCost: true,
      diversified: true,
      sufficientSamples: true,
      mddAcceptable: true,
      recentPeriodConsistent: true,
    },
    passedGate: true,
  } as const;
  return {
    replayKey: 'aos-backtest:receipt-1',
    runType: 'VERSIONED_EVALUATOR',
    strategyVersionId: 'strategy-1',
    strategyContentHash: 'strategy-hash',
    riskPolicyVersionId: 'risk-1',
    riskPolicyContentHash: 'risk-hash',
    datasetVersion: 'dataset-1',
    datasetHash: 'dataset-hash',
    evaluatorVersion: 'evaluator-1',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    initialCapital: 10_000_000,
    strategy: { initialCapital: 10_000_000 } as CanonicalAosBacktestRecord['strategy'],
    costs: { commissionRate: 0, taxRate: 0, slippageRate: 0 },
    metrics,
    windows: [
      {
        sequence: 0,
        role: 'TEST',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        metrics,
      },
    ],
    trades: [
      {
        rcpNo: '20250101000001',
        corpCode: '00126380',
        stockCode: '005930',
        eventType: 'SUPPLY_CONTRACT',
        persona: 'GROWTH',
        buyScore: 60,
        disclosureAt: new Date('2025-01-01T01:00:00.000Z'),
        isAfterMarket: false,
        entryDate: new Date('2025-01-02T00:00:00.000Z'),
        entryPrice: 100,
        entryShares: 10,
        entryValue: 1000,
        exitDate: new Date('2025-01-03T00:00:00.000Z'),
        exitPrice: 105,
        exitShares: 10,
        exitValue: 1050,
        exitReason: 'TAKE_PROFIT',
        commission: 1,
        tax: 1,
        slippage: 1,
        grossPnl: 50,
        netPnl: 47,
        returnPct: 4.7,
        holdDays: 1,
        wasLimitUp: false,
        wasLimitDown: false,
        wasTradingSuspended: false,
        wasAdminStock: false,
        isPartialFill: false,
        lowLiquidityFlag: false,
        signalDecisionId: 'decision-1',
        regimeKey: 'BULL',
        passedRuleKeys: ['entry.score'],
        maxAdverseExcursionPct: -1,
        maxFavorableExcursionPct: 5,
      },
    ],
    sensitivity: [],
    attributions: [{ dimension: 'RULE', key: 'entry.score', metrics: {} }],
    acceptanceStatus: 'PASSED',
    acceptance: [
      {
        criterionKey: 'minTrades',
        passed: true,
        actual: { value: 1 },
        threshold: { value: 1 },
        evidenceHash: 'evidence-hash',
      },
    ],
    receiptHash: 'receipt-hash',
  };
}
