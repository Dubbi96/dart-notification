-- AOS Phase A4 / Issue #568: immutable version-pinned backtest result ledger.
-- Existing backtest_runs/backtest_trades remain intact and production migration is not run here.

CREATE TYPE "AosBacktestRunType" AS ENUM ('LEGACY_PIT_ADAPTER', 'VERSIONED_EVALUATOR');
CREATE TYPE "AosBacktestAcceptanceStatus" AS ENUM ('NOT_EVALUATED', 'PASSED', 'FAILED');
CREATE TYPE "AosBacktestWindowRole" AS ENUM ('TRAIN', 'VALIDATION', 'TEST');
CREATE TYPE "AosBacktestAttributionDimension" AS ENUM ('RULE', 'REGIME', 'EVENT', 'PERSONA');

CREATE TABLE "aos_backtest_runs" (
  "id" TEXT NOT NULL,
  "replayKey" TEXT NOT NULL,
  "runType" "AosBacktestRunType" NOT NULL,
  "strategyVersionId" TEXT NOT NULL,
  "riskPolicyVersionId" TEXT NOT NULL,
  "datasetVersion" TEXT NOT NULL,
  "datasetHash" TEXT NOT NULL,
  "evaluatorVersion" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "initialCapital" DECIMAL(18,2) NOT NULL,
  "strategyParamsJson" JSONB NOT NULL,
  "costsJson" JSONB NOT NULL,
  "metricsJson" JSONB NOT NULL,
  "sensitivityJson" JSONB NOT NULL,
  "acceptanceStatus" "AosBacktestAcceptanceStatus" NOT NULL DEFAULT 'NOT_EVALUATED',
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_backtest_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_backtest_runs_date_check" CHECK ("startDate" <= "endDate"),
  CONSTRAINT "aos_backtest_runs_capital_check" CHECK ("initialCapital" > 0),
  CONSTRAINT "aos_backtest_runs_dataset_version_check" CHECK ("datasetVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  CONSTRAINT "aos_backtest_runs_evaluator_check" CHECK ("evaluatorVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT "aos_backtest_runs_dataset_hash_check" CHECK ("datasetHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "aos_backtest_runs_receipt_hash_check" CHECK ("receiptHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "aos_backtest_runs_strategy_json_check" CHECK (jsonb_typeof("strategyParamsJson") = 'object'),
  CONSTRAINT "aos_backtest_runs_costs_json_check" CHECK (jsonb_typeof("costsJson") = 'object'),
  CONSTRAINT "aos_backtest_runs_metrics_json_check" CHECK (jsonb_typeof("metricsJson") = 'object'),
  CONSTRAINT "aos_backtest_runs_sensitivity_json_check" CHECK (jsonb_typeof("sensitivityJson") = 'object')
);
CREATE UNIQUE INDEX "aos_backtest_runs_replayKey_key" ON "aos_backtest_runs"("replayKey");
CREATE UNIQUE INDEX "aos_backtest_runs_replay_identity" ON "aos_backtest_runs"("strategyVersionId","riskPolicyVersionId","datasetHash","receiptHash");
CREATE INDEX "aos_backtest_runs_strategyVersionId_createdAt_idx" ON "aos_backtest_runs"("strategyVersionId","createdAt");
CREATE INDEX "aos_backtest_runs_acceptanceStatus_createdAt_idx" ON "aos_backtest_runs"("acceptanceStatus","createdAt");
CREATE INDEX "aos_backtest_runs_datasetVersion_idx" ON "aos_backtest_runs"("datasetVersion");

CREATE TABLE "aos_backtest_windows" (
  "id" TEXT NOT NULL,
  "backtestRunId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" "AosBacktestWindowRole" NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "metricsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_backtest_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_backtest_windows_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "aos_backtest_windows_date_check" CHECK ("startDate" <= "endDate"),
  CONSTRAINT "aos_backtest_windows_metrics_check" CHECK (jsonb_typeof("metricsJson") = 'object')
);
CREATE UNIQUE INDEX "aos_backtest_windows_backtestRunId_sequence_key" ON "aos_backtest_windows"("backtestRunId","sequence");
CREATE INDEX "aos_backtest_windows_backtestRunId_role_idx" ON "aos_backtest_windows"("backtestRunId","role");

CREATE TABLE "aos_backtest_trades" (
  "id" TEXT NOT NULL,
  "backtestRunId" TEXT NOT NULL,
  "signalDecisionId" TEXT,
  "sequence" INTEGER NOT NULL,
  "corpCode" TEXT NOT NULL,
  "stockCode" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "persona" TEXT NOT NULL,
  "regimeKey" TEXT,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "entryPrice" DECIMAL(14,4) NOT NULL,
  "entryShares" INTEGER NOT NULL,
  "exitDate" TIMESTAMP(3),
  "exitPrice" DECIMAL(14,4),
  "exitReason" TEXT,
  "grossPnl" DECIMAL(18,2),
  "netPnl" DECIMAL(18,2),
  "returnPct" DECIMAL(12,6),
  "maePct" DECIMAL(12,6),
  "mfePct" DECIMAL(12,6),
  "holdDays" INTEGER,
  "commission" DECIMAL(18,2) NOT NULL,
  "tax" DECIMAL(18,2) NOT NULL,
  "slippage" DECIMAL(18,2) NOT NULL,
  "ruleKeys" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_backtest_trades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_backtest_trades_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "aos_backtest_trades_codes_check" CHECK ("corpCode" ~ '^[0-9]{8}$' AND "stockCode" ~ '^[0-9]{6}$'),
  CONSTRAINT "aos_backtest_trades_entry_check" CHECK ("entryPrice" > 0 AND "entryShares" > 0),
  CONSTRAINT "aos_backtest_trades_exit_shape_check" CHECK (("exitDate" IS NULL AND "exitPrice" IS NULL) OR ("exitDate" IS NOT NULL AND "exitPrice" IS NOT NULL AND "exitDate" >= "entryDate")),
  CONSTRAINT "aos_backtest_trades_excursion_check" CHECK (("maePct" IS NULL OR "maePct" <= 0) AND ("mfePct" IS NULL OR "mfePct" >= 0)),
  CONSTRAINT "aos_backtest_trades_cost_check" CHECK ("commission" >= 0 AND "tax" >= 0 AND "slippage" >= 0)
);
CREATE UNIQUE INDEX "aos_backtest_trades_backtestRunId_sequence_key" ON "aos_backtest_trades"("backtestRunId","sequence");
CREATE INDEX "aos_backtest_trades_stockCode_entryDate_idx" ON "aos_backtest_trades"("stockCode","entryDate");
CREATE INDEX "aos_backtest_trades_signalDecisionId_idx" ON "aos_backtest_trades"("signalDecisionId");
CREATE INDEX "aos_backtest_trades_regimeKey_idx" ON "aos_backtest_trades"("regimeKey");

CREATE TABLE "aos_backtest_attributions" (
  "id" TEXT NOT NULL,
  "backtestRunId" TEXT NOT NULL,
  "dimension" "AosBacktestAttributionDimension" NOT NULL,
  "key" TEXT NOT NULL,
  "metricsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_backtest_attributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_backtest_attributions_key_check" CHECK (length("key") BETWEEN 1 AND 128),
  CONSTRAINT "aos_backtest_attributions_metrics_check" CHECK (jsonb_typeof("metricsJson") = 'object')
);
CREATE UNIQUE INDEX "aos_backtest_attributions_backtestRunId_dimension_key_key" ON "aos_backtest_attributions"("backtestRunId","dimension","key");
CREATE INDEX "aos_backtest_attributions_dimension_key_idx" ON "aos_backtest_attributions"("dimension","key");

CREATE TABLE "aos_backtest_acceptance_criteria" (
  "id" TEXT NOT NULL,
  "backtestRunId" TEXT NOT NULL,
  "criterionKey" TEXT NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "actualJson" JSONB NOT NULL,
  "thresholdJson" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_backtest_acceptance_criteria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_backtest_acceptance_key_check" CHECK ("criterionKey" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT "aos_backtest_acceptance_actual_check" CHECK (jsonb_typeof("actualJson") = 'object'),
  CONSTRAINT "aos_backtest_acceptance_threshold_check" CHECK (jsonb_typeof("thresholdJson") = 'object'),
  CONSTRAINT "aos_backtest_acceptance_hash_check" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_backtest_acceptance_criteria_backtestRunId_criterionKey_key" ON "aos_backtest_acceptance_criteria"("backtestRunId","criterionKey");
CREATE INDEX "aos_backtest_acceptance_criteria_criterionKey_passed_idx" ON "aos_backtest_acceptance_criteria"("criterionKey","passed");
CREATE INDEX "aos_backtest_acceptance_criteria_evidenceHash_idx" ON "aos_backtest_acceptance_criteria"("evidenceHash");

ALTER TABLE "aos_backtest_runs" ADD CONSTRAINT "aos_backtest_runs_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "aos_strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_backtest_runs" ADD CONSTRAINT "aos_backtest_runs_riskPolicyVersionId_fkey" FOREIGN KEY ("riskPolicyVersionId") REFERENCES "aos_risk_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_backtest_windows" ADD CONSTRAINT "aos_backtest_windows_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "aos_backtest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_backtest_trades" ADD CONSTRAINT "aos_backtest_trades_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "aos_backtest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_backtest_trades" ADD CONSTRAINT "aos_backtest_trades_signalDecisionId_fkey" FOREIGN KEY ("signalDecisionId") REFERENCES "aos_signal_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_backtest_attributions" ADD CONSTRAINT "aos_backtest_attributions_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "aos_backtest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_backtest_acceptance_criteria" ADD CONSTRAINT "aos_backtest_acceptance_criteria_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "aos_backtest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "aos_reject_backtest_ledger_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AOS_BACKTEST_LEDGER_APPEND_ONLY: % on % is forbidden', TG_OP, TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_backtest_runs_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_backtest_runs" FOR EACH ROW EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_runs_truncate_guard" BEFORE TRUNCATE ON "aos_backtest_runs" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_windows_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_backtest_windows" FOR EACH ROW EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_windows_truncate_guard" BEFORE TRUNCATE ON "aos_backtest_windows" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_trades_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_backtest_trades" FOR EACH ROW EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_trades_truncate_guard" BEFORE TRUNCATE ON "aos_backtest_trades" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_attributions_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_backtest_attributions" FOR EACH ROW EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_attributions_truncate_guard" BEFORE TRUNCATE ON "aos_backtest_attributions" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_acceptance_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_backtest_acceptance_criteria" FOR EACH ROW EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
CREATE TRIGGER "aos_backtest_acceptance_truncate_guard" BEFORE TRUNCATE ON "aos_backtest_acceptance_criteria" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_backtest_ledger_mutation"();
