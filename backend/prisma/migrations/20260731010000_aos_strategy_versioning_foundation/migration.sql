-- AOS Phase A2-1 / Issue #551: 전략·룰 버전 관리 기반.
--
-- 비파괴(순수 가산):
--   * 기존 DART/신호/모의운용 테이블과 데이터는 변경하지 않는다.
--   * 신규 enum 3개와 AOS 전용 테이블 4개만 추가한다.
--   * 운영 반영(prisma migrate deploy)은 사용자 승인 전 실행하지 않는다.
--
-- 안전 불변식:
--   * 국내주식 Long Only, 2~20 거래일 범위를 DB CHECK로 고정한다.
--   * StrategyVersion 설정 본문과 하위 룰은 DRAFT에서만 변경할 수 있다.
--   * DRAFT를 벗어난 버전은 삭제할 수 없다.

-- CreateEnum
CREATE TYPE "StrategyDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "StrategyRuleCategory" AS ENUM ('ENTRY', 'EXIT', 'SIZING', 'REGIME', 'PORTFOLIO', 'RISK');

-- CreateEnum
CREATE TYPE "StrategyVersionStatus" AS ENUM (
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
CREATE TABLE "aos_strategies" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assetClass" TEXT NOT NULL DEFAULT 'KR_STOCK',
    "direction" TEXT NOT NULL DEFAULT 'LONG_ONLY',
    "horizonMinDays" INTEGER NOT NULL DEFAULT 2,
    "horizonMaxDays" INTEGER NOT NULL DEFAULT 20,
    "status" "StrategyDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aos_strategies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_strategies_horizon_check"
        CHECK ("horizonMinDays" >= 2 AND "horizonMinDays" <= "horizonMaxDays" AND "horizonMaxDays" <= 20),
    CONSTRAINT "aos_strategies_asset_class_check" CHECK ("assetClass" = 'KR_STOCK'),
    CONSTRAINT "aos_strategies_direction_check" CHECK ("direction" = 'LONG_ONLY')
);

-- CreateTable
CREATE TABLE "aos_rule_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" "StrategyRuleCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "implementationKey" TEXT NOT NULL,
    "inputSchemaVersion" INTEGER NOT NULL,
    "outputSchemaVersion" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aos_rule_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_rule_definitions_schema_versions_check"
        CHECK ("inputSchemaVersion" > 0 AND "outputSchemaVersion" > 0)
);

-- CreateTable
CREATE TABLE "aos_strategy_versions" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StrategyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "configJson" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "createdByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aos_strategy_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_strategy_versions_version_check" CHECK ("version" > 0),
    CONSTRAINT "aos_strategy_versions_config_hash_check" CHECK (length("configHash") = 64),
    CONSTRAINT "aos_strategy_versions_parent_check" CHECK ("parentVersionId" IS NULL OR "parentVersionId" <> "id")
);

-- CreateTable
CREATE TABLE "aos_strategy_version_rules" (
    "id" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "ruleDefinitionId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" DECIMAL(8,6),
    "parametersJson" JSONB NOT NULL,
    "parameterHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aos_strategy_version_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_strategy_version_rules_priority_check" CHECK ("priority" >= 0),
    CONSTRAINT "aos_strategy_version_rules_weight_check" CHECK ("weight" IS NULL OR ("weight" >= 0 AND "weight" <= 1)),
    CONSTRAINT "aos_strategy_version_rules_parameter_hash_check" CHECK (length("parameterHash") = 64)
);

-- CreateIndex
CREATE UNIQUE INDEX "aos_strategies_key_key" ON "aos_strategies"("key");
CREATE INDEX "aos_strategies_status_idx" ON "aos_strategies"("status");
CREATE INDEX "aos_strategies_assetClass_idx" ON "aos_strategies"("assetClass");

CREATE UNIQUE INDEX "aos_rule_definitions_key_key" ON "aos_rule_definitions"("key");
CREATE INDEX "aos_rule_definitions_category_idx" ON "aos_rule_definitions"("category");
CREATE INDEX "aos_rule_definitions_isActive_idx" ON "aos_rule_definitions"("isActive");

CREATE UNIQUE INDEX "aos_strategy_versions_strategyId_version_key"
    ON "aos_strategy_versions"("strategyId", "version");
CREATE INDEX "aos_strategy_versions_strategyId_configHash_idx"
    ON "aos_strategy_versions"("strategyId", "configHash");
CREATE INDEX "aos_strategy_versions_status_effectiveFrom_idx"
    ON "aos_strategy_versions"("status", "effectiveFrom");
CREATE INDEX "aos_strategy_versions_parentVersionId_idx"
    ON "aos_strategy_versions"("parentVersionId");

CREATE UNIQUE INDEX "aos_version_rules_version_rule_key"
    ON "aos_strategy_version_rules"("strategyVersionId", "ruleDefinitionId");
CREATE INDEX "aos_strategy_version_rules_strategyVersionId_priority_idx"
    ON "aos_strategy_version_rules"("strategyVersionId", "priority");
CREATE INDEX "aos_strategy_version_rules_ruleDefinitionId_idx"
    ON "aos_strategy_version_rules"("ruleDefinitionId");

-- AddForeignKey
ALTER TABLE "aos_strategies"
    ADD CONSTRAINT "aos_strategies_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aos_rule_definitions"
    ADD CONSTRAINT "aos_rule_definitions_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aos_strategy_versions"
    ADD CONSTRAINT "aos_strategy_versions_strategyId_fkey"
    FOREIGN KEY ("strategyId") REFERENCES "aos_strategies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "aos_strategy_versions"
    ADD CONSTRAINT "aos_strategy_versions_parentVersionId_fkey"
    FOREIGN KEY ("parentVersionId") REFERENCES "aos_strategy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aos_strategy_versions"
    ADD CONSTRAINT "aos_strategy_versions_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aos_strategy_version_rules"
    ADD CONSTRAINT "aos_strategy_version_rules_strategyVersionId_fkey"
    FOREIGN KEY ("strategyVersionId") REFERENCES "aos_strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "aos_strategy_version_rules"
    ADD CONSTRAINT "aos_strategy_version_rules_ruleDefinitionId_fkey"
    FOREIGN KEY ("ruleDefinitionId") REFERENCES "aos_rule_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Non-DRAFT StrategyVersion의 설정 정체성과 삭제를 DB 레벨에서 차단한다.
CREATE OR REPLACE FUNCTION "aos_guard_strategy_version_mutation"()
RETURNS TRIGGER AS $$
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

    IF NEW."status" = 'SCHEDULED' AND (
        NEW."effectiveFrom" IS NULL OR NEW."effectiveFrom" <= CURRENT_TIMESTAMP
    ) THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_SCHEDULE_INVALID: effectiveFrom must be in the future'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ACTIVE' AND (
        NEW."effectiveFrom" IS NULL OR NEW."effectiveFrom" > CURRENT_TIMESTAMP
    ) THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_ACTIVATION_TOO_EARLY'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_strategy_version_mutation_guard"
BEFORE UPDATE OR DELETE ON "aos_strategy_versions"
FOR EACH ROW EXECUTE FUNCTION "aos_guard_strategy_version_mutation"();

-- 하위 룰 구성도 부모 버전이 DRAFT일 때만 변경할 수 있다.
CREATE OR REPLACE FUNCTION "aos_guard_strategy_version_rule_mutation"()
RETURNS TRIGGER AS $$
DECLARE
    current_status "StrategyVersionStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT "status" INTO current_status
          FROM "aos_strategy_versions"
         WHERE "id" = OLD."strategyVersionId";

        -- 부모 DRAFT 삭제의 CASCADE 경로에서는 부모가 이미 보이지 않을 수 있으므로 허용한다.
        IF current_status IS NOT NULL AND current_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_IMMUTABLE: rules of non-DRAFT version cannot be deleted'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW."strategyVersionId" IS DISTINCT FROM OLD."strategyVersionId" THEN
        SELECT "status" INTO current_status
          FROM "aos_strategy_versions"
         WHERE "id" = OLD."strategyVersionId";
        IF current_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'AOS_STRATEGY_VERSION_IMMUTABLE: rule cannot be moved from a non-DRAFT version'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT "status" INTO current_status
      FROM "aos_strategy_versions"
     WHERE "id" = NEW."strategyVersionId";

    IF current_status IS DISTINCT FROM 'DRAFT'::"StrategyVersionStatus" THEN
        RAISE EXCEPTION 'AOS_STRATEGY_VERSION_IMMUTABLE: rules can be changed only in DRAFT'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_strategy_version_rule_mutation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "aos_strategy_version_rules"
FOR EACH ROW EXECUTE FUNCTION "aos_guard_strategy_version_rule_mutation"();
