-- M6-A: TradingSignal 모델 + SignalGrade enum (DAR-10)
-- 자연키 FK: rcpNo → disclosures.rcpNo, corpCode → companies.corpCode

-- CreateEnum
CREATE TYPE "SignalGrade" AS ENUM ('STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE', 'WATCH', 'NEUTRAL', 'AVOID', 'BLOCKED');

-- CreateTable
CREATE TABLE "trading_signals" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "subCategory" TEXT,
    "persona" TEXT NOT NULL,
    "buyScore" INTEGER NOT NULL,
    "signal" "SignalGrade" NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "riskPenalty" INTEGER NOT NULL,
    "entryConditionMet" TEXT[],
    "entryConditionUnmet" TEXT[],
    "entryReady" BOOLEAN NOT NULL DEFAULT false,
    "riskFactors" TEXT[],
    "signalSummary" TEXT,
    "blockedReason" TEXT,
    "validUntil" TIMESTAMP(3),
    "isNotified" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trading_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trading_signals_rcpNo_persona_key" ON "trading_signals"("rcpNo", "persona");

-- CreateIndex
CREATE INDEX "trading_signals_corpCode_idx" ON "trading_signals"("corpCode");

-- CreateIndex
CREATE INDEX "trading_signals_stockCode_idx" ON "trading_signals"("stockCode");

-- CreateIndex
CREATE INDEX "trading_signals_signal_idx" ON "trading_signals"("signal");

-- CreateIndex
CREATE INDEX "trading_signals_rcpNo_idx" ON "trading_signals"("rcpNo");

-- CreateIndex
CREATE INDEX "trading_signals_createdAt_idx" ON "trading_signals"("createdAt");

-- CreateIndex
CREATE INDEX "trading_signals_persona_idx" ON "trading_signals"("persona");

-- CreateIndex
CREATE INDEX "trading_signals_entryReady_idx" ON "trading_signals"("entryReady");

-- AddForeignKey
ALTER TABLE "trading_signals" ADD CONSTRAINT "trading_signals_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_signals" ADD CONSTRAINT "trading_signals_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
