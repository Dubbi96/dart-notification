-- Persona 철학 엔진 P-A — DAR-48
-- 유명 투자자 철학 구조화 저장 (InvestorPhilosophy + PhilosophyMetric + PhilosophySource).
-- AI 미개입(순수 데이터/구조). 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §2·§4 P-A
-- ⚠️ 이 마이그레이션은 create-only 로 생성됨 — DB 반영(적용)은 휴먼 승인 사항. 자동 적용 금지.

-- CreateEnum
CREATE TYPE "PhilosophyMetricOperator" AS ENUM ('GT', 'LT', 'EQ', 'RANGE');

-- CreateEnum
CREATE TYPE "PhilosophySourceType" AS ENUM ('BOOK', 'SHAREHOLDER_LETTER', 'INTERVIEW', 'PUBLIC_STATEMENT');

-- AlterTable
ALTER TABLE "persona_analyses" ADD COLUMN     "philosophyId" TEXT;

-- CreateTable
CREATE TABLE "investor_philosophies" (
    "philosophyId" TEXT NOT NULL,
    "investorName" TEXT NOT NULL,
    "styleTags" TEXT[],
    "corePrinciples" TEXT[],
    "applicableAssets" TEXT[],
    "checklistItems" TEXT[],
    "riskProfile" TEXT NOT NULL,
    "scoreFormula" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_philosophies_pkey" PRIMARY KEY ("philosophyId")
);

-- CreateTable
CREATE TABLE "philosophy_metrics" (
    "id" TEXT NOT NULL,
    "philosophyId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "operator" "PhilosophyMetricOperator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "thresholdMax" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "philosophy_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "philosophy_sources" (
    "id" TEXT NOT NULL,
    "philosophyId" TEXT NOT NULL,
    "type" "PhilosophySourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "url" TEXT,

    CONSTRAINT "philosophy_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investor_philosophies_investorName_idx" ON "investor_philosophies"("investorName");

-- CreateIndex
CREATE INDEX "philosophy_metrics_philosophyId_idx" ON "philosophy_metrics"("philosophyId");

-- CreateIndex
CREATE UNIQUE INDEX "philosophy_metrics_philosophyId_metricKey_key" ON "philosophy_metrics"("philosophyId", "metricKey");

-- CreateIndex
CREATE INDEX "philosophy_sources_philosophyId_idx" ON "philosophy_sources"("philosophyId");

-- CreateIndex
CREATE UNIQUE INDEX "philosophy_sources_philosophyId_title_key" ON "philosophy_sources"("philosophyId", "title");

-- CreateIndex
CREATE INDEX "persona_analyses_philosophyId_idx" ON "persona_analyses"("philosophyId");

-- AddForeignKey
ALTER TABLE "persona_analyses" ADD CONSTRAINT "persona_analyses_philosophyId_fkey" FOREIGN KEY ("philosophyId") REFERENCES "investor_philosophies"("philosophyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "philosophy_metrics" ADD CONSTRAINT "philosophy_metrics_philosophyId_fkey" FOREIGN KEY ("philosophyId") REFERENCES "investor_philosophies"("philosophyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "philosophy_sources" ADD CONSTRAINT "philosophy_sources_philosophyId_fkey" FOREIGN KEY ("philosophyId") REFERENCES "investor_philosophies"("philosophyId") ON DELETE CASCADE ON UPDATE CASCADE;
