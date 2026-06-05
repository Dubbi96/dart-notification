-- CreateTable
CREATE TABLE "stock_statuses" (
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "isTradingSuspended" BOOLEAN NOT NULL DEFAULT false,
    "isManagement" BOOLEAN NOT NULL DEFAULT false,
    "isInvestmentCaution" BOOLEAN NOT NULL DEFAULT false,
    "isAbnormalSurge" BOOLEAN NOT NULL DEFAULT false,
    "statusNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_statuses_pkey" PRIMARY KEY ("stockCode")
);

-- CreateIndex
CREATE INDEX "stock_statuses_tradeDate_idx" ON "stock_statuses"("tradeDate");

-- CreateTable
CREATE TABLE "market_data_collection_logs" (
    "id" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "indexSaved" BOOLEAN NOT NULL DEFAULT false,
    "statusSaved" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "market_data_collection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_data_collection_logs_tradeDate_idx" ON "market_data_collection_logs"("tradeDate");

-- CreateIndex
CREATE INDEX "market_data_collection_logs_status_idx" ON "market_data_collection_logs"("status");
