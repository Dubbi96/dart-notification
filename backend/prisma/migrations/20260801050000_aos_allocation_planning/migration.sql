-- AOS Phase A8 / Issue #576: realized-profit allocation planning and append-only evidence.
-- This migration creates plans only. It intentionally has no transfer, FX, brokerage, or order rail.

CREATE TYPE "AosAllocationPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "AosAllocationPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');
CREATE TYPE "AosAllocationDestination" AS ENUM ('SPGI', 'VTI', 'SYSTEM_TRADING');
CREATE TYPE "AosAllocationLedgerEventType" AS ENUM ('POLICY_CREATED', 'POLICY_ACTIVATED', 'PLAN_CREATED', 'PLAN_APPROVED', 'PLAN_CANCELLED', 'PLAN_REISSUED');

CREATE TABLE "aos_allocation_policies" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AosAllocationPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "spgiWeight" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  "vtiWeight" DECIMAL(5,4) NOT NULL DEFAULT 0.3,
  "systemTradingWeight" DECIMAL(5,4) NOT NULL DEFAULT 0.2,
  "profitPeriodPolicyJson" JSONB NOT NULL,
  "taxReservePolicyJson" JSONB NOT NULL,
  "fxPolicyJson" JSONB NOT NULL,
  "minimumAmountPolicyJson" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "effectiveFrom" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_allocation_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_allocation_policy_fixed_weights_check" CHECK ("spgiWeight" = 0.5000 AND "vtiWeight" = 0.3000 AND "systemTradingWeight" = 0.2000),
  CONSTRAINT "aos_allocation_policy_json_check" CHECK (jsonb_typeof("profitPeriodPolicyJson") = 'object' AND jsonb_typeof("taxReservePolicyJson") = 'object' AND jsonb_typeof("fxPolicyJson") = 'object' AND jsonb_typeof("minimumAmountPolicyJson") = 'object'),
  CONSTRAINT "aos_allocation_policy_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "aos_allocation_policy_approval_check" CHECK (("status" = 'DRAFT' AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL AND "effectiveFrom" IS NULL) OR ("status" IN ('ACTIVE','RETIRED') AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "effectiveFrom" IS NOT NULL)),
  CONSTRAINT "aos_allocation_policy_actor_separation_check" CHECK ("approvedByUserId" IS NULL OR "approvedByUserId" <> "createdByUserId")
);

CREATE TABLE "aos_allocation_plans" (
  "id" TEXT NOT NULL,
  "allocationPolicyId" TEXT NOT NULL,
  "tradingAccountId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "grossRealizedProfit" DECIMAL(18,2) NOT NULL,
  "taxReserveAmount" DECIMAL(18,2) NOT NULL,
  "fxReserveAmount" DECIMAL(18,2) NOT NULL,
  "distributableProfit" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KRW',
  "status" "AosAllocationPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceEvidenceJson" JSONB NOT NULL,
  "sourceEvidenceHash" TEXT NOT NULL,
  "planHash" TEXT NOT NULL,
  "parentPlanId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_allocation_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_allocation_plan_period_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "aos_allocation_plan_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "aos_allocation_plan_amount_check" CHECK ("grossRealizedProfit" > 0 AND "taxReserveAmount" >= 0 AND "fxReserveAmount" >= 0 AND "distributableProfit" > 0 AND "distributableProfit" = "grossRealizedProfit" - "taxReserveAmount" - "fxReserveAmount"),
  CONSTRAINT "aos_allocation_plan_currency_check" CHECK ("currency" = 'KRW'),
  CONSTRAINT "aos_allocation_plan_evidence_check" CHECK (jsonb_typeof("sourceEvidenceJson") = 'object' AND "sourceEvidenceHash" ~ '^[0-9a-f]{64}$' AND "planHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "aos_allocation_plan_approval_check" CHECK (("status" = 'DRAFT' AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL AND "cancelledAt" IS NULL) OR ("status" = 'APPROVED' AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)),
  CONSTRAINT "aos_allocation_plan_actor_separation_check" CHECK ("approvedByUserId" IS NULL OR "approvedByUserId" <> "createdByUserId")
);

CREATE TABLE "aos_allocation_plan_items" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "destination" "AosAllocationDestination" NOT NULL,
  "weight" DECIMAL(5,4) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KRW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_allocation_plan_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_allocation_item_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "aos_allocation_item_currency_check" CHECK ("currency" = 'KRW'),
  CONSTRAINT "aos_allocation_item_weight_check" CHECK (("destination" = 'SPGI' AND "weight" = 0.5000) OR ("destination" = 'VTI' AND "weight" = 0.3000) OR ("destination" = 'SYSTEM_TRADING' AND "weight" = 0.2000))
);

CREATE TABLE "aos_allocation_ledger_entries" (
  "id" TEXT NOT NULL,
  "policyId" TEXT,
  "planId" TEXT,
  "eventType" "AosAllocationLedgerEventType" NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" "AosOperatorRole" NOT NULL,
  "reason" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_allocation_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_allocation_ledger_target_check" CHECK (("policyId" IS NOT NULL)::int + ("planId" IS NOT NULL)::int = 1),
  CONSTRAINT "aos_allocation_ledger_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 1000),
  CONSTRAINT "aos_allocation_ledger_snapshot_check" CHECK (jsonb_typeof("snapshotJson") = 'object'),
  CONSTRAINT "aos_allocation_ledger_hash_check" CHECK ("snapshotHash" ~ '^[0-9a-f]{64}$' AND "receiptHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "aos_allocation_policies_version_key" ON "aos_allocation_policies"("version");
CREATE UNIQUE INDEX "aos_allocation_policies_contentHash_key" ON "aos_allocation_policies"("contentHash");
CREATE UNIQUE INDEX "aos_allocation_one_active_policy_key" ON "aos_allocation_policies" ((1)) WHERE "status" = 'ACTIVE';
CREATE INDEX "aos_allocation_policies_status_effectiveFrom_idx" ON "aos_allocation_policies"("status", "effectiveFrom");
CREATE INDEX "aos_allocation_policies_createdByUserId_createdAt_idx" ON "aos_allocation_policies"("createdByUserId", "createdAt");
CREATE UNIQUE INDEX "aos_allocation_plans_planHash_key" ON "aos_allocation_plans"("planHash");
CREATE UNIQUE INDEX "aos_allocation_plans_account_period_revision_key" ON "aos_allocation_plans"("tradingAccountId", "periodStart", "periodEnd", "revision");
CREATE INDEX "aos_allocation_plans_account_status_period_idx" ON "aos_allocation_plans"("tradingAccountId", "status", "periodEnd");
CREATE INDEX "aos_allocation_plans_policy_status_idx" ON "aos_allocation_plans"("allocationPolicyId", "status");
CREATE INDEX "aos_allocation_plans_parentPlanId_idx" ON "aos_allocation_plans"("parentPlanId");
CREATE INDEX "aos_allocation_plans_sourceEvidenceHash_idx" ON "aos_allocation_plans"("sourceEvidenceHash");
CREATE UNIQUE INDEX "aos_allocation_plan_items_plan_destination_key" ON "aos_allocation_plan_items"("planId", "destination");
CREATE INDEX "aos_allocation_plan_items_destination_createdAt_idx" ON "aos_allocation_plan_items"("destination", "createdAt");
CREATE UNIQUE INDEX "aos_allocation_ledger_correlationId_key" ON "aos_allocation_ledger_entries"("correlationId");
CREATE UNIQUE INDEX "aos_allocation_ledger_receiptHash_key" ON "aos_allocation_ledger_entries"("receiptHash");
CREATE INDEX "aos_allocation_ledger_policyId_createdAt_idx" ON "aos_allocation_ledger_entries"("policyId", "createdAt");
CREATE INDEX "aos_allocation_ledger_planId_createdAt_idx" ON "aos_allocation_ledger_entries"("planId", "createdAt");
CREATE INDEX "aos_allocation_ledger_actorUserId_createdAt_idx" ON "aos_allocation_ledger_entries"("actorUserId", "createdAt");

ALTER TABLE "aos_allocation_policies" ADD CONSTRAINT "aos_allocation_policies_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_policies" ADD CONSTRAINT "aos_allocation_policies_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_plans" ADD CONSTRAINT "aos_allocation_plans_allocationPolicyId_fkey" FOREIGN KEY ("allocationPolicyId") REFERENCES "aos_allocation_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_plans" ADD CONSTRAINT "aos_allocation_plans_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "aos_trading_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_plans" ADD CONSTRAINT "aos_allocation_plans_parentPlanId_fkey" FOREIGN KEY ("parentPlanId") REFERENCES "aos_allocation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_plans" ADD CONSTRAINT "aos_allocation_plans_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_plans" ADD CONSTRAINT "aos_allocation_plans_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_plan_items" ADD CONSTRAINT "aos_allocation_plan_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "aos_allocation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_ledger_entries" ADD CONSTRAINT "aos_allocation_ledger_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "aos_allocation_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_ledger_entries" ADD CONSTRAINT "aos_allocation_ledger_planId_fkey" FOREIGN KEY ("planId") REFERENCES "aos_allocation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_allocation_ledger_entries" ADD CONSTRAINT "aos_allocation_ledger_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "aos_reject_allocation_ledger_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AOS_ALLOCATION_LEDGER_APPEND_ONLY' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "aos_guard_allocation_policy_update"() RETURNS trigger AS $$
BEGIN
  IF ROW(OLD."id", OLD."version", OLD."spgiWeight", OLD."vtiWeight", OLD."systemTradingWeight", OLD."profitPeriodPolicyJson", OLD."taxReservePolicyJson", OLD."fxPolicyJson", OLD."minimumAmountPolicyJson", OLD."contentHash", OLD."createdByUserId", OLD."createdAt") IS DISTINCT FROM
     ROW(NEW."id", NEW."version", NEW."spgiWeight", NEW."vtiWeight", NEW."systemTradingWeight", NEW."profitPeriodPolicyJson", NEW."taxReservePolicyJson", NEW."fxPolicyJson", NEW."minimumAmountPolicyJson", NEW."contentHash", NEW."createdByUserId", NEW."createdAt") THEN
    RAISE EXCEPTION 'AOS_ALLOCATION_POLICY_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'RETIRED') OR OLD."status" = NEW."status") THEN
    RAISE EXCEPTION 'AOS_ALLOCATION_POLICY_INVALID_TRANSITION: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "aos_guard_allocation_plan_update"() RETURNS trigger AS $$
BEGIN
  IF ROW(OLD."id", OLD."allocationPolicyId", OLD."tradingAccountId", OLD."periodStart", OLD."periodEnd", OLD."revision", OLD."grossRealizedProfit", OLD."taxReserveAmount", OLD."fxReserveAmount", OLD."distributableProfit", OLD."currency", OLD."sourceEvidenceJson", OLD."sourceEvidenceHash", OLD."planHash", OLD."parentPlanId", OLD."createdByUserId", OLD."createdAt") IS DISTINCT FROM
     ROW(NEW."id", NEW."allocationPolicyId", NEW."tradingAccountId", NEW."periodStart", NEW."periodEnd", NEW."revision", NEW."grossRealizedProfit", NEW."taxReserveAmount", NEW."fxReserveAmount", NEW."distributableProfit", NEW."currency", NEW."sourceEvidenceJson", NEW."sourceEvidenceHash", NEW."planHash", NEW."parentPlanId", NEW."createdByUserId", NEW."createdAt") THEN
    RAISE EXCEPTION 'AOS_ALLOCATION_PLAN_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" IN ('APPROVED','CANCELLED')) OR (OLD."status" = 'APPROVED' AND NEW."status" = 'CANCELLED') OR OLD."status" = NEW."status") THEN
    RAISE EXCEPTION 'AOS_ALLOCATION_PLAN_INVALID_TRANSITION: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_allocation_policy_update_guard" BEFORE UPDATE ON "aos_allocation_policies" FOR EACH ROW EXECUTE FUNCTION "aos_guard_allocation_policy_update"();
CREATE TRIGGER "aos_allocation_policy_delete_guard" BEFORE DELETE ON "aos_allocation_policies" FOR EACH ROW EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_policy_truncate_guard" BEFORE TRUNCATE ON "aos_allocation_policies" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_plan_update_guard" BEFORE UPDATE ON "aos_allocation_plans" FOR EACH ROW EXECUTE FUNCTION "aos_guard_allocation_plan_update"();
CREATE TRIGGER "aos_allocation_plan_delete_guard" BEFORE DELETE ON "aos_allocation_plans" FOR EACH ROW EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_plan_truncate_guard" BEFORE TRUNCATE ON "aos_allocation_plans" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_item_mutation_guard" BEFORE UPDATE OR DELETE ON "aos_allocation_plan_items" FOR EACH ROW EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_item_truncate_guard" BEFORE TRUNCATE ON "aos_allocation_plan_items" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_ledger_mutation_guard" BEFORE UPDATE OR DELETE ON "aos_allocation_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
CREATE TRIGGER "aos_allocation_ledger_truncate_guard" BEFORE TRUNCATE ON "aos_allocation_ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_allocation_ledger_mutation"();
