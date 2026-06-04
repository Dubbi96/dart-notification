-- Migration: M8 Portfolio & Exit Engine (DAR-12)
-- AI 금지영역: Exit Score·트리거·5액션 순수 Rule 기반. AI 개입 0.

-- CreateEnum: PositionStatus
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED', 'PARTIAL');

-- CreateEnum: ExitTriggerType
CREATE TYPE "ExitTriggerType" AS ENUM ('STOP_LOSS', 'TAKE_PROFIT', 'THESIS_INVALIDATED', 'TIME_LIMIT', 'CHART_BREAKDOWN', 'REBALANCING');

-- CreateEnum: ExitAction
CREATE TYPE "ExitAction" AS ENUM ('HOLD', 'WATCH', 'REDUCE', 'EXIT', 'BLOCK_REBUY');

-- CreateTable: portfolios
CREATE TABLE "portfolios" (
    "id"                    TEXT NOT NULL,
    "userId"                TEXT NOT NULL,
    "name"                  TEXT NOT NULL DEFAULT '기본 포트폴리오',
    "currency"              TEXT NOT NULL DEFAULT 'KRW',
    "isActive"              BOOLEAN NOT NULL DEFAULT true,
    "maxSinglePositionPct"  DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "maxSectorPct"          DOUBLE PRECISION NOT NULL DEFAULT 30.0,
    "maxDailyLossPct"       DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "maxWeeklyLossPct"      DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "stopLossGlobalPct"     DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable: positions
CREATE TABLE "positions" (
    "id"               TEXT NOT NULL,
    "portfolioId"      TEXT NOT NULL,
    "corpCode"         TEXT NOT NULL,
    "stockCode"        TEXT NOT NULL,
    "positionThesisId" TEXT,

    "entryDate"        TIMESTAMP(3) NOT NULL,
    "entryPrice"       DOUBLE PRECISION NOT NULL,
    "quantity"         INTEGER NOT NULL,
    "entryAmount"      DOUBLE PRECISION NOT NULL,

    "currentPrice"     DOUBLE PRECISION,
    "currentValue"     DOUBLE PRECISION,
    "unrealizedPnl"    DOUBLE PRECISION,
    "unrealizedPnlPct" DOUBLE PRECISION,

    "stopLossPct"      DOUBLE PRECISION,
    "takeProfitPct"    DOUBLE PRECISION,
    "maxHoldDays"      INTEGER,

    "highestPrice"     DOUBLE PRECISION,
    "highestAt"        TIMESTAMP(3),

    "status"           "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt"         TIMESTAMP(3),

    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: position_daily_snapshots
CREATE TABLE "position_daily_snapshots" (
    "id"               TEXT NOT NULL,
    "positionId"       TEXT NOT NULL,
    "snapshotDate"     TEXT NOT NULL,

    "openPrice"        DOUBLE PRECISION,
    "closePrice"       DOUBLE PRECISION,
    "highPrice"        DOUBLE PRECISION,
    "lowPrice"         DOUBLE PRECISION,
    "volume"           BIGINT,

    "ma5"              DOUBLE PRECISION,
    "ma20"             DOUBLE PRECISION,
    "ma60"             DOUBLE PRECISION,
    "rsi14"            DOUBLE PRECISION,
    "atr14"            DOUBLE PRECISION,
    "vwap"             DOUBLE PRECISION,

    "quantity"         INTEGER NOT NULL,
    "positionValue"    DOUBLE PRECISION NOT NULL,
    "unrealizedPnl"    DOUBLE PRECISION NOT NULL,
    "unrealizedPnlPct" DOUBLE PRECISION NOT NULL,

    "exitScore"        INTEGER,
    "exitAction"       TEXT,

    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable: exit_signals
CREATE TABLE "exit_signals" (
    "id"                    TEXT NOT NULL,
    "positionId"            TEXT NOT NULL,
    "checkTime"             TEXT NOT NULL,

    "lossRiskScore"         INTEGER NOT NULL DEFAULT 0,
    "thesisBreakScore"      INTEGER NOT NULL DEFAULT 0,
    "chartBreakScore"       INTEGER NOT NULL DEFAULT 0,
    "disclosureRiskScore"   INTEGER NOT NULL DEFAULT 0,
    "overweightScore"       INTEGER NOT NULL DEFAULT 0,
    "timeExceededScore"     INTEGER NOT NULL DEFAULT 0,
    "positiveMomentumBonus" INTEGER NOT NULL DEFAULT 0,

    "exitScore"             INTEGER NOT NULL,
    "exitAction"            "ExitAction" NOT NULL,
    "triggerType"           "ExitTriggerType",
    "triggerTypes"          TEXT[],

    "scoreDetail"           JSONB NOT NULL,

    "triggerRcpNo"          TEXT,

    "aiExplanation"         TEXT,
    "aiUsed"                BOOLEAN NOT NULL DEFAULT false,

    "isAcknowledged"        BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt"        TIMESTAMP(3),
    "userAction"            TEXT,

    "checkedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: portfolio_risk_snapshots
CREATE TABLE "portfolio_risk_snapshots" (
    "id"                 TEXT NOT NULL,
    "portfolioId"        TEXT NOT NULL,
    "snapshotDate"       TEXT NOT NULL,

    "totalValue"         DOUBLE PRECISION NOT NULL,
    "cashAmount"         DOUBLE PRECISION,
    "unrealizedPnl"      DOUBLE PRECISION NOT NULL,
    "unrealizedPnlPct"   DOUBLE PRECISION NOT NULL,

    "topPositionPct"     DOUBLE PRECISION NOT NULL,
    "topSectorPct"       DOUBLE PRECISION,
    "openPositionCount"  INTEGER NOT NULL,

    "dailyPnl"           DOUBLE PRECISION,
    "dailyPnlPct"        DOUBLE PRECISION,
    "weeklyPnl"          DOUBLE PRECISION,
    "weeklyPnlPct"       DOUBLE PRECISION,

    "riskLevel"          TEXT NOT NULL DEFAULT 'NORMAL',
    "hardRuleBreached"   BOOLEAN NOT NULL DEFAULT false,
    "hardRuleDetail"     TEXT,

    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_risk_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: portfolios
CREATE INDEX "portfolios_userId_idx" ON "portfolios"("userId");

-- CreateIndex: positions
CREATE UNIQUE INDEX "positions_positionThesisId_key" ON "positions"("positionThesisId");
CREATE INDEX "positions_portfolioId_status_idx" ON "positions"("portfolioId", "status");
CREATE INDEX "positions_corpCode_idx" ON "positions"("corpCode");
CREATE INDEX "positions_stockCode_idx" ON "positions"("stockCode");

-- CreateIndex: position_daily_snapshots
CREATE UNIQUE INDEX "position_daily_snapshots_positionId_snapshotDate_key" ON "position_daily_snapshots"("positionId", "snapshotDate");
CREATE INDEX "position_daily_snapshots_positionId_snapshotDate_idx" ON "position_daily_snapshots"("positionId", "snapshotDate");

-- CreateIndex: exit_signals
CREATE INDEX "exit_signals_positionId_checkedAt_idx" ON "exit_signals"("positionId", "checkedAt");
CREATE INDEX "exit_signals_exitAction_idx" ON "exit_signals"("exitAction");
CREATE INDEX "exit_signals_exitScore_idx" ON "exit_signals"("exitScore");
CREATE INDEX "exit_signals_triggerRcpNo_idx" ON "exit_signals"("triggerRcpNo");

-- CreateIndex: portfolio_risk_snapshots
CREATE UNIQUE INDEX "portfolio_risk_snapshots_portfolioId_snapshotDate_key" ON "portfolio_risk_snapshots"("portfolioId", "snapshotDate");
CREATE INDEX "portfolio_risk_snapshots_portfolioId_snapshotDate_idx" ON "portfolio_risk_snapshots"("portfolioId", "snapshotDate");

-- AddForeignKey: portfolios → users
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: positions → portfolios
ALTER TABLE "positions" ADD CONSTRAINT "positions_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: positions → companies
ALTER TABLE "positions" ADD CONSTRAINT "positions_corpCode_fkey"
    FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: positions → position_theses (optional 1:1)
ALTER TABLE "positions" ADD CONSTRAINT "positions_positionThesisId_fkey"
    FOREIGN KEY ("positionThesisId") REFERENCES "position_theses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: position_daily_snapshots → positions
ALTER TABLE "position_daily_snapshots" ADD CONSTRAINT "position_daily_snapshots_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: exit_signals → positions
ALTER TABLE "exit_signals" ADD CONSTRAINT "exit_signals_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: exit_signals → disclosures (nullable)
ALTER TABLE "exit_signals" ADD CONSTRAINT "exit_signals_triggerRcpNo_fkey"
    FOREIGN KEY ("triggerRcpNo") REFERENCES "disclosures"("rcpNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: portfolio_risk_snapshots → portfolios
ALTER TABLE "portfolio_risk_snapshots" ADD CONSTRAINT "portfolio_risk_snapshots_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
