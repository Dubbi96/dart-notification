-- CreateEnum
CREATE TYPE "AiTaskName" AS ENUM ('summary', 'event-classification', 'persona-interpretation', 'position-thesis');


-- CreateEnum
CREATE TYPE "AiCostLevel" AS ENUM ('L0', 'L1', 'L2', 'L3');

-- CreateTable
CREATE TABLE "disclosure_analyses" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "task" "AiTaskName" NOT NULL,
    "level" "AiCostLevel" NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disclosure_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_analyses" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persona_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "rcpNo" TEXT NOT NULL,
    "task" "AiTaskName" NOT NULL,
    "level" "AiCostLevel" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disclosure_analyses_rcpNo_task_key" ON "disclosure_analyses"("rcpNo", "task");

-- CreateIndex
CREATE INDEX "disclosure_analyses_rcpNo_idx" ON "disclosure_analyses"("rcpNo");

-- CreateIndex
CREATE INDEX "disclosure_analyses_task_idx" ON "disclosure_analyses"("task");

-- CreateIndex
CREATE INDEX "disclosure_analyses_createdAt_idx" ON "disclosure_analyses"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "persona_analyses_rcpNo_key" ON "persona_analyses"("rcpNo");

-- CreateIndex
CREATE INDEX "persona_analyses_rcpNo_idx" ON "persona_analyses"("rcpNo");

-- CreateIndex
CREATE INDEX "ai_usage_logs_rcpNo_idx" ON "ai_usage_logs"("rcpNo");

-- CreateIndex
CREATE INDEX "ai_usage_logs_task_idx" ON "ai_usage_logs"("task");

-- CreateIndex
CREATE INDEX "ai_usage_logs_level_idx" ON "ai_usage_logs"("level");

-- CreateIndex
CREATE INDEX "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "disclosure_analyses" ADD CONSTRAINT "disclosure_analyses_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_analyses" ADD CONSTRAINT "persona_analyses_rcpNo_fkey" FOREIGN KEY ("rcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE CASCADE ON UPDATE CASCADE;
