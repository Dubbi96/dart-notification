-- 재무지표 수집 파이프라인 — DAR-52
-- DART 단일회사 전체 재무제표(fnlttSinglAcntAll) → CompanyFinancial + FinancialCollectionLog.
-- 정보 최대수집 + Persona P-B 스코어러/BuyScore keyMetric 선행. AI 미개입(순수 데이터/Rule).
-- ⚠️ 이 마이그레이션은 create-only 로 생성됨 — DB 반영(적용)은 휴먼 승인 사항. 자동 적용 금지.

-- CreateTable
CREATE TABLE "company_financials" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT,
    "bsnsYear" TEXT NOT NULL,
    "reprtCode" TEXT NOT NULL,
    "fsDiv" TEXT NOT NULL DEFAULT 'CFS',
    "revenue" BIGINT,
    "operatingProfit" BIGINT,
    "netIncome" BIGINT,
    "totalAssets" BIGINT,
    "totalLiabilities" BIGINT,
    "totalEquity" BIGINT,
    "eps" DOUBLE PRECISION,
    "bps" DOUBLE PRECISION,
    "roe" DOUBLE PRECISION,
    "roa" DOUBLE PRECISION,
    "debtRatio" DOUBLE PRECISION,
    "per" DOUBLE PRECISION,
    "pbr" DOUBLE PRECISION,
    "rceptNo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_collection_logs" (
    "id" TEXT NOT NULL,
    "bsnsYear" TEXT NOT NULL,
    "reprtCode" TEXT NOT NULL,
    "fsDiv" TEXT NOT NULL DEFAULT 'CFS',
    "triggeredBy" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "financial_collection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_financials_corpCode_idx" ON "company_financials"("corpCode");

-- CreateIndex
CREATE INDEX "company_financials_bsnsYear_idx" ON "company_financials"("bsnsYear");

-- CreateIndex
CREATE UNIQUE INDEX "company_financials_corpCode_bsnsYear_reprtCode_fsDiv_key" ON "company_financials"("corpCode", "bsnsYear", "reprtCode", "fsDiv");

-- CreateIndex
CREATE INDEX "financial_collection_logs_bsnsYear_idx" ON "financial_collection_logs"("bsnsYear");

-- CreateIndex
CREATE INDEX "financial_collection_logs_status_idx" ON "financial_collection_logs"("status");

-- AddForeignKey
ALTER TABLE "company_financials" ADD CONSTRAINT "company_financials_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
