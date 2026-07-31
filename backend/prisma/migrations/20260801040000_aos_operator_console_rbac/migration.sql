CREATE TYPE "AosOperatorRole" AS ENUM ('VIEWER', 'EDITOR', 'APPROVER', 'RISK_OFFICER', 'ADMIN');
CREATE TYPE "AosOperatorMembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "AosStepUpScope" AS ENUM ('CONFIG_CHANGE', 'APPROVAL', 'EMERGENCY_CONTROL', 'RECONCILIATION');
CREATE TYPE "AosOperatorCommandStatus" AS ENUM ('SUCCEEDED', 'REJECTED', 'FAILED');

CREATE TABLE "aos_operator_memberships" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "AosOperatorRole" NOT NULL,
  "status" "AosOperatorMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "grantedByUserId" TEXT,
  "grantedReason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aos_operator_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_operator_memberships_reason_check" CHECK (char_length("grantedReason") BETWEEN 3 AND 500)
);

CREATE TABLE "aos_step_up_grants" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenIdHash" TEXT NOT NULL,
  "scope" "AosStepUpScope" NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'PASSWORD',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_step_up_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_step_up_grants_hash_check" CHECK ("tokenIdHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "aos_step_up_grants_method_check" CHECK ("method" IN ('PASSWORD')),
  CONSTRAINT "aos_step_up_grants_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "aos_step_up_grants_consume_check" CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt")
);

CREATE TABLE "aos_operator_command_receipts" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" "AosOperatorRole" NOT NULL,
  "stepUpGrantId" TEXT NOT NULL,
  "commandType" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requestJson" JSONB NOT NULL,
  "resultJson" JSONB NOT NULL,
  "status" "AosOperatorCommandStatus" NOT NULL,
  "correlationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aos_operator_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aos_operator_commands_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 1000),
  CONSTRAINT "aos_operator_commands_name_check" CHECK (char_length("commandType") BETWEEN 2 AND 100 AND char_length("targetType") BETWEEN 2 AND 100 AND char_length("targetId") BETWEEN 1 AND 200),
  CONSTRAINT "aos_operator_commands_json_check" CHECK (jsonb_typeof("requestJson") = 'object' AND jsonb_typeof("resultJson") = 'object'),
  CONSTRAINT "aos_operator_commands_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$' AND "receiptHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "aos_operator_memberships_userId_key" ON "aos_operator_memberships"("userId");
CREATE INDEX "aos_operator_memberships_role_status_idx" ON "aos_operator_memberships"("role", "status");
CREATE INDEX "aos_operator_memberships_grantedByUserId_idx" ON "aos_operator_memberships"("grantedByUserId");
CREATE UNIQUE INDEX "aos_step_up_grants_tokenIdHash_key" ON "aos_step_up_grants"("tokenIdHash");
CREATE INDEX "aos_step_up_grants_userId_expiresAt_idx" ON "aos_step_up_grants"("userId", "expiresAt");
CREATE INDEX "aos_step_up_grants_scope_consumedAt_idx" ON "aos_step_up_grants"("scope", "consumedAt");
CREATE UNIQUE INDEX "aos_operator_command_receipts_stepUpGrantId_key" ON "aos_operator_command_receipts"("stepUpGrantId");
CREATE UNIQUE INDEX "aos_operator_command_receipts_correlationId_key" ON "aos_operator_command_receipts"("correlationId");
CREATE INDEX "aos_operator_command_receipts_actorUserId_createdAt_idx" ON "aos_operator_command_receipts"("actorUserId", "createdAt");
CREATE INDEX "aos_operator_command_receipts_targetType_targetId_createdAt_idx" ON "aos_operator_command_receipts"("targetType", "targetId", "createdAt");
CREATE INDEX "aos_operator_command_receipts_status_createdAt_idx" ON "aos_operator_command_receipts"("status", "createdAt");
CREATE INDEX "aos_operator_command_receipts_receiptHash_idx" ON "aos_operator_command_receipts"("receiptHash");

ALTER TABLE "aos_operator_memberships" ADD CONSTRAINT "aos_operator_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_operator_memberships" ADD CONSTRAINT "aos_operator_memberships_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_step_up_grants" ADD CONSTRAINT "aos_step_up_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_operator_command_receipts" ADD CONSTRAINT "aos_operator_command_receipts_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aos_operator_command_receipts" ADD CONSTRAINT "aos_operator_command_receipts_stepUpGrantId_fkey" FOREIGN KEY ("stepUpGrantId") REFERENCES "aos_step_up_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "aos_guard_step_up_grant_update"() RETURNS trigger AS $$
BEGIN
  IF OLD."consumedAt" IS NULL
     AND NEW."consumedAt" IS NOT NULL
     AND ROW(NEW."id", NEW."userId", NEW."tokenIdHash", NEW."scope", NEW."method", NEW."expiresAt", NEW."createdAt")
       IS NOT DISTINCT FROM
       ROW(OLD."id", OLD."userId", OLD."tokenIdHash", OLD."scope", OLD."method", OLD."expiresAt", OLD."createdAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AOS_STEP_UP_GRANT_IMMUTABLE_OR_ALREADY_CONSUMED';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "aos_reject_operator_ledger_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AOS_OPERATOR_LEDGER_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_step_up_grants_update_guard" BEFORE UPDATE ON "aos_step_up_grants" FOR EACH ROW EXECUTE FUNCTION "aos_guard_step_up_grant_update"();
CREATE TRIGGER "aos_step_up_grants_delete_guard" BEFORE DELETE ON "aos_step_up_grants" FOR EACH ROW EXECUTE FUNCTION "aos_reject_operator_ledger_mutation"();
CREATE TRIGGER "aos_step_up_grants_truncate_guard" BEFORE TRUNCATE ON "aos_step_up_grants" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_operator_ledger_mutation"();
CREATE TRIGGER "aos_operator_commands_update_guard" BEFORE UPDATE OR DELETE ON "aos_operator_command_receipts" FOR EACH ROW EXECUTE FUNCTION "aos_reject_operator_ledger_mutation"();
CREATE TRIGGER "aos_operator_commands_truncate_guard" BEFORE TRUNCATE ON "aos_operator_command_receipts" FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_operator_ledger_mutation"();
