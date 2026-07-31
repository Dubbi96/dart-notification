-- AOS Phase A3-3 / Issue #566: deterministic decision ledger and market regime snapshots.
-- Additive only. Legacy TradingSignal remains canonical and no production migration is run here.

CREATE TYPE "SignalDecisionMode" AS ENUM ('LEGACY_PARITY', 'BACKTEST', 'SHADOW', 'LIVE');
CREATE TYPE "SignalDecisionStatus" AS ENUM ('COMPLETED', 'BLOCKED');
CREATE TYPE "SignalDecisionParityStatus" AS ENUM ('MATCH', 'MISMATCH', 'NOT_COMPARED');

CREATE TABLE "aos_market_regime_snapshots" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'KR',
    "asOf" TIMESTAMP(3) NOT NULL,
    "marketSessionDate" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "regimeKey" TEXT NOT NULL,
    "confidence" DECIMAL(8,6),
    "factsJson" JSONB NOT NULL,
    "sourceRefsJson" JSONB NOT NULL,
    "qualityJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aos_market_regime_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_market_regime_market_check" CHECK ("market" = 'KR'),
    CONSTRAINT "aos_market_regime_session_date_check" CHECK (
        "marketSessionDate" ~ '^[0-9]{8}$'
        AND to_char(to_date("marketSessionDate", 'YYYYMMDD'), 'YYYYMMDD') = "marketSessionDate"
    ),
    CONSTRAINT "aos_market_regime_schema_check" CHECK ("schemaVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    CONSTRAINT "aos_market_regime_key_check" CHECK ("regimeKey" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT "aos_market_regime_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
    CONSTRAINT "aos_market_regime_facts_object_check" CHECK (jsonb_typeof("factsJson") = 'object'),
    CONSTRAINT "aos_market_regime_sources_object_check" CHECK (jsonb_typeof("sourceRefsJson") = 'object'),
    CONSTRAINT "aos_market_regime_quality_object_check" CHECK (jsonb_typeof("qualityJson") = 'object'),
    CONSTRAINT "aos_market_regime_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "aos_market_regime_snapshots_idempotency_key"
    ON "aos_market_regime_snapshots"("market", "asOf", "schemaVersion", "contentHash");
CREATE INDEX "aos_market_regime_snapshots_marketSessionDate_idx"
    ON "aos_market_regime_snapshots"("marketSessionDate");
CREATE INDEX "aos_market_regime_snapshots_regimeKey_asOf_idx"
    ON "aos_market_regime_snapshots"("regimeKey", "asOf");
CREATE INDEX "aos_market_regime_snapshots_contentHash_idx"
    ON "aos_market_regime_snapshots"("contentHash");

CREATE TABLE "aos_signal_decisions" (
    "id" TEXT NOT NULL,
    "decisionKey" TEXT NOT NULL,
    "mode" "SignalDecisionMode" NOT NULL,
    "featureSnapshotId" TEXT NOT NULL,
    "marketRegimeSnapshotId" TEXT,
    "strategyVersionId" TEXT NOT NULL,
    "riskPolicyVersionId" TEXT NOT NULL,
    "legacyTradingSignalId" TEXT,
    "evaluatorVersion" TEXT NOT NULL,
    "receiptSchemaVersion" TEXT NOT NULL,
    "status" "SignalDecisionStatus" NOT NULL,
    "score" DECIMAL(12,6) NOT NULL,
    "blockReasonCodes" TEXT[],
    "decisionJson" JSONB NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "legacyScore" INTEGER,
    "scoreDelta" DECIMAL(12,6),
    "parityStatus" "SignalDecisionParityStatus" NOT NULL DEFAULT 'NOT_COMPARED',
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aos_signal_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_signal_decisions_key_check" CHECK (length("decisionKey") BETWEEN 8 AND 256),
    CONSTRAINT "aos_signal_decisions_evaluator_check" CHECK ("evaluatorVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    CONSTRAINT "aos_signal_decisions_receipt_schema_check" CHECK ("receiptSchemaVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    CONSTRAINT "aos_signal_decisions_score_check" CHECK ("score" BETWEEN -1000000 AND 1000000),
    CONSTRAINT "aos_signal_decisions_legacy_score_check" CHECK ("legacyScore" IS NULL OR "legacyScore" BETWEEN -100 AND 100),
    CONSTRAINT "aos_signal_decisions_delta_check" CHECK ("scoreDelta" IS NULL OR "scoreDelta" BETWEEN -1000100 AND 1000100),
    CONSTRAINT "aos_signal_decisions_json_object_check" CHECK (jsonb_typeof("decisionJson") = 'object'),
    CONSTRAINT "aos_signal_decisions_receipt_hash_check" CHECK ("receiptHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_signal_decisions_parity_shape_check" CHECK (
        ("parityStatus" = 'NOT_COMPARED' AND "legacyScore" IS NULL AND "scoreDelta" IS NULL)
        OR ("parityStatus" IN ('MATCH', 'MISMATCH') AND "legacyScore" IS NOT NULL AND "scoreDelta" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "aos_signal_decisions_decisionKey_key" ON "aos_signal_decisions"("decisionKey");
CREATE UNIQUE INDEX "aos_signal_decisions_replay_key"
    ON "aos_signal_decisions"("featureSnapshotId", "strategyVersionId", "riskPolicyVersionId", "evaluatorVersion", "receiptHash");
CREATE INDEX "aos_signal_decisions_mode_evaluatedAt_idx" ON "aos_signal_decisions"("mode", "evaluatedAt");
CREATE INDEX "aos_signal_decisions_status_evaluatedAt_idx" ON "aos_signal_decisions"("status", "evaluatedAt");
CREATE INDEX "aos_signal_decisions_parityStatus_evaluatedAt_idx" ON "aos_signal_decisions"("parityStatus", "evaluatedAt");
CREATE INDEX "aos_signal_decisions_legacyTradingSignalId_idx" ON "aos_signal_decisions"("legacyTradingSignalId");
CREATE INDEX "aos_signal_decisions_receiptHash_idx" ON "aos_signal_decisions"("receiptHash");

CREATE TABLE "aos_rule_evaluation_traces" (
    "id" TEXT NOT NULL,
    "signalDecisionId" TEXT NOT NULL,
    "executionOrder" INTEGER NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "implementationKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "parameterHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contribution" DECIMAL(12,6) NOT NULL,
    "reasonCodes" TEXT[],
    "factsJson" JSONB NOT NULL,
    "traceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aos_rule_evaluation_traces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_rule_trace_order_check" CHECK ("executionOrder" > 0),
    CONSTRAINT "aos_rule_trace_category_check" CHECK ("category" IN ('ENTRY', 'EXIT', 'SIZING', 'REGIME', 'PORTFOLIO', 'RISK')),
    CONSTRAINT "aos_rule_trace_status_check" CHECK ("status" IN ('PASS', 'FAIL', 'ABSTAIN', 'SKIPPED_DISABLED', 'MISSING_FEATURE', 'MISSING_IMPLEMENTATION', 'IMPLEMENTATION_ERROR', 'INVALID_RESULT')),
    CONSTRAINT "aos_rule_trace_contribution_check" CHECK ("contribution" BETWEEN -1000000 AND 1000000),
    CONSTRAINT "aos_rule_trace_parameter_hash_check" CHECK ("parameterHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_rule_trace_facts_object_check" CHECK (jsonb_typeof("factsJson") = 'object'),
    CONSTRAINT "aos_rule_trace_hash_check" CHECK ("traceHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "aos_rule_evaluation_traces_signalDecisionId_executionOrder_key"
    ON "aos_rule_evaluation_traces"("signalDecisionId", "executionOrder");
CREATE UNIQUE INDEX "aos_rule_evaluation_traces_signalDecisionId_ruleKey_key"
    ON "aos_rule_evaluation_traces"("signalDecisionId", "ruleKey");
CREATE INDEX "aos_rule_evaluation_traces_ruleKey_status_idx"
    ON "aos_rule_evaluation_traces"("ruleKey", "status");
CREATE INDEX "aos_rule_evaluation_traces_traceHash_idx"
    ON "aos_rule_evaluation_traces"("traceHash");

ALTER TABLE "aos_signal_decisions" ADD CONSTRAINT "aos_signal_decisions_featureSnapshotId_fkey"
    FOREIGN KEY ("featureSnapshotId") REFERENCES "aos_feature_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_signal_decisions" ADD CONSTRAINT "aos_signal_decisions_marketRegimeSnapshotId_fkey"
    FOREIGN KEY ("marketRegimeSnapshotId") REFERENCES "aos_market_regime_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_signal_decisions" ADD CONSTRAINT "aos_signal_decisions_strategyVersionId_fkey"
    FOREIGN KEY ("strategyVersionId") REFERENCES "aos_strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_signal_decisions" ADD CONSTRAINT "aos_signal_decisions_riskPolicyVersionId_fkey"
    FOREIGN KEY ("riskPolicyVersionId") REFERENCES "aos_risk_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_signal_decisions" ADD CONSTRAINT "aos_signal_decisions_legacyTradingSignalId_fkey"
    FOREIGN KEY ("legacyTradingSignalId") REFERENCES "trading_signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "aos_rule_evaluation_traces" ADD CONSTRAINT "aos_rule_evaluation_traces_signalDecisionId_fkey"
    FOREIGN KEY ("signalDecisionId") REFERENCES "aos_signal_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 비교 전용 Legacy baseline. BACKTESTED에서 멈추며 승인·활성·주문 권한은 없다.
INSERT INTO "aos_strategies" (
    "id", "key", "name", "description", "assetClass", "direction",
    "horizonMinDays", "horizonMaxDays", "status", "createdAt", "updatedAt"
) VALUES (
    'aos_legacy_dart_swing', 'legacy-dart-swing', 'Legacy DART Swing Baseline',
    'AOS 전환 parity 측정 전용. 주문·활성 권한 없음.', 'KR_STOCK', 'LONG_ONLY',
    2, 20, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO NOTHING;

INSERT INTO "aos_rule_definitions" (
    "id", "key", "category", "name", "description", "implementationKey",
    "inputSchemaVersion", "outputSchemaVersion", "isActive", "createdAt", "updatedAt"
) VALUES
    ('aos_legacy_risk_rule', 'legacy.risk-penalty', 'RISK', 'Legacy Hard Risk Adapter',
     '기존 riskPenalty 차단 결과를 공유 evaluator trace로 재현', 'legacy.risk-penalty.v1',
     1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aos_legacy_entry_rule', 'legacy.buy-score', 'ENTRY', 'Legacy Buy Score Adapter',
     '기존 BuySignalService 결과를 공유 evaluator score로 재현', 'legacy.buy-score.v1',
     1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "aos_strategy_versions" (
    "id", "strategyId", "version", "status", "configJson", "configHash",
    "validatedAt", "createdAt", "updatedAt"
) SELECT
    'aos_legacy_dart_swing_v1', s."id", 1, 'DRAFT',
    '{"adapter":"LEGACY_TRADING_SIGNAL_V1","horizonDays":[2,20],"scope":"KR_STOCK_LONG_ONLY","version":1}'::jsonb,
    'c504b331423ea910cd3fe1a6fd6fe362106f0340e7094e15871064b11ac47608',
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "aos_strategies" s
WHERE s."key" = 'legacy-dart-swing'
ON CONFLICT ("strategyId", "version") DO NOTHING;

INSERT INTO "aos_risk_policy_versions" (
    "id", "version", "status", "limitsJson", "configHash", "validatedAt", "createdAt", "updatedAt"
) VALUES (
    'aos_legacy_risk_policy_v1', 1, 'DRAFT',
    '{"adapter":"LEGACY_RISK_PENALTY_V1","constraints":{"allowLeverage":false,"allowShort":false,"assetClass":"KR_STOCK","autoCoverFromLongTermAssets":false,"direction":"LONG_ONLY"},"mode":"PARITY_ONLY","version":1}'::jsonb,
    '2e5ec19d466684943a971670bb695a66db7c5840bec9227139a104cebc05cb3e',
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("version") DO NOTHING;

INSERT INTO "aos_strategy_version_rules" (
    "id", "strategyVersionId", "ruleDefinitionId", "priority", "enabled", "weight",
    "parametersJson", "parameterHash", "createdAt", "updatedAt"
) SELECT
    'aos_legacy_risk_rule_v1', sv."id", rd."id", 1, true, 0,
    '{"missingFeaturePolicy":"BLOCK","requiredFeatures":["riskPenalty"]}'::jsonb,
    'dbaf6e63c79d275404b4f59118fb92ff341dcdc08d45c78ed7c5c37c5e885174',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "aos_strategy_versions" sv
JOIN "aos_strategies" s ON s."id" = sv."strategyId"
JOIN "aos_rule_definitions" rd ON rd."key" = 'legacy.risk-penalty'
WHERE s."key" = 'legacy-dart-swing' AND sv."version" = 1
ON CONFLICT ("strategyVersionId", "ruleDefinitionId") DO NOTHING;

INSERT INTO "aos_strategy_version_rules" (
    "id", "strategyVersionId", "ruleDefinitionId", "priority", "enabled", "weight",
    "parametersJson", "parameterHash", "createdAt", "updatedAt"
) SELECT
    'aos_legacy_entry_rule_v1', sv."id", rd."id", 2, true, 1,
    '{"missingFeaturePolicy":"BLOCK","requiredFeatures":["rcpNo","corpCode","stockCode"]}'::jsonb,
    'fb70b2125f1f75c63396099bbfa3f13c8996bb435c30ad4f009b20a55bde1a27',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "aos_strategy_versions" sv
JOIN "aos_strategies" s ON s."id" = sv."strategyId"
JOIN "aos_rule_definitions" rd ON rd."key" = 'legacy.buy-score'
WHERE s."key" = 'legacy-dart-swing' AND sv."version" = 1
ON CONFLICT ("strategyVersionId", "ruleDefinitionId") DO NOTHING;

-- Bootstrap도 정상 상태 전이만 사용한다. 최종 BACKTESTED는 비교 가능하지만 활성·주문 불가다.
UPDATE "aos_strategy_versions"
SET "status" = 'VALIDATED', "validatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'aos_legacy_dart_swing_v1' AND "status" = 'DRAFT';
UPDATE "aos_strategy_versions"
SET "status" = 'BACKTESTED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'aos_legacy_dart_swing_v1' AND "status" = 'VALIDATED';

UPDATE "aos_risk_policy_versions"
SET "status" = 'VALIDATED', "validatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'aos_legacy_risk_policy_v1' AND "status" = 'DRAFT';
UPDATE "aos_risk_policy_versions"
SET "status" = 'BACKTESTED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'aos_legacy_risk_policy_v1' AND "status" = 'VALIDATED';

CREATE OR REPLACE FUNCTION "aos_reject_decision_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AOS_DECISION_LEDGER_APPEND_ONLY: % on % is forbidden', TG_OP, TG_TABLE_NAME
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_market_regime_snapshots_append_only_guard"
BEFORE UPDATE OR DELETE ON "aos_market_regime_snapshots"
FOR EACH ROW EXECUTE FUNCTION "aos_reject_decision_ledger_mutation"();
CREATE TRIGGER "aos_market_regime_snapshots_truncate_guard"
BEFORE TRUNCATE ON "aos_market_regime_snapshots"
FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_decision_ledger_mutation"();

CREATE TRIGGER "aos_signal_decisions_append_only_guard"
BEFORE UPDATE OR DELETE ON "aos_signal_decisions"
FOR EACH ROW EXECUTE FUNCTION "aos_reject_decision_ledger_mutation"();
CREATE TRIGGER "aos_signal_decisions_truncate_guard"
BEFORE TRUNCATE ON "aos_signal_decisions"
FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_decision_ledger_mutation"();

CREATE TRIGGER "aos_rule_evaluation_traces_append_only_guard"
BEFORE UPDATE OR DELETE ON "aos_rule_evaluation_traces"
FOR EACH ROW EXECUTE FUNCTION "aos_reject_decision_ledger_mutation"();
CREATE TRIGGER "aos_rule_evaluation_traces_truncate_guard"
BEFORE TRUNCATE ON "aos_rule_evaluation_traces"
FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_decision_ledger_mutation"();
