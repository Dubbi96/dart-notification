import { createHash } from 'crypto';

import {
  canonicalizeJson,
  type JsonObject,
  type JsonValue,
} from '@dart-notification/aos-rule-engine';

import type {
  PerformanceMetrics,
  SimulatedTrade,
} from '../../../engine3-quant-market/backtest/ports/backtest.types';
import {
  AosBacktestDomainError,
  BacktestAcceptancePolicy,
  BacktestAcceptanceRecord,
  BacktestAttributionRecord,
  BacktestWindowRecord,
  DatasetManifestInput,
  SensitivityObservation,
  WalkForwardWindowInput,
} from './versioned-backtest.types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function hashDatasetManifest(input: DatasetManifestInput): string {
  if (!VERSION.test(input.version)) invalid('dataset version format');
  if (!(input.asOf instanceof Date) || !Number.isFinite(input.asOf.getTime())) {
    invalid('dataset asOf must be a valid Date');
  }
  return sha256(
    canonicalizeJson({
      version: input.version,
      asOf: input.asOf.toISOString(),
      sources: input.sources,
    }),
  );
}

export function validateWalkForwardWindows(
  windows: readonly WalkForwardWindowInput[],
  runStart: string,
  runEnd: string,
): readonly WalkForwardWindowInput[] {
  date(runStart, 'runStart');
  date(runEnd, 'runEnd');
  if (runStart > runEnd) invalid('run start must not be after end');
  const ordered = [...windows].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<number>();
  for (const window of ordered) {
    if (!Number.isInteger(window.sequence) || window.sequence < 0 || seen.has(window.sequence)) {
      invalid('window sequence must be unique non-negative integer');
    }
    seen.add(window.sequence);
    date(window.startDate, 'window.startDate');
    date(window.endDate, 'window.endDate');
    if (window.startDate > window.endDate) invalid('window start must not be after end');
    if (window.startDate < runStart || window.endDate > runEnd) invalid('window outside run range');
  }
  return Object.freeze(ordered.map((window) => Object.freeze({ ...window })));
}

export function buildAcceptanceRecords(
  policy: BacktestAcceptancePolicy | undefined,
  metrics: PerformanceMetrics,
  windows: readonly BacktestWindowRecord[],
  trades: readonly SimulatedTrade[],
  sensitivity: readonly SensitivityObservation[],
): { status: 'NOT_EVALUATED' | 'PASSED' | 'FAILED'; records: readonly BacktestAcceptanceRecord[] } {
  if (!policy) return { status: 'NOT_EVALUATED', records: Object.freeze([]) };
  const testWindows = windows.filter((window) => window.role === 'TEST');
  const outOfSampleReturn = testWindows.reduce(
    (sum, window) => sum + window.metrics.totalReturn,
    0,
  );
  const counts = new Map<string, number>();
  for (const trade of trades) counts.set(trade.stockCode, (counts.get(trade.stockCode) ?? 0) + 1);
  const maxSingleAssetSharePct =
    trades.length === 0 ? 0 : (Math.max(...counts.values(), 0) / trades.length) * 100;
  const neighborPassRate =
    sensitivity.length === 0
      ? 0
      : sensitivity.filter((observation) => observation.passed).length / sensitivity.length;
  const values: Array<[string, boolean, JsonObject, JsonObject]> = [
    [
      'MIN_TRADES',
      metrics.totalTrades >= policy.minTrades,
      { value: metrics.totalTrades },
      { min: policy.minTrades },
    ],
    [
      'NET_RETURN_AFTER_COST',
      metrics.totalReturn >= policy.minNetReturnPct,
      { value: metrics.totalReturn },
      { min: policy.minNetReturnPct },
    ],
    [
      'MAX_DRAWDOWN',
      metrics.mdd >= policy.maxDrawdownPct,
      { value: metrics.mdd },
      { min: policy.maxDrawdownPct },
    ],
    [
      'PROFIT_FACTOR',
      metrics.profitFactor >= policy.minProfitFactor,
      { value: finiteOrText(metrics.profitFactor) },
      { min: policy.minProfitFactor },
    ],
    [
      'OUT_OF_SAMPLE_RETURN',
      !policy.requireOutOfSamplePositive || (testWindows.length > 0 && outOfSampleReturn > 0),
      { value: outOfSampleReturn, testWindows: testWindows.length },
      { positiveRequired: policy.requireOutOfSamplePositive },
    ],
    [
      'MAX_SINGLE_ASSET_SHARE',
      maxSingleAssetSharePct <= policy.maxSingleAssetSharePct,
      { value: maxSingleAssetSharePct },
      { max: policy.maxSingleAssetSharePct },
    ],
    [
      'NEIGHBOR_STABILITY',
      neighborPassRate >= policy.minNeighborPassRate,
      { value: neighborPassRate, samples: sensitivity.length },
      { min: policy.minNeighborPassRate },
    ],
  ];
  const records = values.map(([criterionKey, passed, actual, threshold]) => {
    const payload = { criterionKey, passed, actual, threshold };
    return Object.freeze({ ...payload, evidenceHash: sha256(canonicalizeJson(payload)) });
  });
  return {
    status: records.every((record) => record.passed) ? 'PASSED' : 'FAILED',
    records: Object.freeze(records),
  };
}

export function buildAttributions(
  trades: readonly SimulatedTrade[],
): readonly BacktestAttributionRecord[] {
  const groups = new Map<
    string,
    { dimension: BacktestAttributionRecord['dimension']; key: string; trades: SimulatedTrade[] }
  >();
  const add = (
    dimension: BacktestAttributionRecord['dimension'],
    key: string | undefined,
    trade: SimulatedTrade,
  ) => {
    if (!key) return;
    const identity = `${dimension}:${key}`;
    const group = groups.get(identity) ?? { dimension, key, trades: [] };
    group.trades.push(trade);
    groups.set(identity, group);
  };
  for (const trade of trades) {
    add('EVENT', trade.eventType, trade);
    add('PERSONA', trade.persona, trade);
    add('REGIME', trade.regimeKey, trade);
    for (const ruleKey of trade.passedRuleKeys ?? []) add('RULE', ruleKey, trade);
  }
  return Object.freeze(
    [...groups.values()]
      .sort((a, b) => `${a.dimension}:${a.key}`.localeCompare(`${b.dimension}:${b.key}`))
      .map((group) => {
        const closed = group.trades.filter((trade) => trade.netPnl !== undefined);
        const wins = closed.filter((trade) => (trade.netPnl ?? 0) > 0).length;
        return Object.freeze({
          dimension: group.dimension,
          key: group.key,
          metrics: {
            trades: closed.length,
            winRate: closed.length === 0 ? 0 : wins / closed.length,
            avgReturn:
              closed.length === 0
                ? 0
                : closed.reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0) / closed.length,
            totalNetPnl: closed.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0),
          },
        });
      }),
  );
}

export function hashBacktestReceipt(value: JsonObject): string {
  return sha256(canonicalizeJson(value));
}

export function jsonSafe(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, jsonSafe(child)]),
    );
  }
  return String(value);
}

function finiteOrText(value: number): number | string {
  return Number.isFinite(value) ? value : value > 0 ? 'INF' : '-INF';
}

function date(value: string, field: string): void {
  if (!DATE.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)))
    invalid(`${field} invalid`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalid(message: string): never {
  throw new AosBacktestDomainError(message);
}
