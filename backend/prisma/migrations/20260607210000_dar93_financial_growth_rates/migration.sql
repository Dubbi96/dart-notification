-- DAR-93: 다년 재무 시계열 → YoY/QoQ 성장률 산출·영속 (engine1 financials)
-- philosophy.scorer 의 EPS_GROWTH_YOY·REVENUE_GROWTH_YOY 결측 복원을 위해
-- CompanyFinancial 에 매출·영업이익·EPS 의 전년동기(YoY)·전기(QoQ) 성장률(%)을 가산한다.
-- DART 무료 API·다년 적재만으로 산출(AI 미개입). 자연키(corpCode+연도+보고서+구분) 불변.
-- 가산형 nullable: 직전 기간 결측이거나 기존 행은 NULL(결측 폴백 유지). 회귀 0.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- AlterTable: company_financials 에 YoY/QoQ 성장률 6종 가산 (nullable)
ALTER TABLE "company_financials" ADD COLUMN IF NOT EXISTS "revenueGrowthYoY" DOUBLE PRECISION;
ALTER TABLE "company_financials" ADD COLUMN IF NOT EXISTS "operatingProfitGrowthYoY" DOUBLE PRECISION;
ALTER TABLE "company_financials" ADD COLUMN IF NOT EXISTS "epsGrowthYoY" DOUBLE PRECISION;
ALTER TABLE "company_financials" ADD COLUMN IF NOT EXISTS "revenueGrowthQoQ" DOUBLE PRECISION;
ALTER TABLE "company_financials" ADD COLUMN IF NOT EXISTS "operatingProfitGrowthQoQ" DOUBLE PRECISION;
ALTER TABLE "company_financials" ADD COLUMN IF NOT EXISTS "epsGrowthQoQ" DOUBLE PRECISION;
