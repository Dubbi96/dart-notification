-- DAR-378: TimescaleDB 도입 — 분봉 하이퍼테이블·압축·연속집계·보존정책 (대규모 시계열 효율화)
-- ★A(일봉)·B(분봉) 데이터 축적이 이 기반 위에 적재되도록 선행하는 저장 엔진 마이그레이션이다.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다.
--    에이전트 자동 적용 금지. TimescaleDB 이미지 교체·확장 활성화도 사용자 적용 단계다
--    (docker-compose.dev.yml 이 timescale/timescaledb 이미지를 사용해야 CREATE EXTENSION 성공).
--    node_modules add 금지.
--
-- 비파괴(순수 가산): 신규 stock_minute_prices 테이블 + 확장 + 정책만 추가한다.
--    기존 테이블/데이터(stock_daily_prices 등)는 건드리지 않는다 — 데이터 손실 0.
--    일봉(stock_daily_prices)의 하이퍼테이블 전환은 규모가 작아 후순위이며, 기존 cuid PK 를
--    파티션 컬럼 포함 PK 로 바꾸는 파괴적 변경이 필요하므로 본 마이그레이션에서 제외한다(별도 후속).

-- ────────────────────────────────────────────────────────────────────────────
-- 0) TimescaleDB 확장 활성화 (이미지가 timescaledb 일 때만 성공 — 휴먼 적용 게이트)
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) 분봉 테이블 (Prisma 모델 StockMinutePrice 와 1:1) — 파티션 키 ts 포함 복합 PK
-- ────────────────────────────────────────────────────────────────────────────
-- CreateTable
CREATE TABLE "stock_minute_prices" (
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "openPrice" INTEGER NOT NULL,
    "highPrice" INTEGER NOT NULL,
    "lowPrice" INTEGER NOT NULL,
    "closePrice" INTEGER NOT NULL,
    "volume" BIGINT NOT NULL,
    "tradingValue" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'KIS_REALTIME',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_minute_prices_pkey" PRIMARY KEY ("stockCode", "ts")
);

-- CreateIndex
CREATE INDEX "stock_minute_prices_corpCode_idx" ON "stock_minute_prices"("corpCode");

-- CreateIndex
CREATE INDEX "stock_minute_prices_ts_idx" ON "stock_minute_prices"("ts");

-- AddForeignKey (자연키 corpCode → companies, prisma CLAUDE.md 자연키 정합)
ALTER TABLE "stock_minute_prices" ADD CONSTRAINT "stock_minute_prices_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) 하이퍼테이블 변환 — 파티션 키 ts, chunk 7일
-- ────────────────────────────────────────────────────────────────────────────
SELECT create_hypertable(
    'stock_minute_prices',
    'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) 압축 (핵심 용량 절감) — chunk 7일 경과 시 columnar 압축
--    금융 OHLCV 는 종목별 시계열 정렬이 강해 ~90~95% 절감 기대.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE "stock_minute_prices" SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"stockCode"',
    timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('stock_minute_prices', INTERVAL '7 days');

-- ────────────────────────────────────────────────────────────────────────────
-- 4) 연속집계 (응답 효율) — 분봉 → 5분/15분/일봉 롤업(materialized)
--    차트·분석 쿼리가 원본 분봉 풀스캔 없이 집계 뷰를 조회한다.
--    OHLCV 규칙: open=first(ts), high=max, low=min, close=last(ts), volume=sum.
-- ────────────────────────────────────────────────────────────────────────────

-- 4-1) 5분봉
CREATE MATERIALIZED VIEW "stock_candles_5m"
WITH (timescaledb.continuous) AS
SELECT
    "stockCode",
    "corpCode",
    time_bucket(INTERVAL '5 minutes', "ts") AS "bucket",
    first("openPrice", "ts")  AS "openPrice",
    max("highPrice")          AS "highPrice",
    min("lowPrice")           AS "lowPrice",
    last("closePrice", "ts")  AS "closePrice",
    sum("volume")             AS "volume",
    sum("tradingValue")       AS "tradingValue"
FROM "stock_minute_prices"
GROUP BY "stockCode", "corpCode", "bucket"
WITH NO DATA;

SELECT add_continuous_aggregate_policy('stock_candles_5m',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes');

-- 4-2) 15분봉
CREATE MATERIALIZED VIEW "stock_candles_15m"
WITH (timescaledb.continuous) AS
SELECT
    "stockCode",
    "corpCode",
    time_bucket(INTERVAL '15 minutes', "ts") AS "bucket",
    first("openPrice", "ts")  AS "openPrice",
    max("highPrice")          AS "highPrice",
    min("lowPrice")           AS "lowPrice",
    last("closePrice", "ts")  AS "closePrice",
    sum("volume")             AS "volume",
    sum("tradingValue")       AS "tradingValue"
FROM "stock_minute_prices"
GROUP BY "stockCode", "corpCode", "bucket"
WITH NO DATA;

SELECT add_continuous_aggregate_policy('stock_candles_15m',
    start_offset      => INTERVAL '7 days',
    end_offset        => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes');

-- 4-3) 일봉(분봉 롤업) — EventStudy·차트 일봉 분석에 활용
CREATE MATERIALIZED VIEW "stock_candles_1d"
WITH (timescaledb.continuous) AS
SELECT
    "stockCode",
    "corpCode",
    time_bucket(INTERVAL '1 day', "ts") AS "bucket",
    first("openPrice", "ts")  AS "openPrice",
    max("highPrice")          AS "highPrice",
    min("lowPrice")           AS "lowPrice",
    last("closePrice", "ts")  AS "closePrice",
    sum("volume")             AS "volume",
    sum("tradingValue")       AS "tradingValue"
FROM "stock_minute_prices"
GROUP BY "stockCode", "corpCode", "bucket"
WITH NO DATA;

SELECT add_continuous_aggregate_policy('stock_candles_1d',
    start_offset      => INTERVAL '30 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

-- ────────────────────────────────────────────────────────────────────────────
-- 5) 보존정책 (확장 대비) — 원본 분봉은 기본 길게 보존(무기한에 가깝게).
--    오래된 원본은 연속집계 롤업으로 대체 가능하다. 운영에서 용량 압박 시 INTERVAL 을
--    줄여 튜닝한다(예: '1 year'). 기본은 보존 우선이므로 길게(5년) 설정한다.
-- ────────────────────────────────────────────────────────────────────────────
SELECT add_retention_policy('stock_minute_prices', INTERVAL '5 years');
