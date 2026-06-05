-- CreateTable: EventStudyResult (M5 신규, DAR-9)
CREATE TABLE "event_study_results" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "isSignificant" BOOLEAN NOT NULL,
    "tStatistic" DOUBLE PRECISION,
    "pValue" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION,
    "avgReturnD1" DOUBLE PRECISION NOT NULL,
    "avgReturnD3" DOUBLE PRECISION NOT NULL,
    "avgReturnD5" DOUBLE PRECISION NOT NULL,
    "avgReturnD20" DOUBLE PRECISION NOT NULL,
    "avgArD1" DOUBLE PRECISION NOT NULL,
    "avgArD3" DOUBLE PRECISION NOT NULL,
    "avgArD5" DOUBLE PRECISION NOT NULL,
    "avgArD20" DOUBLE PRECISION NOT NULL,
    "upProbD5" DOUBLE PRECISION NOT NULL,
    "crashProbD5" DOUBLE PRECISION NOT NULL,
    "avgMaxDrawdown" DOUBLE PRECISION NOT NULL,
    "avgVolumeRatioD1" DOUBLE PRECISION NOT NULL,
    "avgVolumeRatioD3" DOUBLE PRECISION NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFromDate" TEXT NOT NULL,
    "dataToDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',

    CONSTRAINT "event_study_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EventStudyObservation (M5 신규, DAR-9)
CREATE TABLE "event_study_observations" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "d0Date" TEXT NOT NULL,
    "dailyReturns" JSONB NOT NULL,
    "dailyAR" JSONB NOT NULL,
    "cumulativeAR" JSONB NOT NULL,
    "volumeRatios" JSONB NOT NULL,
    "maxDrawdown" DOUBLE PRECISION NOT NULL,
    "isUpD5" BOOLEAN NOT NULL,
    "isCrashD5" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_study_observations_pkey" PRIMARY KEY ("id")
);

-- CreateUnique: EventStudyResult natural key
CREATE UNIQUE INDEX "event_study_results_eventType_bucketKey_marketType_key" ON "event_study_results"("eventType", "bucketKey", "marketType");

-- CreateIndex: EventStudyResult
CREATE INDEX "event_study_results_eventType_idx" ON "event_study_results"("eventType");
CREATE INDEX "event_study_results_bucketKey_idx" ON "event_study_results"("bucketKey");
CREATE INDEX "event_study_results_calculatedAt_idx" ON "event_study_results"("calculatedAt");

-- CreateIndex: EventStudyObservation
CREATE INDEX "event_study_observations_eventType_bucketKey_idx" ON "event_study_observations"("eventType", "bucketKey");
CREATE INDEX "event_study_observations_rcpNo_idx" ON "event_study_observations"("rcpNo");
CREATE INDEX "event_study_observations_corpCode_idx" ON "event_study_observations"("corpCode");
