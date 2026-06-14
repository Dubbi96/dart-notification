-- DAR-241: AI 멱등 캐시히트를 비용 관측성에 노출하기 위한 cacheHit 표식 추가.
-- engine2 AiAnalystService 의 findAnalysis 캐시히트는 resolveLevel/logUsage 전에 즉시 반환되어
-- AIUsageLog 에 전혀 기록되지 않았다 → 동일 rcpNo+task 재처리(BullMQ 재시도/중복)의 '비용0 재사용'이
-- 호출 통계에서 완전히 사라져 실처리량 대비 AI 활용률이 과소보고되었다.
--
-- 해결(plumbing): 캐시히트를 cacheHit=true · 비용0 · 토큰0 행으로 경량 기록한다.
--   - 실호출 비용/L0 집계(getUsageSummary)는 cacheHit=false 로 필터 → 기존 지표 무오염(회귀 0).
--   - 적중률은 cacheHit=true 행 count(getCacheHitCount)로만 별도 관측 → health/metrics 노출.
--
-- 가산형 컬럼(NOT NULL DEFAULT false) — 기존 행은 모두 실호출(false)로 보존. 무손실.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 deploy 사항(prisma/CLAUDE.md). 에이전트 자동 적용 금지.

-- AlterTable: 캐시히트 표식 추가
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "cacheHit" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: 캐시히트 count 서빙용
CREATE INDEX IF NOT EXISTS "ai_usage_logs_cacheHit_idx" ON "ai_usage_logs"("cacheHit");
