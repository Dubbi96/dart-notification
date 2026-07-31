-- AOS Phase A2-2 / Issue #555: 종가 후 Strategy Version 활성화 원장과 불변식.
--
-- 비파괴(순수 가산/강화):
--   * VersionActivation enum·테이블을 추가한다.
--   * 기존 StrategyVersion 데이터는 수정하지 않는다.
--   * 기존 mutation guard를 동일 전이 행렬 + 활성화 시간/효력시각 불변식으로 교체한다.
--   * 운영 반영(prisma migrate deploy)은 사용자 승인 전 실행하지 않는다.

-- CreateEnum
CREATE TYPE "VersionActivationStatus" AS ENUM (
    'SCHEDULED',
    'ACTIVE',
    'CANCELLED',
    'ROLLED_BACK'
);

-- CreateTable
CREATE TABLE "aos_version_activations" (
    "id" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "status" "VersionActivationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "requestedByUserId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aos_version_activations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_version_activations_correlation_id_check"
        CHECK (length("correlationId") BETWEEN 1 AND 160 AND btrim("correlationId") = "correlationId"),
    -- Prisma DateTime은 UTC timestamp로 저장한다. +09:00 후 KST 평일·정규장 종가 이후인지
    -- 최소 DB 방어를 둔다. KRX 공휴일·지연개장 정확 판정은 application calendar가 재검증한다.
    CONSTRAINT "aos_version_activations_weekday_check"
        CHECK (EXTRACT(ISODOW FROM ("scheduledFor" + INTERVAL '9 hours')) BETWEEN 1 AND 5),
    CONSTRAINT "aos_version_activations_after_close_check"
        CHECK (("scheduledFor" + INTERVAL '9 hours')::time > TIME '15:30:00')
);

-- CreateIndex
CREATE UNIQUE INDEX "aos_version_activations_correlationId_key"
    ON "aos_version_activations"("correlationId");
CREATE INDEX "aos_version_activations_status_scheduledFor_idx"
    ON "aos_version_activations"("status", "scheduledFor");
CREATE INDEX "aos_version_activations_strategyVersionId_createdAt_idx"
    ON "aos_version_activations"("strategyVersionId", "createdAt");

-- Prisma schema가 표현하지 못하는 partial unique indexes.
-- 1) 하나의 전략에는 현재 ACTIVE StrategyVersion이 최대 하나다.
-- 2) 하나의 버전에는 종료되지 않은 ACTIVE activation 원장이 최대 하나다.
CREATE UNIQUE INDEX "aos_strategy_versions_one_active_per_strategy"
    ON "aos_strategy_versions"("strategyId")
    WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "aos_version_activations_one_open_active_per_version"
    ON "aos_version_activations"("strategyVersionId")
    WHERE "status" = 'ACTIVE' AND "deactivatedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "aos_version_activations"
    ADD CONSTRAINT "aos_version_activations_strategyVersionId_fkey"
    FOREIGN KEY ("strategyVersionId") REFERENCES "aos_strategy_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "aos_version_activations"
    ADD CONSTRAINT "aos_version_activations_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 기존 Issue #551 guard를 상태 전이 의미는 유지한 채 효력시각·실제 활성화 경계로 강화한다.
CREATE OR REPLACE FUNCTION "aos_guard_strategy_version_mutation"()
RETURNS TRIGGER AS $$
DECLARE
    current_kst TIMESTAMP;
    effective_kst TIMESTAMP;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_IMMUTABLE: non-DRAFT version cannot be deleted'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD."status" <> 'DRAFT' AND (
        NEW."strategyId" IS DISTINCT FROM OLD."strategyId"
        OR NEW."version" IS DISTINCT FROM OLD."version"
        OR NEW."configJson" IS DISTINCT FROM OLD."configJson"
        OR NEW."configHash" IS DISTINCT FROM OLD."configHash"
        OR NEW."parentVersionId" IS DISTINCT FROM OLD."parentVersionId"
    ) THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_IMMUTABLE: non-DRAFT configuration cannot be changed'
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
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_INVALID_TRANSITION: % -> %', OLD."status", NEW."status"
            USING ERRCODE = '23514';
    END IF;

    -- effectiveFrom 변경은 APPROVED->SCHEDULED 설정 또는 SCHEDULED->APPROVED 취소에서만 허용한다.
    IF NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" AND NOT (
        (OLD."status" = 'APPROVED' AND NEW."status" = 'SCHEDULED')
        OR (OLD."status" = 'SCHEDULED' AND NEW."status" = 'APPROVED' AND NEW."effectiveFrom" IS NULL)
    ) THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_EFFECTIVE_FROM_IMMUTABLE'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'SCHEDULED' THEN
        IF NEW."effectiveFrom" IS NULL
           OR NEW."effectiveFrom" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_SCHEDULE_INVALID: effectiveFrom must be in the future'
                USING ERRCODE = '23514';
        END IF;

        effective_kst := NEW."effectiveFrom" + INTERVAL '9 hours';
        IF EXTRACT(ISODOW FROM effective_kst) NOT BETWEEN 1 AND 5
           OR effective_kst::time <= TIME '15:30:00' THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_SCHEDULE_INVALID: effectiveFrom must be after KRX close on a weekday'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."status" = 'APPROVED' AND NEW."effectiveFrom" IS NOT NULL THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_SCHEDULE_INVALID: APPROVED version cannot retain effectiveFrom'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ACTIVE' THEN
        IF NEW."effectiveFrom" IS NULL
           OR NEW."effectiveFrom" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_ACTIVATION_TOO_EARLY'
                USING ERRCODE = '23514';
        END IF;

        current_kst := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul';
        IF EXTRACT(ISODOW FROM current_kst) NOT BETWEEN 1 AND 5
           OR current_kst::time <= TIME '15:30:00' THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_ACTIVATION_WINDOW_CLOSED'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."status" IN ('SUPERSEDED', 'ROLLED_BACK', 'RETIRED')
       AND NEW."retiredAt" IS NULL THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_RETIREMENT_TIMESTAMP_REQUIRED'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- VersionActivation은 append-only identity를 유지하고 허용된 lifecycle만 기록한다.
CREATE OR REPLACE FUNCTION "aos_guard_version_activation_mutation"()
RETURNS TRIGGER AS $$
DECLARE
    version_status "StrategyVersionStatus";
    version_effective TIMESTAMP;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_APPEND_ONLY: activation records cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW."strategyVersionId" IS DISTINCT FROM OLD."strategyVersionId"
        OR NEW."scheduledFor" IS DISTINCT FROM OLD."scheduledFor"
        OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
    ) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_IMMUTABLE: activation identity cannot be changed'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW."status" IS DISTINCT FROM OLD."status"
       AND NOT (
           (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
           OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'ROLLED_BACK')
       ) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_INVALID_TRANSITION: % -> %', OLD."status", NEW."status"
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'SCHEDULED'
       AND (NEW."activatedAt" IS NOT NULL OR NEW."deactivatedAt" IS NOT NULL) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_INVALID_TIMESTAMPS: SCHEDULED must be untouched'
            USING ERRCODE = '23514';
    END IF;

    SELECT "status", "effectiveFrom"
      INTO version_status, version_effective
      FROM "aos_strategy_versions"
     WHERE "id" = NEW."strategyVersionId";

    IF version_status IS NULL THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_VERSION_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    IF NEW."status" = 'SCHEDULED' AND (
        version_status <> 'SCHEDULED'
        OR version_effective IS DISTINCT FROM NEW."scheduledFor"
    ) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_SCHEDULE_MISMATCH'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ACTIVE' AND (
        NEW."activatedAt" IS NULL
        OR NEW."activatedAt" < NEW."scheduledFor"
        OR (NEW."deactivatedAt" IS NOT NULL AND NEW."deactivatedAt" < NEW."activatedAt")
    ) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_INVALID_TIMESTAMPS: invalid ACTIVE interval'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ACTIVE'
       AND NEW."deactivatedAt" IS NULL
       AND version_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_ACTIVE_VERSION_MISMATCH'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'CANCELLED' AND (
        NEW."activatedAt" IS NOT NULL OR NEW."deactivatedAt" IS NULL
    ) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_INVALID_TIMESTAMPS: CANCELLED requires cancellation timestamp only'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ROLLED_BACK' AND (
        NEW."activatedAt" IS NULL
        OR NEW."deactivatedAt" IS NULL
        OR NEW."deactivatedAt" < NEW."activatedAt"
    ) THEN
        RAISE EXCEPTION 'AOS_VERSION_ACTIVATION_INVALID_TIMESTAMPS: ROLLED_BACK requires a valid interval'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_version_activation_mutation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "aos_version_activations"
FOR EACH ROW EXECUTE FUNCTION "aos_guard_version_activation_mutation"();
