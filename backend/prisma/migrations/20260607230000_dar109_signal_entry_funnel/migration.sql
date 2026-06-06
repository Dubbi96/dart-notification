-- DAR-109: 신호→진입 퍼널 일별 계측 (engine5 모의운용)
-- ★Main Thesis B: 수익검증·졸업 표본 누적. PrismaSimulationAdapter write 실구현과 함께
-- '당일 생성 신호 수 → 진입 후보 통과 수 → 실제 체결 수'를 일별 누적 기록한다.
-- fill/adoption rate는 read 시 파생 산출(저장 안 함 — 단일 출처). AI 미개입(순수 카운트).
-- 멱등키 (portfolioId, tradeDate) — 동일 거래일 재실행은 upsert로 갱신(중복 없음).
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- CreateTable
CREATE TABLE "signal_entry_funnel_daily" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "signalsGenerated" INTEGER NOT NULL,
    "candidatesPassed" INTEGER NOT NULL,
    "filled" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_entry_funnel_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signal_entry_funnel_daily_portfolioId_tradeDate_idx" ON "signal_entry_funnel_daily"("portfolioId", "tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "signal_entry_funnel_daily_portfolioId_tradeDate_key" ON "signal_entry_funnel_daily"("portfolioId", "tradeDate");

-- AddForeignKey
ALTER TABLE "signal_entry_funnel_daily" ADD CONSTRAINT "signal_entry_funnel_daily_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
