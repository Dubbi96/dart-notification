-- AOS Phase A2-3 / Issue #557: Hard Risk 정책 불변 버전 저장 기반.
--
-- 비파괴:
--   * 신규 enum/table/index/trigger만 추가한다.
--   * 기존 Engine5 상수·RiskCheck·Paper/Order 경로는 읽거나 변경하지 않는다.
--   * 실제 정책 row/seed/ACTIVE 전환 및 운영 migration은 수행하지 않는다.

-- CreateEnum
CREATE TYPE "RiskPolicyVersionStatus" AS ENUM (
    'DRAFT',
    'VALIDATED',
    'BACKTESTED',
    'APPROVAL_PENDING',
    'APPROVED',
    'SCHEDULED',
    'ACTIVE',
    'REJECTED',
    'SUPERSEDED',
    'ROLLED_BACK',
    'RETIRED'
);

-- CreateTable
CREATE TABLE "aos_risk_policy_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RiskPolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "limitsJson" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "createdByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aos_risk_policy_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_risk_policy_versions_version_check" CHECK ("version" > 0),
    CONSTRAINT "aos_risk_policy_versions_hash_check"
        CHECK ("configHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "aos_risk_policy_versions_parent_check"
        CHECK ("parentVersionId" IS NULL OR "parentVersionId" <> "id"),
    CONSTRAINT "aos_risk_policy_versions_limits_object_check"
        CHECK (jsonb_typeof("limitsJson") = 'object'),
    CONSTRAINT "aos_risk_policy_versions_asset_class_check"
        CHECK ("limitsJson" #>> '{constraints,assetClass}' IS NOT DISTINCT FROM 'KR_STOCK'),
    CONSTRAINT "aos_risk_policy_versions_direction_check"
        CHECK ("limitsJson" #>> '{constraints,direction}' IS NOT DISTINCT FROM 'LONG_ONLY'),
    CONSTRAINT "aos_risk_policy_versions_short_check"
        CHECK ("limitsJson" #>> '{constraints,allowShort}' IS NOT DISTINCT FROM 'false'),
    CONSTRAINT "aos_risk_policy_versions_leverage_check"
        CHECK ("limitsJson" #>> '{constraints,allowLeverage}' IS NOT DISTINCT FROM 'false'),
    CONSTRAINT "aos_risk_policy_versions_long_term_cover_check"
        CHECK ("limitsJson" #>> '{constraints,autoCoverFromLongTermAssets}' IS NOT DISTINCT FROM 'false'),
    CONSTRAINT "aos_risk_policy_versions_lifecycle_timestamps_check" CHECK (
        (
            "status" = 'DRAFT'
            AND "validatedAt" IS NULL
            AND "approvedAt" IS NULL
            AND "effectiveFrom" IS NULL
            AND "retiredAt" IS NULL
        )
        OR (
            "status" IN ('VALIDATED', 'BACKTESTED', 'APPROVAL_PENDING', 'REJECTED')
            AND "validatedAt" IS NOT NULL
            AND "approvedAt" IS NULL
            AND "effectiveFrom" IS NULL
            AND "retiredAt" IS NULL
        )
        OR (
            "status" = 'APPROVED'
            AND "validatedAt" IS NOT NULL
            AND "approvedAt" IS NOT NULL
            AND "effectiveFrom" IS NULL
            AND "retiredAt" IS NULL
        )
        OR (
            "status" IN ('SCHEDULED', 'ACTIVE')
            AND "validatedAt" IS NOT NULL
            AND "approvedAt" IS NOT NULL
            AND "effectiveFrom" IS NOT NULL
            AND "retiredAt" IS NULL
        )
        OR (
            "status" IN ('SUPERSEDED', 'ROLLED_BACK', 'RETIRED')
            AND "validatedAt" IS NOT NULL
            AND "approvedAt" IS NOT NULL
            AND "effectiveFrom" IS NOT NULL
            AND "retiredAt" IS NOT NULL
        )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "aos_risk_policy_versions_version_key"
    ON "aos_risk_policy_versions"("version");
CREATE INDEX "aos_risk_policy_versions_status_effectiveFrom_idx"
    ON "aos_risk_policy_versions"("status", "effectiveFrom");
CREATE INDEX "aos_risk_policy_versions_configHash_idx"
    ON "aos_risk_policy_versions"("configHash");
CREATE INDEX "aos_risk_policy_versions_parentVersionId_idx"
    ON "aos_risk_policy_versions"("parentVersionId");

-- Prisma가 표현하지 못하는 전역 단일 ACTIVE 불변식.
CREATE UNIQUE INDEX "aos_risk_policy_versions_one_active"
    ON "aos_risk_policy_versions"("status")
    WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "aos_risk_policy_versions"
    ADD CONSTRAINT "aos_risk_policy_versions_parentVersionId_fkey"
    FOREIGN KEY ("parentVersionId") REFERENCES "aos_risk_policy_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aos_risk_policy_versions"
    ADD CONSTRAINT "aos_risk_policy_versions_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "aos_guard_risk_policy_version_insert"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."status" <> 'DRAFT'
       OR NEW."validatedAt" IS NOT NULL
       OR NEW."approvedAt" IS NOT NULL
       OR NEW."effectiveFrom" IS NOT NULL
       OR NEW."retiredAt" IS NOT NULL THEN
        RAISE EXCEPTION 'AOS_RISK_POLICY_INSERT_INVALID: policy must start as a clean DRAFT'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "aos_guard_risk_policy_version_mutation"()
RETURNS TRIGGER AS $$
DECLARE
    current_kst TIMESTAMP;
    effective_kst TIMESTAMP;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'AOS_RISK_POLICY_IMMUTABLE: non-DRAFT policy cannot be deleted'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD."status" <> 'DRAFT' AND (
        NEW."version" IS DISTINCT FROM OLD."version"
        OR NEW."limitsJson" IS DISTINCT FROM OLD."limitsJson"
        OR NEW."configHash" IS DISTINCT FROM OLD."configHash"
        OR NEW."parentVersionId" IS DISTINCT FROM OLD."parentVersionId"
    ) THEN
        RAISE EXCEPTION 'AOS_RISK_POLICY_IMMUTABLE: non-DRAFT limits cannot be changed'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
        (OLD."status" = 'DRAFT' AND NEW."status" = 'VALIDATED')
        OR (OLD."status" = 'VALIDATED' AND NEW."status" IN ('DRAFT', 'BACKTESTED'))
        OR (OLD."status" = 'BACKTESTED' AND NEW."status" IN ('DRAFT', 'APPROVAL_PENDING'))
        OR (OLD."status" = 'APPROVAL_PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED'))
        OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SCHEDULED')
        OR (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('APPROVED', 'ACTIVE'))
        OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('SUPERSEDED', 'ROLLED_BACK', 'RETIRED'))
        OR (OLD."status" = 'REJECTED' AND NEW."status" = 'DRAFT')
    ) THEN
        RAISE EXCEPTION 'AOS_RISK_POLICY_INVALID_TRANSITION: % -> %', OLD."status", NEW."status"
            USING ERRCODE = '23514';
    END IF;

    IF NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" AND NOT (
        (OLD."status" = 'APPROVED' AND NEW."status" = 'SCHEDULED')
        OR (OLD."status" = 'SCHEDULED' AND NEW."status" = 'APPROVED' AND NEW."effectiveFrom" IS NULL)
    ) THEN
        RAISE EXCEPTION 'AOS_RISK_POLICY_EFFECTIVE_FROM_IMMUTABLE'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'SCHEDULED' THEN
        IF NEW."effectiveFrom" IS NULL
           OR NEW."effectiveFrom" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
            RAISE EXCEPTION 'AOS_RISK_POLICY_SCHEDULE_INVALID: effectiveFrom must be in the future'
                USING ERRCODE = '23514';
        END IF;

        effective_kst := NEW."effectiveFrom" + INTERVAL '9 hours';
        IF EXTRACT(ISODOW FROM effective_kst) NOT BETWEEN 1 AND 5
           OR effective_kst::time <= TIME '15:30:00' THEN
            RAISE EXCEPTION 'AOS_RISK_POLICY_SCHEDULE_INVALID: effectiveFrom must be after KRX close on a weekday'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."status" = 'APPROVED' AND NEW."effectiveFrom" IS NOT NULL THEN
        RAISE EXCEPTION 'AOS_RISK_POLICY_SCHEDULE_INVALID: APPROVED policy cannot retain effectiveFrom'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ACTIVE' THEN
        IF NEW."effectiveFrom" IS NULL
           OR NEW."effectiveFrom" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
            RAISE EXCEPTION 'AOS_RISK_POLICY_ACTIVATION_TOO_EARLY'
                USING ERRCODE = '23514';
        END IF;

        current_kst := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul';
        IF EXTRACT(ISODOW FROM current_kst) NOT BETWEEN 1 AND 5
           OR current_kst::time <= TIME '15:30:00' THEN
            RAISE EXCEPTION 'AOS_RISK_POLICY_ACTIVATION_WINDOW_CLOSED'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."status" IN ('SUPERSEDED', 'ROLLED_BACK', 'RETIRED')
       AND NEW."retiredAt" IS NULL THEN
        RAISE EXCEPTION 'AOS_RISK_POLICY_RETIREMENT_TIMESTAMP_REQUIRED'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_risk_policy_version_insert_guard"
BEFORE INSERT ON "aos_risk_policy_versions"
FOR EACH ROW EXECUTE FUNCTION "aos_guard_risk_policy_version_insert"();

CREATE TRIGGER "aos_risk_policy_version_mutation_guard"
BEFORE UPDATE OR DELETE ON "aos_risk_policy_versions"
FOR EACH ROW EXECUTE FUNCTION "aos_guard_risk_policy_version_mutation"();
