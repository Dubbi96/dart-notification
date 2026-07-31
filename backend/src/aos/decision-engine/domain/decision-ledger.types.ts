import type {
  CanonicalRuleEvaluation,
  JsonObject,
  RuleEvaluationRequest,
  RuleEvaluationTrace,
  RuleImplementationRegistry,
} from '@dart-notification/aos-rule-engine';

export type DecisionMode = 'LEGACY_PARITY' | 'BACKTEST' | 'SHADOW' | 'LIVE';
export type DecisionParityStatus = 'MATCH' | 'MISMATCH' | 'NOT_COMPARED';

export interface MarketRegimeSnapshotInput {
  readonly market?: 'KR';
  readonly asOf: Date;
  readonly marketSessionDate: string;
  readonly schemaVersion: string;
  readonly regimeKey: string;
  readonly confidence: number | null;
  readonly facts: JsonObject;
  readonly sourceRefs: JsonObject;
  readonly quality: JsonObject;
}

export interface CanonicalMarketRegimeSnapshot {
  readonly market: 'KR';
  readonly asOf: string;
  readonly marketSessionDate: string;
  readonly schemaVersion: string;
  readonly regimeKey: string;
  readonly confidence: number | null;
  readonly facts: JsonObject;
  readonly sourceRefs: JsonObject;
  readonly quality: JsonObject;
  readonly contentHash: string;
}

export interface SignalDecisionRecordInput {
  readonly mode: DecisionMode;
  readonly featureSnapshotId: string;
  readonly marketRegimeSnapshotId?: string;
  readonly strategyVersionId: string;
  readonly riskPolicyVersionId: string;
  readonly legacyTradingSignalId?: string;
  readonly legacyScore?: number;
  readonly evaluatedAt: Date;
  readonly evaluation: CanonicalRuleEvaluation;
}

export interface CanonicalRuleTraceRecord {
  readonly executionOrder: number;
  readonly ruleKey: string;
  readonly implementationKey: string;
  readonly category: string;
  readonly priority: number;
  readonly parameterHash: string;
  readonly status: string;
  readonly contribution: number;
  readonly reasonCodes: readonly string[];
  readonly facts: JsonObject;
  readonly traceHash: string;
}

export interface CanonicalSignalDecisionRecord {
  readonly decisionKey: string;
  readonly mode: DecisionMode;
  readonly featureSnapshotId: string;
  readonly marketRegimeSnapshotId?: string;
  readonly strategyVersionId: string;
  readonly riskPolicyVersionId: string;
  readonly legacyTradingSignalId?: string;
  readonly evaluatorVersion: string;
  readonly receiptSchemaVersion: string;
  readonly status: 'COMPLETED' | 'BLOCKED';
  readonly score: number;
  readonly blockReasonCodes: readonly string[];
  readonly decisionJson: JsonObject;
  readonly receiptHash: string;
  readonly legacyScore?: number;
  readonly scoreDelta?: number;
  readonly parityStatus: DecisionParityStatus;
  readonly evaluatedAt: string;
  readonly traces: readonly CanonicalRuleTraceRecord[];
}

export interface EvaluateAndRecordDecisionInput extends Omit<
  SignalDecisionRecordInput,
  'evaluation'
> {
  readonly request: RuleEvaluationRequest;
  readonly registry: RuleImplementationRegistry;
}

export type { RuleEvaluationTrace };

export class DecisionLedgerDomainError extends Error {
  constructor(
    readonly code: 'INVALID_DECISION_LEDGER_INPUT' | 'VERSION_REFERENCE_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'DecisionLedgerDomainError';
  }
}
