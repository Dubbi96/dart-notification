-- AOS Phase A3-2 / Issue #564: point-in-time FeatureSnapshot 기반.
--
-- 비파괴:
--   * 기존 TradingSignal/Backtest/Paper/Order 테이블과 데이터는 변경하지 않는다.
--   * 과거 데이터는 소급 적재하지 않고 feature flag ON 이후 입력만 기록한다.
--   * 운영 반영(prisma migrate deploy)은 사용자 승인 전 실행하지 않는다.
--
-- 안전 불변식:
--   * 국내 주식(KR_STOCK)만 허용한다.
--   * 동일 대상+시점+schema+content는 멱등이다.
--   * 입력 스냅샷은 UPDATE/DELETE/TRUNCATE할 수 없는 append-only 원장이다.

CREATE TABLE "aos_feature_snapshots" (
    "id" TEXT NOT NULL,
    "instrumentType" TEXT NOT NULL DEFAULT 'KR_STOCK',
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "marketSessionDate" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "featuresJson" JSONB NOT NULL,
    "sourceRefsJson" JSONB NOT NULL,
    "qualityJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aos_feature_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aos_feature_snapshots_instrument_check"
        CHECK ("instrumentType" = 'KR_STOCK'),
    CONSTRAINT "aos_feature_snapshots_corp_code_check"
        CHECK ("corpCode" ~ '^[0-9]{8}$'),
    CONSTRAINT "aos_feature_snapshots_stock_code_check"
        CHECK ("stockCode" ~ '^[0-9]{6}$'),
    CONSTRAINT "aos_feature_snapshots_session_date_check"
        CHECK (
            "marketSessionDate" ~ '^[0-9]{8}$'
            AND to_char(to_date("marketSessionDate", 'YYYYMMDD'), 'YYYYMMDD') = "marketSessionDate"
        ),
    CONSTRAINT "aos_feature_snapshots_schema_version_check"
        CHECK ("schemaVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    CONSTRAINT "aos_feature_snapshots_features_object_check"
        CHECK (jsonb_typeof("featuresJson") = 'object'),
    CONSTRAINT "aos_feature_snapshots_source_refs_object_check"
        CHECK (jsonb_typeof("sourceRefsJson") = 'object'),
    CONSTRAINT "aos_feature_snapshots_quality_shape_check"
        CHECK (
            jsonb_typeof("qualityJson") = 'object'
            AND "qualityJson" ?& ARRAY[
                'missingFeatureKeys',
                'staleFeatureKeys',
                'validationErrors'
            ]
            AND jsonb_typeof("qualityJson"->'missingFeatureKeys') = 'array'
            AND jsonb_typeof("qualityJson"->'staleFeatureKeys') = 'array'
            AND jsonb_typeof("qualityJson"->'validationErrors') = 'array'
        ),
    CONSTRAINT "aos_feature_snapshots_content_hash_check"
        CHECK ("contentHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "aos_feature_snapshots_idempotency_key"
    ON "aos_feature_snapshots"(
        "instrumentType",
        "corpCode",
        "stockCode",
        "asOf",
        "schemaVersion",
        "contentHash"
    );
CREATE INDEX "aos_feature_snapshots_stockCode_asOf_idx"
    ON "aos_feature_snapshots"("stockCode", "asOf");
CREATE INDEX "aos_feature_snapshots_corpCode_asOf_idx"
    ON "aos_feature_snapshots"("corpCode", "asOf");
CREATE INDEX "aos_feature_snapshots_marketSessionDate_idx"
    ON "aos_feature_snapshots"("marketSessionDate");
CREATE INDEX "aos_feature_snapshots_contentHash_idx"
    ON "aos_feature_snapshots"("contentHash");

CREATE OR REPLACE FUNCTION "aos_reject_feature_snapshot_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AOS_FEATURE_SNAPSHOT_APPEND_ONLY: % on % is forbidden',
        TG_OP, TG_TABLE_NAME
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aos_feature_snapshots_append_only_guard"
BEFORE UPDATE OR DELETE ON "aos_feature_snapshots"
FOR EACH ROW EXECUTE FUNCTION "aos_reject_feature_snapshot_mutation"();

CREATE TRIGGER "aos_feature_snapshots_truncate_guard"
BEFORE TRUNCATE ON "aos_feature_snapshots"
FOR EACH STATEMENT EXECUTE FUNCTION "aos_reject_feature_snapshot_mutation"();
