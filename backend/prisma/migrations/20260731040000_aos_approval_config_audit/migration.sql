-- AOS Phase A2-4 / Issue #559: 승인·설정 변경 append-only 원장 기반.
--
-- 비파괴:
--   * 신규 enum/table/index/trigger만 추가한다.
--   * 승인 인원·역할표·권한 seed를 정하지 않는다.
--   * 기존 activation/Engine5/Signal/Paper/Order 경로와 운영 데이터는 변경하지 않는다.

-- CreateEnum
CREATE TYPE "ApprovalSubjectType" AS ENUM (
    'STRATEGY_VERSION',
    'RISK_POLICY_VERSION',
    'VERSION_ACTIVATION'
);

CREATE TYPE "ApprovalDecision" AS ENUM (
    'APPROVE',
    'REJECT'
);

CREATE TYPE "ConfigAuditSubjectType" AS ENUM (
    'STRATEGY',
    'RULE_DEFINITION',
    'STRATEGY_VERSION',
    'RISK_POLICY_VERSION',
    'VERSION_ACTIVATION'
);

CREATE TYPE "ConfigAuditAction" AS ENUM (
    'CREATED',
    'DRAFT_MUTATED',
    'DELETED',
    'STATE_TRANSITIONED',
    'ACTIVATION_RECORDED'
);

CREATE TYPE "ConfigAuditActorType" AS ENUM (
    'USER',
    'SYSTEM'
);

-- CreateTable
CREATE TABLE "aos_approval_records" (
    "id" TEXT NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRoleKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aos_approval_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_approval_records_subject_id_check"
        CHECK (btrim("subjectId") <> ''),
    CONSTRAINT "aos_approval_records_subject_hash_check"
        CHECK ("subjectHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_approval_records_actor_role_check"
        CHECK (btrim("actorRoleKey") <> ''),
    CONSTRAINT "aos_approval_records_reason_check"
        CHECK (btrim("reason") <> ''),
    CONSTRAINT "aos_approval_records_evidence_hash_check"
        CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_approval_records_correlation_check"
        CHECK (btrim("correlationId") <> ''),
    CONSTRAINT "aos_approval_records_idempotency_check"
        CHECK (btrim("idempotencyKey") <> ''),
    CONSTRAINT "aos_approval_records_record_hash_check"
        CHECK ("recordHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_approval_records_actor_user_check"
        CHECK (btrim("actorUserId") <> '')
);

CREATE TABLE "aos_config_audit_events" (
    "id" TEXT NOT NULL,
    "subjectType" "ConfigAuditSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "action" "ConfigAuditAction" NOT NULL,
    "actorType" "ConfigAuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorContextSnapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aos_config_audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_config_audit_events_subject_id_check"
        CHECK (btrim("subjectId") <> ''),
    CONSTRAINT "aos_config_audit_events_actor_shape_check" CHECK (
        ("actorType" = 'USER' AND "actorUserId" IS NOT NULL AND btrim("actorUserId") <> '')
        OR ("actorType" = 'SYSTEM' AND "actorUserId" IS NULL)
    ),
    CONSTRAINT "aos_config_audit_events_actor_context_check"
        CHECK (btrim("actorContextSnapshot") <> ''),
    CONSTRAINT "aos_config_audit_events_reason_check"
        CHECK (btrim("reason") <> ''),
    CONSTRAINT "aos_config_audit_events_before_hash_check"
        CHECK ("beforeHash" IS NULL OR "beforeHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_config_audit_events_after_hash_check"
        CHECK ("afterHash" IS NULL OR "afterHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_config_audit_events_hash_shape_check" CHECK (
        (
            "action" = 'CREATED'
            AND "beforeHash" IS NULL
            AND "afterHash" IS NOT NULL
        )
        OR (
            "action" = 'DELETED'
            AND "beforeHash" IS NOT NULL
            AND "afterHash" IS NULL
        )
        OR (
            "action" NOT IN ('CREATED', 'DELETED')
            AND "beforeHash" IS NOT NULL
            AND "afterHash" IS NOT NULL
        )
    ),
    CONSTRAINT "aos_config_audit_events_correlation_check"
        CHECK (btrim("correlationId") <> ''),
    CONSTRAINT "aos_config_audit_events_idempotency_check"
        CHECK (btrim("idempotencyKey") <> ''),
    CONSTRAINT "aos_config_audit_events_event_hash_check"
        CHECK ("eventHash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "aos_approval_records_idempotencyKey_key"
    ON "aos_approval_records"("idempotencyKey");
CREATE INDEX "aos_approval_records_subjectType_subjectId_createdAt_idx"
    ON "aos_approval_records"("subjectType", "subjectId", "createdAt");
CREATE INDEX "aos_approval_records_actorUserId_createdAt_idx"
    ON "aos_approval_records"("actorUserId", "createdAt");
CREATE INDEX "aos_approval_records_correlationId_idx"
    ON "aos_approval_records"("correlationId");
CREATE INDEX "aos_approval_records_recordHash_idx"
    ON "aos_approval_records"("recordHash");
CREATE UNIQUE INDEX "aos_approval_records_flow_actor_target_key"
    ON "aos_approval_records"(
        "correlationId",
        "subjectType",
        "subjectId",
        "subjectHash",
        "actorUserId"
    );

CREATE UNIQUE INDEX "aos_config_audit_events_idempotencyKey_key"
    ON "aos_config_audit_events"("idempotencyKey");
CREATE INDEX "aos_config_audit_events_subjectType_subjectId_createdAt_idx"
    ON "aos_config_audit_events"("subjectType", "subjectId", "createdAt");
CREATE INDEX "aos_config_audit_events_actorUserId_createdAt_idx"
    ON "aos_config_audit_events"("actorUserId", "createdAt");
CREATE INDEX "aos_config_audit_events_correlationId_idx"
    ON "aos_config_audit_events"("correlationId");
CREATE INDEX "aos_config_audit_events_eventHash_idx"
    ON "aos_config_audit_events"("eventHash");
-- 하나의 flow에서 동일 actor·subject·action·hash event의 재기록을 차단한다.
-- NULL hash도 동일하게 비교하기 위해 Prisma가 표현하지 못하는 expression index를 사용한다.
CREATE UNIQUE INDEX "aos_config_audit_events_flow_event_key"
    ON "aos_config_audit_events"(
        "correlationId",
        "subjectType",
        "subjectId",
        "action",
        COALESCE("beforeHash", ''),
        COALESCE("afterHash", ''),
        "actorType",
        COALESCE("actorUserId", '')
    );

-- 승인 시점에는 실제 User가 존재해야 한다. 이후 계정 삭제가 감사 원장을
-- cascade/update하지 않도록 actorUserId는 불변 logical reference로 보존한다.
CREATE OR REPLACE FUNCTION "aos_validate_approval_actor_insert"()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "users" WHERE "id" = NEW."actorUserId"
    ) THEN
        RAISE EXCEPTION 'AOS_GOVERNANCE_ACTOR_NOT_FOUND: %', NEW."actorUserId"
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "aos_validate_config_audit_actor_insert"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."actorType" = 'USER' AND NOT EXISTS (
        SELECT 1 FROM "users" WHERE "id" = NEW."actorUserId"
    ) THEN
        RAISE EXCEPTION 'AOS_GOVERNANCE_ACTOR_NOT_FOUND: %', NEW."actorUserId"
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_approval_records_actor_guard"
BEFORE INSERT ON "aos_approval_records"
FOR EACH ROW EXECUTE FUNCTION "aos_validate_approval_actor_insert"();

CREATE TRIGGER "aos_config_audit_events_actor_guard"
BEFORE INSERT ON "aos_config_audit_events"
FOR EACH ROW EXECUTE FUNCTION "aos_validate_config_audit_actor_insert"();

-- 승인과 설정 감사는 append-only다. 정정은 새 event/record로만 남긴다.
CREATE OR REPLACE FUNCTION "aos_reject_governance_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AOS_GOVERNANCE_LEDGER_APPEND_ONLY: % on % is forbidden',
        TG_OP, TG_TABLE_NAME
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_approval_records_append_only_guard"
BEFORE UPDATE OR DELETE ON "aos_approval_records"
FOR EACH ROW EXECUTE FUNCTION "aos_reject_governance_ledger_mutation"();

CREATE TRIGGER "aos_approval_records_truncate_guard"
BEFORE TRUNCATE ON "aos_approval_records"
FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_governance_ledger_mutation"();

CREATE TRIGGER "aos_config_audit_events_append_only_guard"
BEFORE UPDATE OR DELETE ON "aos_config_audit_events"
FOR EACH ROW EXECUTE FUNCTION "aos_reject_governance_ledger_mutation"();

CREATE TRIGGER "aos_config_audit_events_truncate_guard"
BEFORE TRUNCATE ON "aos_config_audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_governance_ledger_mutation"();
