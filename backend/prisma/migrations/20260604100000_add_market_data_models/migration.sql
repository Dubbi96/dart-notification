-- CreateTable
CREATE TABLE "stock_daily_prices" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "openPrice" INTEGER NOT NULL,
    "highPrice" INTEGER NOT NULL,
    "lowPrice" INTEGER NOT NULL,
    "closePrice" INTEGER NOT NULL,
    "volume" BIGINT NOT NULL,
    "tradingValue" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_daily_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_indicators" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "ma5" DOUBLE PRECISION,
    "ma20" DOUBLE PRECISION,
    "ma60" DOUBLE PRECISION,
    "ma120" DOUBLE PRECISION,
    "rsi14" DOUBLE PRECISION,
    "macdLine" DOUBLE PRECISION,
    "macdSignal" DOUBLE PRECISION,
    "macdHistogram" DOUBLE PRECISION,
    "bollingerUpper" DOUBLE PRECISION,
    "bollingerMid" DOUBLE PRECISION,
    "bollingerLower" DOUBLE PRECISION,
    "atr14" DOUBLE PRECISION,
    "vwap" DOUBLE PRECISION,
    "volumeRatio20" DOUBLE PRECISION,
    "high52w" INTEGER,
    "low52w" INTEGER,
    "preDsclReturn" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "technical_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_indices" (
    "id" TEXT NOT NULL,
    "indexCode" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "openIndex" DOUBLE PRECISION NOT NULL,
    "highIndex" DOUBLE PRECISION NOT NULL,
    "lowIndex" DOUBLE PRECISION NOT NULL,
    "closeIndex" DOUBLE PRECISION NOT NULL,
    "volume" BIGINT,
    "tradingValue" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "market_indices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_daily_prices_stockCode_tradeDate_key" ON "stock_daily_prices"("stockCode", "tradeDate");
CREATE INDEX "stock_daily_prices_corpCode_idx" ON "stock_daily_prices"("corpCode");
CREATE INDEX "stock_daily_prices_tradeDate_idx" ON "stock_daily_prices"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "technical_indicators_stockCode_tradeDate_key" ON "technical_indicators"("stockCode", "tradeDate");
CREATE INDEX "technical_indicators_corpCode_idx" ON "technical_indicators"("corpCode");
CREATE INDEX "technical_indicators_tradeDate_idx" ON "technical_indicators"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "market_indices_indexCode_tradeDate_key" ON "market_indices"("indexCode", "tradeDate");
CREATE INDEX "market_indices_tradeDate_idx" ON "market_indices"("tradeDate");

-- AddForeignKey
ALTER TABLE "stock_daily_prices" ADD CONSTRAINT "stock_daily_prices_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_indicators" ADD CONSTRAINT "technical_indicators_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
