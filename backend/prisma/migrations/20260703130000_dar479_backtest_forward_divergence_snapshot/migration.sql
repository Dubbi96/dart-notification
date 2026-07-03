-- DAR-479 [견고화 W0·P04]: 백테스트 vs forward 성과 괴리 일일 스냅샷.
--
-- 배경: 리플레이 트랙(BacktestRun.strategyKey, 과거 1년 재생)과 forward 트랙
--    (styleTag='strategy:<key>', 오늘 신호→오늘 진입 누적)은 그간 별개 표면으로 조인이 없었다.
--    졸업 판정의 핵심 지표(백테스트 대비 실운용 괴리)를 추세 추적용으로 매일 1행 적재한다.
--    1행 = 1전략×1거래일. 수익률·승률·거래빈도·보유기간의 괴리(forward − backtest)를 기록.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블만 추가한다. 기존 스키마 무변경. 측정·적재 전용 —
--    트레이딩 행동(매수·체결·청산) 무접촉. 자연 그룹핑 키 strategyKey 는 인덱스만(FK 관계 없음).

-- CreateTable
CREATE TABLE "backtest_forward_divergence_snapshots" (
    "id" TEXT NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "backtestReturnPct" DOUBLE PRECISION,
    "backtestWinRate" DOUBLE PRECISION,
    "backtestTradeCount" INTEGER NOT NULL DEFAULT 0,
    "backtestAvgHoldDays" DOUBLE PRECISION,
    "backtestTradesPerMonth" DOUBLE PRECISION,
    "forwardReturnPct" DOUBLE PRECISION,
    "forwardWinRate" DOUBLE PRECISION,
    "forwardTradeCount" INTEGER NOT NULL DEFAULT 0,
    "forwardAvgHoldDays" DOUBLE PRECISION,
    "forwardTradesPerMonth" DOUBLE PRECISION,
    "returnGapPct" DOUBLE PRECISION,
    "winRateGap" DOUBLE PRECISION,
    "tradeFreqGap" DOUBLE PRECISION,
    "holdDaysGap" DOUBLE PRECISION,
    "lowSample" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_forward_divergence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "backtest_forward_divergence_snapshots_strategyKey_snapshotD_key" ON "backtest_forward_divergence_snapshots"("strategyKey", "snapshotDate");

-- CreateIndex
CREATE INDEX "backtest_forward_divergence_snapshots_strategyKey_snapshotD_idx" ON "backtest_forward_divergence_snapshots"("strategyKey", "snapshotDate");
