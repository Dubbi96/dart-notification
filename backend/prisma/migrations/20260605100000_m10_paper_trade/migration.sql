-- M10 — PaperTrade 모의투자 체결 모델 (DAR-16)
-- AI 금지영역: 체결·Risk 로직 순수 Rule

CREATE TYPE "PaperTradeStatus" AS ENUM ('PENDING', 'FILLED', 'PARTIAL', 'CANCELLED', 'REJECTED');
CREATE TYPE "PaperTradeDirection" AS ENUM ('BUY', 'SELL');

CREATE TABLE "paper_trades" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "direction" "PaperTradeDirection" NOT NULL,
    "orderedShares" INTEGER NOT NULL,
    "filledShares" INTEGER NOT NULL DEFAULT 0,
    "fillRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "entryPrice" DECIMAL(12,2) NOT NULL,
    "filledPrice" DECIMAL(12,2),
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "slippage" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossPnl" DECIMAL(12,2),
    "netPnl" DECIMAL(12,2),
    "returnPct" DECIMAL(8,4),
    "status" "PaperTradeStatus" NOT NULL DEFAULT 'PENDING',
    "entryDate" TIMESTAMP(3) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "tradingSignalId" TEXT,
    "positionThesisId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_trades_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "paper_trades_corpCode_idx" ON "paper_trades"("corpCode");
CREATE INDEX "paper_trades_stockCode_idx" ON "paper_trades"("stockCode");
CREATE INDEX "paper_trades_status_idx" ON "paper_trades"("status");
CREATE INDEX "paper_trades_entryDate_idx" ON "paper_trades"("entryDate");
CREATE INDEX "paper_trades_tradingSignalId_idx" ON "paper_trades"("tradingSignalId");
CREATE INDEX "paper_trades_positionThesisId_idx" ON "paper_trades"("positionThesisId");

ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_tradingSignalId_fkey" FOREIGN KEY ("tradingSignalId") REFERENCES "trading_signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_positionThesisId_fkey" FOREIGN KEY ("positionThesisId") REFERENCES "position_theses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
