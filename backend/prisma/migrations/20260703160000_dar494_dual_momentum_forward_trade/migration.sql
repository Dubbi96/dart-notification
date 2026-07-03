-- DAR-494 [견고화 W1·P13]: 듀얼모멘텀 코어 forward 트랙 — ETF 단일 보유 월말 리밸런싱 이력.
--
-- 배경: 코어 듀얼모멘텀(P12 판정 순수 함수 + P16 백테스트 게이트)의 forward(모의) 활성 배선.
--    보유 자산이 ETF(360750/069500/153130/273130)라 DART corpCode 가 없어 Position/PaperTrade
--    (corpCode FK → Company 필수)에 부적합하다. EtfDailyPrice(DAR-484)·IntradayScalpTrade(DAR-411)
--    전례처럼 FK 없는 전용 모델로 분리한다. 자연키 = etfCode(6자리 단축코드), 관계 FK 없음.
--    styleTag='alloc:dual-momentum'(룰북 §9.2 SSOT). 라이프사이클 PENDING→OPEN→CLOSED(CANCELLED).
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블만 추가한다. 기존 스키마 무변경. M10 클록 안전 —
--    기존 측정 트랙(시스템 모의·전략 forward·분봉 단타)의 매매 행동·집계 무접촉.

-- CreateTable
CREATE TABLE "dual_momentum_forward_trades" (
    "id" TEXT NOT NULL,
    "etfCode" TEXT NOT NULL,
    "styleTag" TEXT NOT NULL DEFAULT 'alloc:dual-momentum',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionDate" TEXT NOT NULL,
    "entryTradeDate" TEXT NOT NULL,
    "reservedShares" INTEGER NOT NULL DEFAULT 0,
    "reservedPrice" DECIMAL(12,2) NOT NULL,
    "entryTs" TIMESTAMP(3),
    "entryPrice" DECIMAL(12,2),
    "shares" INTEGER NOT NULL DEFAULT 0,
    "exitTs" TIMESTAMP(3),
    "exitDate" TEXT,
    "exitPrice" DECIMAL(12,2),
    "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "slippage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossPnl" DECIMAL(16,2),
    "netPnl" DECIMAL(16,2),
    "returnPct" DECIMAL(8,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dual_momentum_forward_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dual_momentum_forward_trades_status_idx" ON "dual_momentum_forward_trades"("status");

-- CreateIndex
CREATE INDEX "dual_momentum_forward_trades_styleTag_idx" ON "dual_momentum_forward_trades"("styleTag");

-- CreateIndex
CREATE INDEX "dual_momentum_forward_trades_entryTradeDate_idx" ON "dual_momentum_forward_trades"("entryTradeDate");

-- CreateIndex
CREATE INDEX "dual_momentum_forward_trades_decisionDate_idx" ON "dual_momentum_forward_trades"("decisionDate");
