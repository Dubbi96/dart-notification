import type { JsonObject } from '@dart-notification/aos-rule-engine';

import type {
  BacktestCostParams,
  DisclosureSignal,
  PerformanceMetrics,
  SimulatedTrade,
  StrategyParams,
} from '../../../engine3-quant-market/backtest/ports/backtest.types';
import type { PriceDataPort } from '../../../engine3-quant-market/backtest/ports/price-data.port';

export type AosBacktestRunType = 'LEGACY_PIT_ADAPTER' | 'VERSIONED_EVALUATOR';
export type AosBacktestWindowRole = 'TRAIN' | 'VALIDATION' | 'TEST';

export interface DatasetManifestInput {
  readonly version: string;
  readonly asOf: Date;
  readonly sources: JsonObject;
}

export interface WalkForwardWindowInput {
  readonly sequence: number;
  readonly role: AosBacktestWindowRole;
  readonly startDate: string;
  readonly endDate: string;
}

export interface BacktestAcceptancePolicy {
  readonly minTrades: number;
  readonly minNetReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly minProfitFactor: number;
  readonly requireOutOfSamplePositive: boolean;
  readonly maxSingleAssetSharePct: number;
  readonly minNeighborPassRate: number;
}

export interface SensitivityObservation {
  readonly parameterKey: string;
  readonly offset: number;
  readonly passed: boolean;
  readonly metrics: JsonObject;
}

export interface AosBacktestExecutionInput {
  readonly runType: AosBacktestRunType;
  readonly strategyVersionId: string;
  readonly riskPolicyVersionId: string;
  readonly evaluatorVersion: string;
  readonly dataset: DatasetManifestInput;
  readonly startDate: string;
  readonly endDate: string;
  readonly strategy: StrategyParams;
  readonly costs: BacktestCostParams;
  readonly signals: DisclosureSignal[];
  readonly priceDataPort: PriceDataPort;
  readonly windows: readonly WalkForwardWindowInput[];
  readonly sensitivity: readonly SensitivityObservation[];
  readonly acceptancePolicy?: BacktestAcceptancePolicy;
}

export interface BacktestWindowRecord extends WalkForwardWindowInput {
  readonly metrics: PerformanceMetrics;
}

export interface BacktestAcceptanceRecord {
  readonly criterionKey: string;
  readonly passed: boolean;
  readonly actual: JsonObject;
  readonly threshold: JsonObject;
  readonly evidenceHash: string;
}

export interface BacktestAttributionRecord {
  readonly dimension: 'RULE' | 'REGIME' | 'EVENT' | 'PERSONA';
  readonly key: string;
  readonly metrics: JsonObject;
}

export interface CanonicalAosBacktestRecord {
  readonly replayKey: string;
  readonly runType: AosBacktestRunType;
  readonly strategyVersionId: string;
  readonly strategyContentHash: string;
  readonly riskPolicyVersionId: string;
  readonly riskPolicyContentHash: string;
  readonly datasetVersion: string;
  readonly datasetHash: string;
  readonly evaluatorVersion: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly initialCapital: number;
  readonly strategy: StrategyParams;
  readonly costs: BacktestCostParams;
  readonly metrics: PerformanceMetrics;
  readonly windows: readonly BacktestWindowRecord[];
  readonly trades: readonly SimulatedTrade[];
  readonly sensitivity: readonly SensitivityObservation[];
  readonly attributions: readonly BacktestAttributionRecord[];
  readonly acceptanceStatus: 'NOT_EVALUATED' | 'PASSED' | 'FAILED';
  readonly acceptance: readonly BacktestAcceptanceRecord[];
  readonly receiptHash: string;
}

export class AosBacktestDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AosBacktestDomainError';
  }
}
