-- DAR-411: 분봉 단타(intraday scalping) 모의전략 트랙.
--
-- 배경: 당일 진입·당일 청산 forward-only 페이퍼 트랙. 분봉(stock_minute_prices)은 당일
--    forward-only(KIS, 과거 분봉 없음) → 백테스트 불가 → 정규장 중 실시간 모의로만 누적한다.
--    1행 = 1라운드트립(진입+청산) — 진입/청산 사유·분봉 시각·일별 성과를 기록한다.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블만 추가한다. 기존 스키마 무변경. 자연키 corpCode/stockCode 는
--    인덱스만(StockMinutePrice 와 동일 패턴, FK 관계 없음 = Company 무변경).

-- CreateTable
CREATE TABLE "intraday_scalp_trades" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "entryTs" TIMESTAMP(3) NOT NULL,
    "entryPrice" DECIMAL(12,2) NOT NULL,
    "shares" INTEGER NOT NULL,
    "entryReason" TEXT NOT NULL,
    "entryVwap" DECIMAL(12,2),
    "entryVolumeRatio" DECIMAL(8,2),
    "exitTs" TIMESTAMP(3),
    "exitPrice" DECIMAL(12,2),
    "exitReason" TEXT,
    "holdMinutes" INTEGER,
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "slippage" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossPnl" DECIMAL(14,2),
    "netPnl" DECIMAL(14,2),
    "returnPct" DECIMAL(8,4),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "styleTag" TEXT NOT NULL DEFAULT 'intraday-scalp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intraday_scalp_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intraday_scalp_trades_status_idx" ON "intraday_scalp_trades"("status");

-- CreateIndex
CREATE INDEX "intraday_scalp_trades_tradeDate_idx" ON "intraday_scalp_trades"("tradeDate");

-- CreateIndex
CREATE INDEX "intraday_scalp_trades_stockCode_idx" ON "intraday_scalp_trades"("stockCode");

-- CreateIndex
CREATE INDEX "intraday_scalp_trades_corpCode_idx" ON "intraday_scalp_trades"("corpCode");

-- CreateIndex
CREATE INDEX "intraday_scalp_trades_styleTag_idx" ON "intraday_scalp_trades"("styleTag");
