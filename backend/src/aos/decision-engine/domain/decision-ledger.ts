import { createHash } from 'crypto';

import { canonicalizeJson } from '@dart-notification/aos-rule-engine';

import {
  CanonicalMarketRegimeSnapshot,
  CanonicalRuleTraceRecord,
  CanonicalSignalDecisionRecord,
  DecisionLedgerDomainError,
  MarketRegimeSnapshotInput,
  SignalDecisionRecordInput,
} from './decision-ledger.types';

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REGIME_KEY = /^[A-Z][A-Z0-9_]{1,63}$/;
const SESSION_DATE = /^[0-9]{8}$/;

export function buildMarketRegimeSnapshot(
  input: MarketRegimeSnapshotInput,
): CanonicalMarketRegimeSnapshot {
  if (input.market !== undefined && input.market !== 'KR') invalid('market', 'must be KR');
  const asOf = instant(input.asOf, 'asOf');
  const marketSessionDate = sessionDate(input.marketSessionDate);
  const schemaVersion = matching(input.schemaVersion, VERSION, 'schemaVersion');
  const regimeKey = matching(input.regimeKey, REGIME_KEY, 'regimeKey');
  if (
    input.confidence !== null &&
    (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
  ) {
    invalid('confidence', 'must be null or a finite value between 0 and 1');
  }
  object(input.facts, 'facts');
  object(input.sourceRefs, 'sourceRefs');
  object(input.quality, 'quality');

  const payload = {
    market: 'KR' as const,
    asOf,
    marketSessionDate,
    schemaVersion,
    regimeKey,
    confidence: input.confidence,
    facts: input.facts,
    sourceRefs: input.sourceRefs,
    quality: input.quality,
  };
  return Object.freeze({ ...payload, contentHash: sha256(canonicalizeJson(payload)) });
}

export function buildSignalDecisionRecord(
  input: SignalDecisionRecordInput,
): CanonicalSignalDecisionRecord {
  nonBlank(input.featureSnapshotId, 'featureSnapshotId');
  nonBlank(input.strategyVersionId, 'strategyVersionId');
  nonBlank(input.riskPolicyVersionId, 'riskPolicyVersionId');
  if (input.marketRegimeSnapshotId !== undefined)
    nonBlank(input.marketRegimeSnapshotId, 'marketRegimeSnapshotId');
  if (input.legacyTradingSignalId !== undefined)
    nonBlank(input.legacyTradingSignalId, 'legacyTradingSignalId');

  const receipt = input.evaluation.receipt;
  if (receipt.version.strategyVersionId !== input.strategyVersionId) {
    mismatch('strategyVersionId');
  }
  if (receipt.version.riskPolicyVersionId !== input.riskPolicyVersionId) {
    mismatch('riskPolicyVersionId');
  }
  if (receipt.snapshot.contentHash.length !== 64)
    invalid('snapshot.contentHash', 'must be SHA-256');

  const evaluatedAt = instant(input.evaluatedAt, 'evaluatedAt');
  const receiptHash = sha256(input.evaluation.canonicalReceipt);
  const legacyScore = optionalLegacyScore(input.legacyScore);
  const scoreDelta = legacyScore === undefined ? undefined : normalize(receipt.score - legacyScore);
  const parityStatus =
    legacyScore === undefined ? 'NOT_COMPARED' : scoreDelta === 0 ? 'MATCH' : 'MISMATCH';
  const traces = Object.freeze(receipt.traces.map(toTraceRecord));
  const decisionKey = `aos:${sha256(
    canonicalizeJson({
      mode: input.mode,
      evaluationKey: receipt.evaluationKey,
      featureSnapshotId: input.featureSnapshotId,
      receiptHash,
    }),
  )}`;

  return Object.freeze({
    decisionKey,
    mode: input.mode,
    featureSnapshotId: input.featureSnapshotId,
    ...(input.marketRegimeSnapshotId
      ? { marketRegimeSnapshotId: input.marketRegimeSnapshotId }
      : {}),
    strategyVersionId: input.strategyVersionId,
    riskPolicyVersionId: input.riskPolicyVersionId,
    ...(input.legacyTradingSignalId ? { legacyTradingSignalId: input.legacyTradingSignalId } : {}),
    evaluatorVersion: receipt.evaluatorVersion,
    receiptSchemaVersion: receipt.receiptSchemaVersion,
    status: receipt.status,
    score: receipt.score,
    blockReasonCodes: Object.freeze([...receipt.blockReasonCodes]),
    decisionJson: receipt as unknown as CanonicalSignalDecisionRecord['decisionJson'],
    receiptHash,
    ...(legacyScore === undefined ? {} : { legacyScore, scoreDelta }),
    parityStatus,
    evaluatedAt,
    traces,
  });
}

function toTraceRecord(trace: {
  readonly executionOrder: number;
  readonly ruleKey: string;
  readonly implementationKey: string;
  readonly category: string;
  readonly priority: number;
  readonly parameterHash: string;
  readonly status: string;
  readonly contribution: number;
  readonly reasonCodes: readonly string[];
  readonly facts: CanonicalRuleTraceRecord['facts'];
}): CanonicalRuleTraceRecord {
  const payload = {
    executionOrder: trace.executionOrder,
    ruleKey: trace.ruleKey,
    implementationKey: trace.implementationKey,
    category: trace.category,
    priority: trace.priority,
    parameterHash: trace.parameterHash,
    status: trace.status,
    contribution: trace.contribution,
    reasonCodes: Object.freeze([...trace.reasonCodes]),
    facts: trace.facts,
  };
  return Object.freeze({ ...payload, traceHash: sha256(canonicalizeJson(payload)) });
}

function object(value: unknown, field: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(field, 'must be a JSON object');
  }
  canonicalizeJson(value);
}

function optionalLegacyScore(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < -100 || value > 100) {
    invalid('legacyScore', 'must be an integer between -100 and 100');
  }
  return value;
}

function sessionDate(value: string): string {
  matching(value, SESSION_DATE, 'marketSessionDate');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrip = `${parsed.getUTCFullYear().toString().padStart(4, '0')}${(
    parsed.getUTCMonth() + 1
  )
    .toString()
    .padStart(2, '0')}${parsed.getUTCDate().toString().padStart(2, '0')}`;
  if (roundTrip !== value) invalid('marketSessionDate', 'must be a real date');
  return value;
}

function instant(value: unknown, field: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid(field, 'must be Date');
  return (value as Date).toISOString();
}

function matching(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(field, 'has invalid format');
  return value as string;
}

function nonBlank(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(field, 'must be non-blank');
}

function normalize(value: number): number {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(6));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalid(field: string, reason: string): never {
  throw new DecisionLedgerDomainError(
    'INVALID_DECISION_LEDGER_INPUT',
    `Invalid decision ledger input at ${field}: ${reason}.`,
  );
}

function mismatch(field: string): never {
  throw new DecisionLedgerDomainError(
    'VERSION_REFERENCE_MISMATCH',
    `Evaluation receipt ${field} does not match the pinned ledger reference.`,
  );
}
