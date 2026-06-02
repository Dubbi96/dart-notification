-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SUPPLY_CONTRACT', 'SHARE_BUYBACK', 'SHARE_CANCELLATION', 'DIVIDEND_INCREASE', 'PAID_IN_CAPITAL_INCREASE', 'CB_ISSUANCE', 'BW_ISSUANCE', 'CONTRACT_CANCELLATION', 'DIVIDEND_CUT', 'THIRD_PARTY_ALLOTMENT', 'EARNINGS_SURPRISE', 'EARNINGS_SHOCK', 'MAJOR_SHAREHOLDER_CHANGE', 'LAWSUIT', 'AUDIT_OPINION_RISK', 'TRADING_SUSPENSION', 'DELISTING_RISK', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "disclosure_events" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "extractedData" JSONB NOT NULL DEFAULT '{}',
    "polarity" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isAiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "failReason" TEXT,
    "isAmendment" BOOLEAN NOT NULL DEFAULT false,
    "originalRcpNo" TEXT,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disclosure_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disclosure_events_rcpNo_key" ON "disclosure_events"("rcpNo");

-- CreateIndex
CREATE INDEX "disclosure_events_corpCode_idx" ON "disclosure_events"("corpCode");

-- CreateIndex
CREATE INDEX "disclosure_events_eventType_idx" ON "disclosure_events"("eventType");

-- CreateIndex
CREATE INDEX "disclosure_events_polarity_idx" ON "disclosure_events"("polarity");

-- CreateIndex
CREATE INDEX "disclosure_events_extractionStatus_idx" ON "disclosure_events"("extractionStatus");

-- CreateIndex
CREATE INDEX "disclosure_events_extractedAt_idx" ON "disclosure_events"("extractedAt");

-- CreateIndex
CREATE INDEX "disclosure_events_isAmendment_idx" ON "disclosure_events"("isAmendment");

-- AddForeignKey
ALTER TABLE "disclosure_events" ADD CONSTRAINT "disclosure_events_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disclosure_events" ADD CONSTRAINT "disclosure_events_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
