-- CreateEnum
CREATE TYPE "ThesisStatus" AS ENUM ('ACTIVE', 'INVALIDATED', 'CLOSED');

-- CreateTable
CREATE TABLE "position_theses" (
    "id" TEXT NOT NULL,
    "tradingSignalId" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "entryReason" TEXT NOT NULL,
    "initialThesis" JSONB NOT NULL,
    "invalidConditions" JSONB NOT NULL,
    "exitRules" JSONB NOT NULL,
    "maxWeight" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "status" "ThesisStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_theses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "position_theses_tradingSignalId_key" ON "position_theses"("tradingSignalId");

-- CreateIndex
CREATE INDEX "position_theses_corpCode_idx" ON "position_theses"("corpCode");

-- CreateIndex
CREATE INDEX "position_theses_rcpNo_idx" ON "position_theses"("rcpNo");

-- CreateIndex
CREATE INDEX "position_theses_status_idx" ON "position_theses"("status");

-- CreateIndex
CREATE INDEX "position_theses_createdAt_idx" ON "position_theses"("createdAt");

-- AddForeignKey
ALTER TABLE "position_theses" ADD CONSTRAINT "position_theses_tradingSignalId_fkey" FOREIGN KEY ("tradingSignalId") REFERENCES "trading_signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_theses" ADD CONSTRAINT "position_theses_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_theses" ADD CONSTRAINT "position_theses_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
