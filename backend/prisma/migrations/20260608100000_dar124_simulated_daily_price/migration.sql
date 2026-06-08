-- DAR-124: 모의운용 합성 시세 — 환경시계(미래) 대응 결정적 시뮬 피드
-- ★신뢰 원칙(불가침): 이 테이블은 '모의/시뮬레이션' 전용 합성 일봉이다. 실시세가 아니며
-- 실데이터(stock_daily_prices)와 물리적으로 분리한다. 오직 PaperSimulation 만 읽고,
-- 기업 현재가/지표/신호 등 실가격 표시 경로는 이 테이블을 절대 참조하지 않는다.
-- 배경: 환경 시계가 미래(2026)라 실 KRX 일봉이 없어 krx.daily lastSuccessAt=null →
-- 모의운용 신규 매수 0·신선 시세 공백(M10 졸업 게이트 직결). 결정적 합성 피드로 해소한다.
-- Company FK 관계는 의도적으로 두지 않는다(격리·Company 무변경). source 컬럼은 항상 'SYNTHETIC'.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- CreateTable
CREATE TABLE "simulated_daily_prices" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "openPrice" INTEGER NOT NULL,
    "highPrice" INTEGER NOT NULL,
    "lowPrice" INTEGER NOT NULL,
    "closePrice" INTEGER NOT NULL,
    "volume" BIGINT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SYNTHETIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulated_daily_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulated_daily_prices_corpCode_idx" ON "simulated_daily_prices"("corpCode");

-- CreateIndex
CREATE INDEX "simulated_daily_prices_tradeDate_idx" ON "simulated_daily_prices"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "simulated_daily_prices_stockCode_tradeDate_key" ON "simulated_daily_prices"("stockCode", "tradeDate");
