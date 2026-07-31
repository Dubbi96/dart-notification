export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type RuleCategory =
  "ENTRY" | "EXIT" | "SIZING" | "REGIME" | "PORTFOLIO" | "RISK";

export type MissingFeaturePolicy = "BLOCK" | "ABSTAIN";

export type RuleResultStatus = "PASS" | "FAIL" | "ABSTAIN";

export interface EvaluationVersionRef {
  readonly strategyVersionId: string;
  readonly strategyContentHash: string;
  readonly riskPolicyVersionId: string;
  readonly riskPolicyContentHash: string;
}

export interface FeatureSnapshot {
  readonly schemaVersion: string;
  readonly contentHash: string;
  readonly asOf: string;
  readonly subject: {
    readonly market: "KR_STOCK";
    readonly assetKey: string;
  };
  readonly values: JsonObject;
}

export interface VersionedRule {
  readonly ruleKey: string;
  readonly implementationKey: string;
  readonly category: RuleCategory;
  readonly priority: number;
  readonly enabled: boolean;
  readonly weight: number;
  readonly parameterHash: string;
  readonly parameters: JsonObject;
  readonly requiredFeatures: readonly string[];
  readonly missingFeaturePolicy: MissingFeaturePolicy;
}

export interface RuleEvaluationRequest {
  readonly receiptSchemaVersion: string;
  readonly evaluatorVersion: string;
  readonly evaluationKey: string;
  readonly version: EvaluationVersionRef;
  readonly snapshot: FeatureSnapshot;
  readonly rules: readonly VersionedRule[];
}

export interface RuleImplementationContext {
  readonly snapshot: FeatureSnapshot;
  readonly rule: VersionedRule;
}

export interface RuleImplementationResult {
  readonly status: RuleResultStatus;
  readonly scoreDelta: number;
  readonly reasonCodes: readonly string[];
  readonly facts?: JsonObject;
}

export type RuleImplementation = (
  context: RuleImplementationContext,
) => RuleImplementationResult;

export type RuleImplementationRegistry = Readonly<
  Record<string, RuleImplementation>
>;

export type RuleTraceStatus =
  | RuleResultStatus
  | "SKIPPED_DISABLED"
  | "MISSING_FEATURE"
  | "MISSING_IMPLEMENTATION"
  | "IMPLEMENTATION_ERROR"
  | "INVALID_RESULT";

export interface RuleEvaluationTrace {
  readonly executionOrder: number;
  readonly ruleKey: string;
  readonly implementationKey: string;
  readonly category: RuleCategory;
  readonly priority: number;
  readonly parameterHash: string;
  readonly status: RuleTraceStatus;
  readonly contribution: number;
  readonly reasonCodes: readonly string[];
  readonly facts: JsonObject;
}

export type EvaluationStatus = "COMPLETED" | "BLOCKED";

export interface RuleEvaluationReceipt {
  readonly receiptSchemaVersion: string;
  readonly evaluatorVersion: string;
  readonly evaluationKey: string;
  readonly version: EvaluationVersionRef;
  readonly snapshot: FeatureSnapshot;
  readonly status: EvaluationStatus;
  readonly score: number;
  readonly blockReasonCodes: readonly string[];
  readonly traces: readonly RuleEvaluationTrace[];
}

export interface CanonicalRuleEvaluation {
  readonly receipt: RuleEvaluationReceipt;
  readonly canonicalReceipt: string;
}

export type RuleEvaluationErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_HASH"
  | "DUPLICATE_RULE_KEY"
  | "INVALID_RULE_CONFIG"
  | "INVALID_JSON_VALUE";

export class RuleEvaluationError extends Error {
  readonly code: RuleEvaluationErrorCode;

  constructor(code: RuleEvaluationErrorCode, message: string) {
    super(message);
    this.name = "RuleEvaluationError";
    this.code = code;
  }
}
