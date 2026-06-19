-- DAR-377: 분봉 저장 인프라 신규 (StockMinutePrice) — 장중 공시반응(분봉) 분석 기반.
-- ★KIS 는 '당일 분봉'만 제공(과거 분봉 미제공) → 과거 소급 백필 불가. 수집 시작일부터 forward 누적.
-- 대용량(전 종목 × ~390분/일 ≈ 일 150만 행) 대비: (stockCode, tradeDate) 복합 인덱스로 조회를 받치고,
--   tradeDate 단일 인덱스로 향후 보존정책(파티셔닝/아카이브) 운영을 받친다.
-- 멱등: @@unique([stockCode, tradeDate, time]) — 재적재해도 누락 분만 신규 삽입(ON CONFLICT DO NOTHING).
-- 비파괴적 신규 테이블 생성. 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행.

-- CreateTable
CREATE TABLE "stock_minute_prices" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "openPrice" INTEGER NOT NULL,
    "highPrice" INTEGER NOT NULL,
    "lowPrice" INTEGER NOT NULL,
    "closePrice" INTEGER NOT NULL,
    "volume" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_minute_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_minute_prices_stockCode_tradeDate_idx" ON "stock_minute_prices"("stockCode", "tradeDate");

-- CreateIndex
CREATE INDEX "stock_minute_prices_corpCode_idx" ON "stock_minute_prices"("corpCode");

-- CreateIndex
CREATE INDEX "stock_minute_prices_tradeDate_idx" ON "stock_minute_prices"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_minute_prices_stockCode_tradeDate_time_key" ON "stock_minute_prices"("stockCode", "tradeDate", "time");

-- AddForeignKey
ALTER TABLE "stock_minute_prices" ADD CONSTRAINT "stock_minute_prices_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
