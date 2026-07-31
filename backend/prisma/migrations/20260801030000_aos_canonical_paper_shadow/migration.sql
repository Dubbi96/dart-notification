-- AOS Phase A5 / Issue #570: canonical SHADOW/PAPER ledger only.
-- LIVE execution is intentionally absent. Existing PaperTrade/OrderRequest data is preserved.

CREATE TYPE "AosTradingAccountType" AS ENUM ('LONG_TERM', 'SYSTEM_TRADING');
CREATE TYPE "AosTradingAccountStatus" AS ENUM ('ACTIVE', 'LOCKED', 'CLOSED');
CREATE TYPE "AosCapitalBucketType" AS ENUM ('SPGI', 'VTI', 'SYSTEM_TRADING', 'RESERVE');
CREATE TYPE "AosExecutionMode" AS ENUM ('SHADOW', 'PAPER');
CREATE TYPE "AosRiskAction" AS ENUM ('ALLOW', 'REDUCE', 'BLOCK');
CREATE TYPE "AosOrderPlanStatus" AS ENUM ('PLANNED', 'APPROVED', 'QUEUED', 'EXPIRED', 'CANCELLED', 'EXECUTED');
CREATE TYPE "AosOrderStatus" AS ENUM ('NEW', 'SUBMITTED', 'PARTIAL', 'FILLED', 'CANCELLED', 'REJECTED');
CREATE TYPE "AosOrderSide" AS ENUM ('BUY', 'SELL');
CREATE TYPE "AosOrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT');
CREATE TYPE "AosReconciliationStatus" AS ENUM ('MATCHED', 'BROKEN');
CREATE TYPE "AosReconciliationBreakSeverity" AS ENUM ('WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "AosReconciliationBreakResolution" AS ENUM ('OPEN', 'EXPLAINED', 'RESOLVED');
CREATE TYPE "AosHumanInterventionType" AS ENUM ('APPROVE', 'REJECT', 'PAUSE', 'RESUME', 'BLACKLIST', 'EMERGENCY_EXIT', 'OVERRIDE_REQUEST');
CREATE TYPE "AosKillSwitchScope" AS ENUM ('NEW_ENTRY', 'ACCOUNT', 'STRATEGY', 'ALL_ORDERS');
CREATE TYPE "AosKillSwitchMode" AS ENUM ('REDUCE_ONLY', 'FULL_HALT');
CREATE TYPE "AosKillSwitchCommand" AS ENUM ('ACTIVATE', 'DEACTIVATE_REQUEST', 'ACKNOWLEDGE');

CREATE TABLE "aos_trading_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountType" "AosTradingAccountType" NOT NULL,
  "label" TEXT NOT NULL,
  "brokerRefHash" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'KRW',
  "status" "AosTradingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aos_trading_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_trading_accounts_label_check" CHECK (length("label") BETWEEN 1 AND 80),
  CONSTRAINT "aos_trading_accounts_currency_check" CHECK ("currency" IN ('KRW','USD')),
  CONSTRAINT "aos_trading_accounts_broker_hash_check" CHECK ("brokerRefHash" IS NULL OR "brokerRefHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "aos_trading_accounts_userId_status_idx" ON "aos_trading_accounts"("userId", "status");
CREATE UNIQUE INDEX "aos_trading_accounts_userId_accountType_label_key" ON "aos_trading_accounts"("userId", "accountType", "label");

CREATE TABLE "aos_capital_buckets" (
  "id" TEXT NOT NULL,
  "tradingAccountId" TEXT NOT NULL,
  "bucketType" "AosCapitalBucketType" NOT NULL,
  "targetWeight" DECIMAL(5,4) NOT NULL,
  "availableAmount" DECIMAL(18,2),
  "autoReplenishAllowed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aos_capital_buckets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_capital_buckets_weight_check" CHECK ("targetWeight" >= 0 AND "targetWeight" <= 1),
  CONSTRAINT "aos_capital_buckets_amount_check" CHECK ("availableAmount" IS NULL OR "availableAmount" >= 0),
  CONSTRAINT "aos_capital_buckets_no_auto_cover_check" CHECK ("bucketType" <> 'SYSTEM_TRADING' OR "autoReplenishAllowed" = false)
);
CREATE INDEX "aos_capital_buckets_bucketType_idx" ON "aos_capital_buckets"("bucketType");
CREATE UNIQUE INDEX "aos_capital_buckets_tradingAccountId_bucketType_key" ON "aos_capital_buckets"("tradingAccountId", "bucketType");

CREATE TABLE "aos_portfolio_proposals" (
  "id" TEXT NOT NULL,
  "proposalKey" TEXT NOT NULL,
  "signalDecisionId" TEXT NOT NULL,
  "strategyVersionId" TEXT NOT NULL,
  "tradingAccountId" TEXT NOT NULL,
  "mode" "AosExecutionMode" NOT NULL,
  "proposalJson" JSONB NOT NULL,
  "totalExposureBefore" DECIMAL(18,2) NOT NULL,
  "totalExposureAfter" DECIMAL(18,2) NOT NULL,
  "resultHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_portfolio_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_portfolio_proposals_exposure_check" CHECK ("totalExposureBefore" >= 0 AND "totalExposureAfter" >= 0),
  CONSTRAINT "aos_portfolio_proposals_json_check" CHECK (jsonb_typeof("proposalJson") = 'object'),
  CONSTRAINT "aos_portfolio_proposals_hash_check" CHECK ("resultHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_portfolio_proposals_proposalKey_key" ON "aos_portfolio_proposals"("proposalKey");
CREATE INDEX "aos_portfolio_proposals_tradingAccountId_createdAt_idx" ON "aos_portfolio_proposals"("tradingAccountId", "createdAt");
CREATE INDEX "aos_portfolio_proposals_signalDecisionId_idx" ON "aos_portfolio_proposals"("signalDecisionId");
CREATE INDEX "aos_portfolio_proposals_resultHash_idx" ON "aos_portfolio_proposals"("resultHash");

CREATE TABLE "aos_kill_switch_events" (
  "id" TEXT NOT NULL,
  "scope" "AosKillSwitchScope" NOT NULL,
  "scopeRefId" TEXT,
  "mode" "AosKillSwitchMode" NOT NULL,
  "command" "AosKillSwitchCommand" NOT NULL,
  "actorUserId" TEXT,
  "actorKind" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reasonText" TEXT NOT NULL,
  "stepUpAuthMethod" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3),
  "recoveryPolicyJson" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_kill_switch_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_kill_switch_actor_check" CHECK (("actorKind" = 'USER' AND "actorUserId" IS NOT NULL) OR ("actorKind" = 'SYSTEM' AND "actorUserId" IS NULL)),
  CONSTRAINT "aos_kill_switch_scope_check" CHECK (("scope" IN ('ACCOUNT','STRATEGY') AND "scopeRefId" IS NOT NULL) OR ("scope" IN ('NEW_ENTRY','ALL_ORDERS') AND "scopeRefId" IS NULL)),
  CONSTRAINT "aos_kill_switch_time_check" CHECK (("acknowledgedAt" IS NULL OR "acknowledgedAt" >= "requestedAt") AND ("effectiveAt" IS NULL OR "effectiveAt" >= "requestedAt")),
  CONSTRAINT "aos_kill_switch_recovery_check" CHECK (jsonb_typeof("recoveryPolicyJson") = 'object'),
  CONSTRAINT "aos_kill_switch_hash_check" CHECK ("receiptHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_kill_switch_events_correlationId_key" ON "aos_kill_switch_events"("correlationId");
CREATE INDEX "aos_kill_switch_events_scope_mode_effectiveAt_idx" ON "aos_kill_switch_events"("scope", "mode", "effectiveAt");
CREATE INDEX "aos_kill_switch_events_command_requestedAt_idx" ON "aos_kill_switch_events"("command", "requestedAt");
CREATE INDEX "aos_kill_switch_events_receiptHash_idx" ON "aos_kill_switch_events"("receiptHash");

CREATE TABLE "aos_risk_decisions" (
  "id" TEXT NOT NULL,
  "decisionKey" TEXT NOT NULL,
  "portfolioProposalId" TEXT NOT NULL,
  "signalDecisionId" TEXT,
  "riskPolicyVersionId" TEXT NOT NULL,
  "killSwitchEventId" TEXT,
  "action" "AosRiskAction" NOT NULL,
  "violationsJson" JSONB NOT NULL,
  "capitalSnapshotJson" JSONB NOT NULL,
  "resultHash" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_risk_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_risk_decisions_json_check" CHECK (jsonb_typeof("violationsJson") = 'array' AND jsonb_typeof("capitalSnapshotJson") = 'object'),
  CONSTRAINT "aos_risk_decisions_hash_check" CHECK ("resultHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_risk_decisions_decisionKey_key" ON "aos_risk_decisions"("decisionKey");
CREATE INDEX "aos_risk_decisions_action_decidedAt_idx" ON "aos_risk_decisions"("action", "decidedAt");
CREATE INDEX "aos_risk_decisions_riskPolicyVersionId_idx" ON "aos_risk_decisions"("riskPolicyVersionId");
CREATE INDEX "aos_risk_decisions_signalDecisionId_idx" ON "aos_risk_decisions"("signalDecisionId");

CREATE TABLE "aos_order_plans" (
  "id" TEXT NOT NULL,
  "portfolioProposalId" TEXT NOT NULL,
  "signalDecisionId" TEXT NOT NULL,
  "riskDecisionId" TEXT NOT NULL,
  "strategyVersionId" TEXT NOT NULL,
  "tradingAccountId" TEXT NOT NULL,
  "mode" "AosExecutionMode" NOT NULL,
  "side" "AosOrderSide" NOT NULL,
  "orderType" "AosOrderType" NOT NULL,
  "plannedQuantity" INTEGER NOT NULL,
  "plannedPrice" DECIMAL(14,4),
  "stopPrice" DECIMAL(14,4),
  "takeProfitPrice" DECIMAL(14,4),
  "maxHoldDays" INTEGER,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "AosOrderPlanStatus" NOT NULL DEFAULT 'PLANNED',
  "idempotencyKey" TEXT NOT NULL,
  "planHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aos_order_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_order_plans_quantity_check" CHECK ("plannedQuantity" > 0),
  CONSTRAINT "aos_order_plans_price_check" CHECK (("orderType" = 'MARKET' OR "plannedPrice" > 0) AND ("stopPrice" IS NULL OR "stopPrice" > 0) AND ("takeProfitPrice" IS NULL OR "takeProfitPrice" > 0)),
  CONSTRAINT "aos_order_plans_horizon_check" CHECK ("maxHoldDays" IS NULL OR "maxHoldDays" BETWEEN 2 AND 20),
  CONSTRAINT "aos_order_plans_time_check" CHECK ("validFrom" < "expiresAt"),
  CONSTRAINT "aos_order_plans_hash_check" CHECK ("planHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_order_plans_idempotencyKey_key" ON "aos_order_plans"("idempotencyKey");
CREATE INDEX "aos_order_plans_tradingAccountId_status_validFrom_idx" ON "aos_order_plans"("tradingAccountId", "status", "validFrom");
CREATE INDEX "aos_order_plans_strategyVersionId_status_idx" ON "aos_order_plans"("strategyVersionId", "status");
CREATE INDEX "aos_order_plans_expiresAt_status_idx" ON "aos_order_plans"("expiresAt", "status");
CREATE INDEX "aos_order_plans_planHash_idx" ON "aos_order_plans"("planHash");

CREATE TABLE "aos_orders" (
  "id" TEXT NOT NULL,
  "orderPlanId" TEXT NOT NULL,
  "legacyPaperTradeId" TEXT,
  "status" "AosOrderStatus" NOT NULL DEFAULT 'NEW',
  "requestedQuantity" INTEGER NOT NULL,
  "brokerOrderId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aos_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_orders_quantity_check" CHECK ("requestedQuantity" > 0),
  CONSTRAINT "aos_orders_cancelled_check" CHECK (("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL) OR "status" <> 'CANCELLED')
);
CREATE UNIQUE INDEX "aos_orders_orderPlanId_key" ON "aos_orders"("orderPlanId");
CREATE UNIQUE INDEX "aos_orders_legacyPaperTradeId_key" ON "aos_orders"("legacyPaperTradeId");
CREATE UNIQUE INDEX "aos_orders_brokerOrderId_key" ON "aos_orders"("brokerOrderId");
CREATE INDEX "aos_orders_status_createdAt_idx" ON "aos_orders"("status", "createdAt");

CREATE TABLE "aos_order_fills" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "brokerFillId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "price" DECIMAL(14,4) NOT NULL,
  "commission" DECIMAL(18,2) NOT NULL,
  "tax" DECIMAL(18,2) NOT NULL,
  "slippage" DECIMAL(18,2) NOT NULL,
  "filledAt" TIMESTAMP(3) NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_order_fills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_order_fills_values_check" CHECK ("quantity" > 0 AND "price" > 0 AND "commission" >= 0 AND "tax" >= 0 AND "slippage" >= 0),
  CONSTRAINT "aos_order_fills_hash_check" CHECK ("receiptHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_order_fills_brokerFillId_key" ON "aos_order_fills"("brokerFillId");
CREATE INDEX "aos_order_fills_orderId_filledAt_idx" ON "aos_order_fills"("orderId", "filledAt");
CREATE INDEX "aos_order_fills_receiptHash_idx" ON "aos_order_fills"("receiptHash");

CREATE TABLE "aos_reconciliation_runs" (
  "id" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "tradingAccountId" TEXT NOT NULL,
  "tradeDate" TEXT NOT NULL,
  "status" "AosReconciliationStatus" NOT NULL,
  "expectedJson" JSONB NOT NULL,
  "actualJson" JSONB NOT NULL,
  "unexplainedBreaks" INTEGER NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_reconciliation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_reconciliation_runs_date_check" CHECK ("tradeDate" ~ '^[0-9]{8}$'),
  CONSTRAINT "aos_reconciliation_runs_count_check" CHECK ("unexplainedBreaks" >= 0 AND (("status" = 'MATCHED' AND "unexplainedBreaks" = 0) OR "status" = 'BROKEN')),
  CONSTRAINT "aos_reconciliation_runs_json_check" CHECK (jsonb_typeof("expectedJson") = 'object' AND jsonb_typeof("actualJson") = 'object'),
  CONSTRAINT "aos_reconciliation_runs_hash_check" CHECK ("receiptHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_reconciliation_runs_runKey_key" ON "aos_reconciliation_runs"("runKey");
CREATE UNIQUE INDEX "aos_reconciliation_runs_tradingAccountId_tradeDate_key" ON "aos_reconciliation_runs"("tradingAccountId", "tradeDate");
CREATE INDEX "aos_reconciliation_runs_status_tradeDate_idx" ON "aos_reconciliation_runs"("status", "tradeDate");
CREATE INDEX "aos_reconciliation_runs_receiptHash_idx" ON "aos_reconciliation_runs"("receiptHash");

CREATE TABLE "aos_reconciliation_breaks" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "breakKey" TEXT NOT NULL,
  "severity" "AosReconciliationBreakSeverity" NOT NULL,
  "resolution" "AosReconciliationBreakResolution" NOT NULL DEFAULT 'OPEN',
  "category" TEXT NOT NULL,
  "expectedJson" JSONB NOT NULL,
  "actualJson" JSONB NOT NULL,
  "explanation" TEXT,
  "resolvedByInterventionId" TEXT,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_reconciliation_breaks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_reconciliation_breaks_json_check" CHECK (jsonb_typeof("expectedJson") = 'object' AND jsonb_typeof("actualJson") = 'object'),
  CONSTRAINT "aos_reconciliation_breaks_hash_check" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_reconciliation_breaks_runId_breakKey_key" ON "aos_reconciliation_breaks"("runId", "breakKey");
CREATE INDEX "aos_reconciliation_breaks_resolution_severity_idx" ON "aos_reconciliation_breaks"("resolution", "severity");
CREATE INDEX "aos_reconciliation_breaks_resolvedByInterventionId_idx" ON "aos_reconciliation_breaks"("resolvedByInterventionId");

CREATE TABLE "aos_human_interventions" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "type" "AosHumanInterventionType" NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reasonText" TEXT NOT NULL,
  "beforeJson" JSONB NOT NULL,
  "afterJson" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_human_interventions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_human_interventions_reason_check" CHECK (length("reasonCode") BETWEEN 2 AND 64 AND length("reasonText") BETWEEN 3 AND 1000),
  CONSTRAINT "aos_human_interventions_json_check" CHECK (jsonb_typeof("beforeJson") = 'object' AND jsonb_typeof("afterJson") = 'object'),
  CONSTRAINT "aos_human_interventions_hash_check" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "aos_human_interventions_correlationId_key" ON "aos_human_interventions"("correlationId");
CREATE INDEX "aos_human_interventions_targetType_targetId_createdAt_idx" ON "aos_human_interventions"("targetType", "targetId", "createdAt");
CREATE INDEX "aos_human_interventions_actorUserId_createdAt_idx" ON "aos_human_interventions"("actorUserId", "createdAt");

ALTER TABLE "aos_trading_accounts" ADD CONSTRAINT "aos_trading_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_capital_buckets" ADD CONSTRAINT "aos_capital_buckets_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "aos_trading_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_portfolio_proposals" ADD CONSTRAINT "aos_portfolio_proposals_signalDecisionId_fkey" FOREIGN KEY ("signalDecisionId") REFERENCES "aos_signal_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_portfolio_proposals" ADD CONSTRAINT "aos_portfolio_proposals_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "aos_strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_portfolio_proposals" ADD CONSTRAINT "aos_portfolio_proposals_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "aos_trading_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_kill_switch_events" ADD CONSTRAINT "aos_kill_switch_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_risk_decisions" ADD CONSTRAINT "aos_risk_decisions_portfolioProposalId_fkey" FOREIGN KEY ("portfolioProposalId") REFERENCES "aos_portfolio_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_risk_decisions" ADD CONSTRAINT "aos_risk_decisions_signalDecisionId_fkey" FOREIGN KEY ("signalDecisionId") REFERENCES "aos_signal_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_risk_decisions" ADD CONSTRAINT "aos_risk_decisions_riskPolicyVersionId_fkey" FOREIGN KEY ("riskPolicyVersionId") REFERENCES "aos_risk_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_risk_decisions" ADD CONSTRAINT "aos_risk_decisions_killSwitchEventId_fkey" FOREIGN KEY ("killSwitchEventId") REFERENCES "aos_kill_switch_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_order_plans" ADD CONSTRAINT "aos_order_plans_portfolioProposalId_fkey" FOREIGN KEY ("portfolioProposalId") REFERENCES "aos_portfolio_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_order_plans" ADD CONSTRAINT "aos_order_plans_signalDecisionId_fkey" FOREIGN KEY ("signalDecisionId") REFERENCES "aos_signal_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_order_plans" ADD CONSTRAINT "aos_order_plans_riskDecisionId_fkey" FOREIGN KEY ("riskDecisionId") REFERENCES "aos_risk_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_order_plans" ADD CONSTRAINT "aos_order_plans_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "aos_strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_order_plans" ADD CONSTRAINT "aos_order_plans_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "aos_trading_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_orders" ADD CONSTRAINT "aos_orders_orderPlanId_fkey" FOREIGN KEY ("orderPlanId") REFERENCES "aos_order_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_order_fills" ADD CONSTRAINT "aos_order_fills_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "aos_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_reconciliation_runs" ADD CONSTRAINT "aos_reconciliation_runs_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "aos_trading_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_reconciliation_breaks" ADD CONSTRAINT "aos_reconciliation_breaks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "aos_reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_human_interventions" ADD CONSTRAINT "aos_human_interventions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_reconciliation_breaks" ADD CONSTRAINT "aos_reconciliation_breaks_resolvedByInterventionId_fkey" FOREIGN KEY ("resolvedByInterventionId") REFERENCES "aos_human_interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "aos_reject_execution_ledger_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AOS_EXECUTION_LEDGER_APPEND_ONLY: % on % is forbidden', TG_OP, TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_portfolio_proposals_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_portfolio_proposals" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_risk_decisions_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_risk_decisions" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_order_fills_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_order_fills" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_reconciliation_runs_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_reconciliation_runs" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_reconciliation_breaks_delete_guard" BEFORE DELETE ON "aos_reconciliation_breaks" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_human_interventions_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_human_interventions" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_kill_switch_events_append_only_guard" BEFORE UPDATE OR DELETE ON "aos_kill_switch_events" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();

CREATE TRIGGER "aos_portfolio_proposals_truncate_guard" BEFORE TRUNCATE ON "aos_portfolio_proposals" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_risk_decisions_truncate_guard" BEFORE TRUNCATE ON "aos_risk_decisions" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_order_fills_truncate_guard" BEFORE TRUNCATE ON "aos_order_fills" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_reconciliation_runs_truncate_guard" BEFORE TRUNCATE ON "aos_reconciliation_runs" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_reconciliation_breaks_truncate_guard" BEFORE TRUNCATE ON "aos_reconciliation_breaks" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_human_interventions_truncate_guard" BEFORE TRUNCATE ON "aos_human_interventions" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_kill_switch_events_truncate_guard" BEFORE TRUNCATE ON "aos_kill_switch_events" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();

CREATE OR REPLACE FUNCTION "aos_guard_reconciliation_break_update"() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(OLD."runId", OLD."breakKey", OLD."severity", OLD."category", OLD."expectedJson", OLD."actualJson", OLD."evidenceHash", OLD."createdAt") IS DISTINCT FROM
     ROW(NEW."runId", NEW."breakKey", NEW."severity", NEW."category", NEW."expectedJson", NEW."actualJson", NEW."evidenceHash", NEW."createdAt") THEN
    RAISE EXCEPTION 'AOS_RECONCILIATION_BREAK_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;
  IF OLD."resolution" <> 'OPEN' OR NEW."resolution" NOT IN ('EXPLAINED','RESOLVED') OR NEW."resolvedByInterventionId" IS NULL OR length(COALESCE(NEW."explanation",'')) < 3 THEN
    RAISE EXCEPTION 'AOS_RECONCILIATION_BREAK_INVALID_RESOLUTION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aos_reconciliation_breaks_update_guard" BEFORE UPDATE ON "aos_reconciliation_breaks" FOR EACH ROW EXECUTE FUNCTION "aos_guard_reconciliation_break_update"();

CREATE OR REPLACE FUNCTION "aos_guard_order_plan_update"() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(OLD."portfolioProposalId", OLD."signalDecisionId", OLD."riskDecisionId", OLD."strategyVersionId", OLD."tradingAccountId", OLD."mode", OLD."side", OLD."orderType", OLD."plannedQuantity", OLD."plannedPrice", OLD."stopPrice", OLD."takeProfitPrice", OLD."maxHoldDays", OLD."validFrom", OLD."expiresAt", OLD."idempotencyKey", OLD."planHash") IS DISTINCT FROM
     ROW(NEW."portfolioProposalId", NEW."signalDecisionId", NEW."riskDecisionId", NEW."strategyVersionId", NEW."tradingAccountId", NEW."mode", NEW."side", NEW."orderType", NEW."plannedQuantity", NEW."plannedPrice", NEW."stopPrice", NEW."takeProfitPrice", NEW."maxHoldDays", NEW."validFrom", NEW."expiresAt", NEW."idempotencyKey", NEW."planHash") THEN
    RAISE EXCEPTION 'AOS_ORDER_PLAN_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD."status" = 'PLANNED' AND NEW."status" IN ('APPROVED','CANCELLED','EXPIRED')) OR
          (OLD."status" = 'APPROVED' AND NEW."status" IN ('QUEUED','CANCELLED','EXPIRED')) OR
          (OLD."status" = 'QUEUED' AND NEW."status" IN ('EXECUTED','CANCELLED','EXPIRED')) OR
          OLD."status" = NEW."status") THEN
    RAISE EXCEPTION 'AOS_ORDER_PLAN_INVALID_TRANSITION: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aos_order_plans_update_guard" BEFORE UPDATE ON "aos_order_plans" FOR EACH ROW EXECUTE FUNCTION "aos_guard_order_plan_update"();
CREATE TRIGGER "aos_order_plans_delete_guard" BEFORE DELETE ON "aos_order_plans" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_order_plans_truncate_guard" BEFORE TRUNCATE ON "aos_order_plans" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();

CREATE OR REPLACE FUNCTION "aos_guard_order_update"() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(OLD."orderPlanId", OLD."legacyPaperTradeId", OLD."requestedQuantity", OLD."brokerOrderId", OLD."createdAt") IS DISTINCT FROM
     ROW(NEW."orderPlanId", NEW."legacyPaperTradeId", NEW."requestedQuantity", NEW."brokerOrderId", NEW."createdAt") THEN
    RAISE EXCEPTION 'AOS_ORDER_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD."status" = 'NEW' AND NEW."status" IN ('SUBMITTED','CANCELLED','REJECTED')) OR
          (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('PARTIAL','FILLED','CANCELLED','REJECTED')) OR
          (OLD."status" = 'PARTIAL' AND NEW."status" IN ('PARTIAL','FILLED','CANCELLED')) OR
          OLD."status" = NEW."status") THEN
    RAISE EXCEPTION 'AOS_ORDER_INVALID_TRANSITION: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aos_orders_update_guard" BEFORE UPDATE ON "aos_orders" FOR EACH ROW EXECUTE FUNCTION "aos_guard_order_update"();
CREATE TRIGGER "aos_orders_delete_guard" BEFORE DELETE ON "aos_orders" FOR EACH ROW EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();
CREATE TRIGGER "aos_orders_truncate_guard" BEFORE TRUNCATE ON "aos_orders" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_execution_ledger_mutation"();

CREATE OR REPLACE FUNCTION "aos_guard_capital_bucket_account_type"() RETURNS TRIGGER AS $$
DECLARE
  account_type "AosTradingAccountType";
BEGIN
  SELECT "accountType" INTO account_type FROM "aos_trading_accounts" WHERE "id" = NEW."tradingAccountId";
  IF account_type IS NULL THEN
    RAISE EXCEPTION 'AOS_CAPITAL_BUCKET_ACCOUNT_MISSING' USING ERRCODE = '23503';
  END IF;
  IF (account_type = 'LONG_TERM' AND NEW."bucketType" = 'SYSTEM_TRADING') OR
     (account_type = 'SYSTEM_TRADING' AND NEW."bucketType" IN ('SPGI','VTI')) THEN
    RAISE EXCEPTION 'AOS_CAPITAL_BUCKET_ACCOUNT_TYPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aos_capital_buckets_account_type_guard" BEFORE INSERT OR UPDATE ON "aos_capital_buckets" FOR EACH ROW EXECUTE FUNCTION "aos_guard_capital_bucket_account_type"();
