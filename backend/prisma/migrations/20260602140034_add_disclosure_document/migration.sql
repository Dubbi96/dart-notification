-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'FETCHING', 'FETCH_FAILED', 'PARSING', 'PARSE_FAILED', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "disclosure_documents" (
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "rawFilePath" TEXT,
    "attachmentPaths" TEXT[],
    "rawText" TEXT,
    "tables" JSONB,
    "parsedJson" JSONB,
    "wordCount" INTEGER,
    "isAmendment" BOOLEAN NOT NULL DEFAULT false,
    "originalRcpNo" TEXT,
    "amendmentDiff" JSONB,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "fetchedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disclosure_documents_pkey" PRIMARY KEY ("rcpNo")
);

-- CreateIndex
CREATE INDEX "disclosure_documents_corpCode_idx" ON "disclosure_documents"("corpCode");

-- CreateIndex
CREATE INDEX "disclosure_documents_parseStatus_idx" ON "disclosure_documents"("parseStatus");

-- CreateIndex
CREATE INDEX "disclosure_documents_isAmendment_idx" ON "disclosure_documents"("isAmendment");

-- CreateIndex
CREATE INDEX "disclosure_documents_originalRcpNo_idx" ON "disclosure_documents"("originalRcpNo");

-- CreateIndex
CREATE INDEX "disclosure_documents_fetchedAt_idx" ON "disclosure_documents"("fetchedAt");

-- AddForeignKey
ALTER TABLE "disclosure_documents" ADD CONSTRAINT "disclosure_documents_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disclosure_documents" ADD CONSTRAINT "disclosure_documents_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
