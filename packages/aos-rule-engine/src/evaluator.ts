import { assertJsonValue, canonicalizeJson } from "./canonical-json";
import {
  CanonicalRuleEvaluation,
  FeatureSnapshot,
  JsonObject,
  JsonValue,
  RuleEvaluationError,
  RuleEvaluationReceipt,
  RuleEvaluationRequest,
  RuleEvaluationTrace,
  RuleImplementation,
  RuleImplementationRegistry,
  RuleImplementationResult,
  RuleResultStatus,
  VersionedRule,
} from "./types";

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RULE_CATEGORIES = new Set([
  "ENTRY",
  "EXIT",
  "SIZING",
  "REGIME",
  "PORTFOLIO",
  "RISK",
]);
const RULE_RESULT_STATUSES = new Set<RuleResultStatus>([
  "PASS",
  "FAIL",
  "ABSTAIN",
]);
const MAX_ABSOLUTE_SCORE = 1_000_000_000;
const EMPTY_FACTS: JsonObject = Object.freeze({});

function requireNonEmpty(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      `${label}: 비어 있지 않은 문자열이어야 합니다.`,
    );
  }
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    throw new RuleEvaluationError(
      "INVALID_HASH",
      `${label}: 소문자 SHA-256 문자열이어야 합니다.`,
    );
  }
}

function requireFiniteNumber(
  value: unknown,
  label: string,
  minimum?: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_ABSOLUTE_SCORE ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      `${label}: 허용 범위의 유한한 숫자여야 합니다.`,
    );
  }
}

function normalizedScore(value: number): number {
  const normalized = Number(value.toFixed(12));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function uniqueSortedStrings(
  values: unknown,
  label: string,
  errorCode: "INVALID_RULE_CONFIG" | "INVALID_REQUEST",
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new RuleEvaluationError(errorCode, `${label}: 배열이어야 합니다.`);
  }

  const normalized = values.map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RuleEvaluationError(
        errorCode,
        `${label}[${index}]: 비어 있지 않은 문자열이어야 합니다.`,
      );
    }
    return value;
  });

  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw new RuleEvaluationError(
      errorCode,
      `${label}: 중복 문자열은 허용되지 않습니다.`,
    );
  }

  return Object.freeze([...unique].sort());
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJson(item))) as T;
  }

  const objectValue = value as Readonly<Record<string, JsonValue>>;
  const clone = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(objectValue).sort()) {
    const child = objectValue[key];
    if (child !== undefined) {
      clone[key] = cloneJson(child);
    }
  }
  return Object.freeze(clone) as T;
}

function validateSnapshot(snapshot: FeatureSnapshot): FeatureSnapshot {
  if (snapshot === null || typeof snapshot !== "object") {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "snapshot: object여야 합니다.",
    );
  }

  requireNonEmpty(snapshot.schemaVersion, "snapshot.schemaVersion");
  requireHash(snapshot.contentHash, "snapshot.contentHash");
  requireNonEmpty(snapshot.asOf, "snapshot.asOf");
  if (!UTC_TIMESTAMP_PATTERN.test(snapshot.asOf)) {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "snapshot.asOf: UTC ISO-8601 밀리초 형식이어야 합니다.",
    );
  }

  if (
    snapshot.subject === null ||
    typeof snapshot.subject !== "object" ||
    snapshot.subject.market !== "KR_STOCK"
  ) {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "snapshot.subject.market: KR_STOCK이어야 합니다.",
    );
  }
  requireNonEmpty(snapshot.subject.assetKey, "snapshot.subject.assetKey");
  assertJsonValue(snapshot.values, "INVALID_REQUEST", "snapshot.values");
  if (Array.isArray(snapshot.values) || snapshot.values === null) {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "snapshot.values: JSON object여야 합니다.",
    );
  }

  return Object.freeze({
    schemaVersion: snapshot.schemaVersion,
    contentHash: snapshot.contentHash,
    asOf: snapshot.asOf,
    subject: Object.freeze({
      market: "KR_STOCK" as const,
      assetKey: snapshot.subject.assetKey,
    }),
    values: cloneJson(snapshot.values),
  });
}

function validateRule(rule: VersionedRule): VersionedRule {
  if (rule === null || typeof rule !== "object") {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      "rule: object여야 합니다.",
    );
  }

  requireNonEmpty(rule.ruleKey, "rule.ruleKey");
  requireNonEmpty(rule.implementationKey, `${rule.ruleKey}.implementationKey`);
  if (!RULE_CATEGORIES.has(rule.category)) {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      `${rule.ruleKey}.category: 지원하지 않는 category입니다.`,
    );
  }
  if (!Number.isInteger(rule.priority) || rule.priority < 0) {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      `${rule.ruleKey}.priority: 0 이상의 정수여야 합니다.`,
    );
  }
  if (typeof rule.enabled !== "boolean") {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      `${rule.ruleKey}.enabled: boolean이어야 합니다.`,
    );
  }
  requireFiniteNumber(rule.weight, `${rule.ruleKey}.weight`, 0);
  requireHash(rule.parameterHash, `${rule.ruleKey}.parameterHash`);
  assertJsonValue(
    rule.parameters,
    "INVALID_RULE_CONFIG",
    `${rule.ruleKey}.parameters`,
  );
  if (Array.isArray(rule.parameters) || rule.parameters === null) {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      `${rule.ruleKey}.parameters: JSON object여야 합니다.`,
    );
  }
  if (
    rule.missingFeaturePolicy !== "BLOCK" &&
    rule.missingFeaturePolicy !== "ABSTAIN"
  ) {
    throw new RuleEvaluationError(
      "INVALID_RULE_CONFIG",
      `${rule.ruleKey}.missingFeaturePolicy: BLOCK 또는 ABSTAIN이어야 합니다.`,
    );
  }

  return Object.freeze({
    ruleKey: rule.ruleKey,
    implementationKey: rule.implementationKey,
    category: rule.category,
    priority: rule.priority,
    enabled: rule.enabled,
    weight: rule.weight,
    parameterHash: rule.parameterHash,
    parameters: cloneJson(rule.parameters),
    requiredFeatures: uniqueSortedStrings(
      rule.requiredFeatures,
      `${rule.ruleKey}.requiredFeatures`,
      "INVALID_RULE_CONFIG",
    ),
    missingFeaturePolicy: rule.missingFeaturePolicy,
  });
}

function validateRequest(request: RuleEvaluationRequest): {
  readonly request: Omit<RuleEvaluationRequest, "snapshot" | "rules">;
  readonly snapshot: FeatureSnapshot;
  readonly rules: readonly VersionedRule[];
} {
  if (request === null || typeof request !== "object") {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "evaluation request는 object여야 합니다.",
    );
  }

  requireNonEmpty(request.receiptSchemaVersion, "receiptSchemaVersion");
  requireNonEmpty(request.evaluatorVersion, "evaluatorVersion");
  requireNonEmpty(request.evaluationKey, "evaluationKey");

  if (request.version === null || typeof request.version !== "object") {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "version: object여야 합니다.",
    );
  }
  requireNonEmpty(
    request.version.strategyVersionId,
    "version.strategyVersionId",
  );
  requireHash(
    request.version.strategyContentHash,
    "version.strategyContentHash",
  );
  requireNonEmpty(
    request.version.riskPolicyVersionId,
    "version.riskPolicyVersionId",
  );
  requireHash(
    request.version.riskPolicyContentHash,
    "version.riskPolicyContentHash",
  );

  if (!Array.isArray(request.rules)) {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "rules: 배열이어야 합니다.",
    );
  }

  const ruleKeys = new Set<string>();
  const rules = request.rules.map((rule) => {
    const validated = validateRule(rule);
    if (ruleKeys.has(validated.ruleKey)) {
      throw new RuleEvaluationError(
        "DUPLICATE_RULE_KEY",
        `${validated.ruleKey}: 중복 ruleKey입니다.`,
      );
    }
    ruleKeys.add(validated.ruleKey);
    return validated;
  });

  rules.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.ruleKey === right.ruleKey) {
      return 0;
    }
    return left.ruleKey < right.ruleKey ? -1 : 1;
  });

  return {
    request: Object.freeze({
      receiptSchemaVersion: request.receiptSchemaVersion,
      evaluatorVersion: request.evaluatorVersion,
      evaluationKey: request.evaluationKey,
      version: Object.freeze({
        strategyVersionId: request.version.strategyVersionId,
        strategyContentHash: request.version.strategyContentHash,
        riskPolicyVersionId: request.version.riskPolicyVersionId,
        riskPolicyContentHash: request.version.riskPolicyContentHash,
      }),
    }),
    snapshot: validateSnapshot(request.snapshot),
    rules: Object.freeze(rules),
  };
}

function missingFeatures(
  snapshot: FeatureSnapshot,
  rule: VersionedRule,
): readonly string[] {
  return rule.requiredFeatures.filter(
    (featureKey) =>
      !Object.prototype.hasOwnProperty.call(snapshot.values, featureKey) ||
      snapshot.values[featureKey] === null,
  );
}

function validateImplementationResult(
  result: unknown,
): result is RuleImplementationResult {
  if (result === null || typeof result !== "object") {
    return false;
  }

  const candidate = result as Partial<RuleImplementationResult>;
  if (
    candidate.status === undefined ||
    !RULE_RESULT_STATUSES.has(candidate.status) ||
    typeof candidate.scoreDelta !== "number" ||
    !Number.isFinite(candidate.scoreDelta) ||
    Math.abs(candidate.scoreDelta) > MAX_ABSOLUTE_SCORE
  ) {
    return false;
  }

  try {
    uniqueSortedStrings(
      candidate.reasonCodes,
      "implementationResult.reasonCodes",
      "INVALID_RULE_CONFIG",
    );
    if (candidate.facts !== undefined) {
      assertJsonValue(
        candidate.facts,
        "INVALID_RULE_CONFIG",
        "implementationResult.facts",
      );
      if (Array.isArray(candidate.facts) || candidate.facts === null) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function createTrace(
  executionOrder: number,
  rule: VersionedRule,
  status: RuleEvaluationTrace["status"],
  contribution: number,
  reasonCodes: readonly string[],
  facts: JsonObject = EMPTY_FACTS,
): RuleEvaluationTrace {
  return Object.freeze({
    executionOrder,
    ruleKey: rule.ruleKey,
    implementationKey: rule.implementationKey,
    category: rule.category,
    priority: rule.priority,
    parameterHash: rule.parameterHash,
    status,
    contribution: normalizedScore(contribution),
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    facts: cloneJson(facts),
  });
}

function blockReason(rule: VersionedRule, reason: string): string {
  return `${reason}:${rule.ruleKey}`;
}

function snapshotImplementations(
  rules: readonly VersionedRule[],
  registry: RuleImplementationRegistry,
): ReadonlyMap<string, RuleImplementation> {
  const implementations = new Map<string, RuleImplementation>();
  for (const rule of rules) {
    if (
      implementations.has(rule.implementationKey) ||
      !Object.prototype.hasOwnProperty.call(registry, rule.implementationKey)
    ) {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      registry,
      rule.implementationKey,
    );
    if (
      descriptor !== undefined &&
      descriptor.get === undefined &&
      descriptor.set === undefined &&
      typeof descriptor.value === "function"
    ) {
      implementations.set(rule.implementationKey, descriptor.value);
    }
  }
  return implementations;
}

export function evaluateRules(
  input: RuleEvaluationRequest,
  registry: RuleImplementationRegistry,
): CanonicalRuleEvaluation {
  if (registry === null || typeof registry !== "object") {
    throw new RuleEvaluationError(
      "INVALID_REQUEST",
      "registry: object여야 합니다.",
    );
  }

  const { request, snapshot, rules } = validateRequest(input);
  const implementations = snapshotImplementations(rules, registry);
  const traces: RuleEvaluationTrace[] = [];
  const blockReasonCodes = new Set<string>();
  let score = 0;

  rules.forEach((rule, index) => {
    const executionOrder = index + 1;

    if (!rule.enabled) {
      if (rule.category === "RISK") {
        blockReasonCodes.add(blockReason(rule, "HARD_RISK_DISABLED"));
      }
      traces.push(
        createTrace(executionOrder, rule, "SKIPPED_DISABLED", 0, [
          rule.category === "RISK" ? "HARD_RISK_DISABLED" : "RULE_DISABLED",
        ]),
      );
      return;
    }

    const missing = missingFeatures(snapshot, rule);
    if (missing.length > 0) {
      const hardRisk = rule.category === "RISK";
      const shouldBlock = hardRisk || rule.missingFeaturePolicy === "BLOCK";
      if (shouldBlock) {
        blockReasonCodes.add(
          blockReason(
            rule,
            hardRisk
              ? "HARD_RISK_MISSING_FEATURE"
              : "RULE_MISSING_FEATURE_BLOCK",
          ),
        );
      }
      traces.push(
        createTrace(executionOrder, rule, "MISSING_FEATURE", 0, [
          shouldBlock ? "MISSING_FEATURE_BLOCK" : "MISSING_FEATURE_ABSTAIN",
          ...missing.map((featureKey) => `MISSING:${featureKey}`),
        ]),
      );
      return;
    }

    if (!implementations.has(rule.implementationKey)) {
      blockReasonCodes.add(blockReason(rule, "RULE_IMPLEMENTATION_MISSING"));
      traces.push(
        createTrace(executionOrder, rule, "MISSING_IMPLEMENTATION", 0, [
          "RULE_IMPLEMENTATION_MISSING",
        ]),
      );
      return;
    }

    const implementation = implementations.get(rule.implementationKey);
    if (implementation === undefined) {
      blockReasonCodes.add(blockReason(rule, "RULE_IMPLEMENTATION_MISSING"));
      traces.push(
        createTrace(executionOrder, rule, "MISSING_IMPLEMENTATION", 0, [
          "RULE_IMPLEMENTATION_MISSING",
        ]),
      );
      return;
    }

    let result: RuleImplementationResult;
    try {
      const rawResult: unknown = implementation({
        snapshot,
        rule,
      });
      if (!validateImplementationResult(rawResult)) {
        blockReasonCodes.add(blockReason(rule, "INVALID_RULE_RESULT"));
        traces.push(
          createTrace(executionOrder, rule, "INVALID_RESULT", 0, [
            "INVALID_RULE_RESULT",
          ]),
        );
        return;
      }
      result = rawResult;
    } catch {
      blockReasonCodes.add(blockReason(rule, "RULE_IMPLEMENTATION_ERROR"));
      traces.push(
        createTrace(executionOrder, rule, "IMPLEMENTATION_ERROR", 0, [
          "RULE_IMPLEMENTATION_ERROR",
        ]),
      );
      return;
    }

    const rawContribution = result.scoreDelta * rule.weight;
    const rawScore = score + rawContribution;
    if (
      !Number.isFinite(rawContribution) ||
      Math.abs(rawContribution) > MAX_ABSOLUTE_SCORE ||
      !Number.isFinite(rawScore) ||
      Math.abs(rawScore) > MAX_ABSOLUTE_SCORE
    ) {
      blockReasonCodes.add(blockReason(rule, "SCORE_RANGE_EXCEEDED"));
      traces.push(
        createTrace(executionOrder, rule, "INVALID_RESULT", 0, [
          "SCORE_RANGE_EXCEEDED",
        ]),
      );
      return;
    }
    const contribution = normalizedScore(rawContribution);
    score = normalizedScore(rawScore);
    const reasonCodes = uniqueSortedStrings(
      result.reasonCodes,
      "implementationResult.reasonCodes",
      "INVALID_RULE_CONFIG",
    );
    const facts = result.facts === undefined ? EMPTY_FACTS : result.facts;

    if (rule.category === "RISK" && result.status !== "PASS") {
      blockReasonCodes.add(
        blockReason(
          rule,
          result.status === "FAIL" ? "HARD_RISK_FAIL" : "HARD_RISK_ABSTAIN",
        ),
      );
    }

    traces.push(
      createTrace(
        executionOrder,
        rule,
        result.status,
        contribution,
        reasonCodes,
        facts,
      ),
    );
  });

  const receipt: RuleEvaluationReceipt = Object.freeze({
    receiptSchemaVersion: request.receiptSchemaVersion,
    evaluatorVersion: request.evaluatorVersion,
    evaluationKey: request.evaluationKey,
    version: request.version,
    snapshot,
    status: blockReasonCodes.size > 0 ? "BLOCKED" : "COMPLETED",
    score,
    blockReasonCodes: Object.freeze([...blockReasonCodes].sort()),
    traces: Object.freeze(traces),
  });

  return Object.freeze({
    receipt,
    canonicalReceipt: canonicalizeJson(receipt),
  });
}
