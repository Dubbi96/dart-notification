-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('TAKE_PROFIT', 'STOP_LOSS', 'TRAILING_STOP', 'THESIS_BREAK', 'MAX_HOLD_DAYS', 'CHART_BREAK', 'LIQUIDITY_EXIT', 'FORCE_EXIT');

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "strategyParams" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "universe" TEXT NOT NULL,
    "commissionRate" DECIMAL(6,5) NOT NULL,
    "taxRate" DECIMAL(6,5) NOT NULL,
    "slippagePct" DECIMAL(6,5) NOT NULL,
    "status" "BacktestStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_trades" (
    "id" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "disclosureRcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "disclosureAt" TIMESTAMP(3) NOT NULL,
    "isAfterMarket" BOOLEAN NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "entryPrice" DECIMAL(12,2) NOT NULL,
    "entryShares" INTEGER NOT NULL,
    "entryValue" DECIMAL(16,2) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "exitPrice" DECIMAL(12,2),
    "exitShares" INTEGER,
    "exitValue" DECIMAL(16,2),
    "exitReason" "ExitReason",
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "slippage" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossPnl" DECIMAL(12,2),
    "netPnl" DECIMAL(12,2),
    "returnPct" DECIMAL(8,4),
    "holdDays" INTEGER,
    "wasLimitUp" BOOLEAN NOT NULL DEFAULT false,
    "wasLimitDown" BOOLEAN NOT NULL DEFAULT false,
    "wasTradingSuspended" BOOLEAN NOT NULL DEFAULT false,
    "wasAdminStock" BOOLEAN NOT NULL DEFAULT false,
    "isPartialFill" BOOLEAN NOT NULL DEFAULT false,
    "fillRate" DECIMAL(5,4),
    "lowLiquidityFlag" BOOLEAN NOT NULL DEFAULT false,
    "buyScoreSnapshot" INTEGER,
    "exitScoreSnapshot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backtest_runs_status_idx" ON "backtest_runs"("status");

-- CreateIndex
CREATE INDEX "backtest_runs_startDate_endDate_idx" ON "backtest_runs"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "backtest_trades_backtestRunId_idx" ON "backtest_trades"("backtestRunId");

-- CreateIndex
CREATE INDEX "backtest_trades_corpCode_idx" ON "backtest_trades"("corpCode");

-- CreateIndex
CREATE INDEX "backtest_trades_eventType_idx" ON "backtest_trades"("eventType");

-- CreateIndex
CREATE INDEX "backtest_trades_persona_idx" ON "backtest_trades"("persona");

-- CreateIndex
CREATE INDEX "backtest_trades_entryDate_idx" ON "backtest_trades"("entryDate");

-- CreateIndex
CREATE INDEX "backtest_trades_returnPct_idx" ON "backtest_trades"("returnPct");

-- AddForeignKey
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
