-- DAR-484 [견고화 W1·P10]: ETF 일봉 시세 — Wave1 듀얼모멘텀/변동성돌파 2트랙 공통 토대.
--
-- 배경: 월단위 듀얼모멘텀 코어(P12/P13)·변동성 돌파 위성(P14/P15)은 ETF 일봉을 요구한다.
--    StockDailyPrice 는 corpCode FK → Company 필수라 DART corpCode 가 없는 ETF 에 부적합 →
--    전용 모델(etf_daily_prices)로 분리한다. 자연키 = etfCode(6자리 단축코드), FK 관계 없음.
--    필드는 stock_daily_prices 에 준함(OHLCV + 거래대금). source 로 어느 소스 어댑터가 적재했는지
--    (KIS | KRX_ETP) 기록 — 1차 소스 = KIS 기간별시세(일봉). KRX /etp/etf_bydd_trd 는 2026-07-03
--    실검증 HTTP 401(키 ETF 상품 미구독)이라 미구현(구독 승인 시 KRX_ETP 어댑터로 전환).
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블만 추가한다. 기존 스키마 무변경. 데이터층 전용 —
--    측정 트랙 매매 행동(진입·체결·청산) 무접촉(M10 클록 안전).

-- CreateTable
CREATE TABLE "etf_daily_prices" (
    "id" TEXT NOT NULL,
    "etfCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "openPrice" INTEGER NOT NULL,
    "highPrice" INTEGER NOT NULL,
    "lowPrice" INTEGER NOT NULL,
    "closePrice" INTEGER NOT NULL,
    "volume" BIGINT NOT NULL,
    "tradingValue" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'KIS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etf_daily_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etf_daily_prices_etfCode_tradeDate_key" ON "etf_daily_prices"("etfCode", "tradeDate");

-- CreateIndex
CREATE INDEX "etf_daily_prices_tradeDate_idx" ON "etf_daily_prices"("tradeDate");
