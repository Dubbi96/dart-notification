-- CreateTable
CREATE TABLE "disclosure_collection_logs" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "bgnDe" TEXT NOT NULL,
    "endDe" TEXT NOT NULL,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,

    CONSTRAINT "disclosure_collection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disclosure_collection_logs_startedAt_idx" ON "disclosure_collection_logs"("startedAt");

-- CreateIndex
CREATE INDEX "disclosure_collection_logs_status_idx" ON "disclosure_collection_logs"("status");

-- CreateIndex
CREATE INDEX "disclosure_collection_logs_triggeredBy_idx" ON "disclosure_collection_logs"("triggeredBy");
