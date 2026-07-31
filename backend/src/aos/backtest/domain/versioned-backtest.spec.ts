import type {
  PerformanceMetrics,
  SimulatedTrade,
} from '../../../engine3-quant-market/backtest/ports/backtest.types';
import {
  buildAcceptanceRecords,
  buildAttributions,
  hashDatasetManifest,
  validateWalkForwardWindows,
} from './versioned-backtest';

const metrics = {
  totalReturn: 8,
  annualizedReturn: 8,
  winRate: 55,
  avgWin: 4,
  avgLoss: -2,
  profitFactor: 1.4,
  mdd: -9,
  sharpe: 1,
  totalTrades: 40,
  wonTrades: 22,
  lostTrades: 18,
  avgHoldDays: 5,
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
} satisfies PerformanceMetrics;

describe('AOS versioned backtest domain', () => {
  it('dataset manifest hash와 window 순서를 결정적으로 고정한다', () => {
    const manifest = {
      version: 'krx-eod.2026-08-01',
      asOf: new Date('2026-08-01T11:00:00.000Z'),
      sources: { prices: 'krx', disclosures: 'dart' },
    } as const;
    expect(hashDatasetManifest(manifest)).toBe(hashDatasetManifest(manifest));
    expect(
      validateWalkForwardWindows(
        [
          { sequence: 2, role: 'TEST', startDate: '2025-09-01', endDate: '2025-12-31' },
          { sequence: 0, role: 'TRAIN', startDate: '2025-01-01', endDate: '2025-06-30' },
          { sequence: 1, role: 'VALIDATION', startDate: '2025-07-01', endDate: '2025-08-31' },
        ],
        '2025-01-01',
        '2025-12-31',
      ).map((window) => window.role),
    ).toEqual(['TRAIN', 'VALIDATION', 'TEST']);
  });

  it('명시적으로 주입된 acceptance policy만 평가하고 evidence hash를 남긴다', () => {
    expect(buildAcceptanceRecords(undefined, metrics, [], [], [])).toEqual({
      status: 'NOT_EVALUATED',
      records: [],
    });
    const result = buildAcceptanceRecords(
      {
        minTrades: 30,
        minNetReturnPct: 0,
        maxDrawdownPct: -15,
        minProfitFactor: 1.1,
        requireOutOfSamplePositive: true,
        maxSingleAssetSharePct: 30,
        minNeighborPassRate: 0.5,
      },
      metrics,
      [
        {
          sequence: 2,
          role: 'TEST',
          startDate: '2025-09-01',
          endDate: '2025-12-31',
          metrics,
        },
      ],
      [trade('005930'), trade('000660')],
      [
        { parameterKey: 'minScore', offset: -1, passed: true, metrics: {} },
        { parameterKey: 'minScore', offset: 1, passed: true, metrics: {} },
      ],
    );
    expect(result.status).toBe('FAILED'); // 2건 중 단일종목 비중 50%가 max 30%를 초과
    expect(result.records).toHaveLength(7);
    expect(result.records.every((record) => /^[0-9a-f]{64}$/.test(record.evidenceHash))).toBe(true);
  });

  it('Rule·Regime·Event·Persona별 성과 귀속을 만든다', () => {
    const rows = buildAttributions([
      trade('005930', { regimeKey: 'BULL', passedRuleKeys: ['entry.score', 'risk.safe'] }),
    ]);
    expect(rows.map((row) => `${row.dimension}:${row.key}`).sort()).toEqual([
      'EVENT:SUPPLY_CONTRACT',
      'PERSONA:GROWTH',
      'REGIME:BULL',
      'RULE:entry.score',
      'RULE:risk.safe',
    ]);
  });
});

function trade(stockCode: string, over: Partial<SimulatedTrade> = {}): SimulatedTrade {
  return {
    rcpNo: '20250101000001',
    corpCode: stockCode === '005930' ? '00126380' : '00164779',
    stockCode,
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore: 60,
    disclosureAt: new Date('2025-01-01T01:00:00Z'),
    isAfterMarket: false,
    entryDate: new Date('2025-01-02T00:00:00Z'),
    entryPrice: 100,
    entryShares: 10,
    entryValue: 1000,
    exitDate: new Date('2025-01-03T00:00:00Z'),
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
    ...over,
  };
}
