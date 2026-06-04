-- M11 Risk Engine — DAR-18
-- AI 금지영역: Risk 판정은 순수 Rule. AI 개입 0.

-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'KILLED', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ORDER_REQUESTED', 'RISK_PASSED', 'RISK_REJECTED', 'KILL_SWITCH_FIRED', 'ORDER_EXECUTED', 'ORDER_CANCELLED', 'KILL_SWITCH_SET', 'KILL_SWITCH_RESET');

-- CreateTable
CREATE TABLE "order_requests" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "requestedShares" INTEGER NOT NULL,
    "limitPrice" DECIMAL(12,2),
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "capitalSnapshot" DECIMAL(14,2) NOT NULL,
    "dailyLossSnapshot" DECIMAL(12,2) NOT NULL,
    "weeklyLossSnapshot" DECIMAL(12,2) NOT NULL,
    "positionWeightSnap" DECIMAL(5,4) NOT NULL,
    "buyScoreSnapshot" INTEGER,
    "paperTradeId" TEXT,
    "executionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_executions" (
    "id" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "executedShares" INTEGER NOT NULL,
    "executedPrice" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "slippage" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_audit_logs" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorKind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "orderRequestId" TEXT,
    "executionId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trading_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switch_states" (
    "id" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kill_switch_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_idempotencyKey_key" ON "order_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "order_requests_corpCode_idx" ON "order_requests"("corpCode");

-- CreateIndex
CREATE INDEX "order_requests_stockCode_idx" ON "order_requests"("stockCode");

-- CreateIndex
CREATE INDEX "order_requests_status_idx" ON "order_requests"("status");

-- CreateIndex
CREATE INDEX "order_requests_createdAt_idx" ON "order_requests"("createdAt");

-- CreateIndex
CREATE INDEX "order_executions_corpCode_idx" ON "order_executions"("corpCode");

-- CreateIndex
CREATE INDEX "order_executions_executedAt_idx" ON "order_executions"("executedAt");

-- CreateIndex
CREATE INDEX "trading_audit_logs_action_idx" ON "trading_audit_logs"("action");

-- CreateIndex
CREATE INDEX "trading_audit_logs_orderRequestId_idx" ON "trading_audit_logs"("orderRequestId");

-- CreateIndex
CREATE INDEX "trading_audit_logs_executionId_idx" ON "trading_audit_logs"("executionId");

-- CreateIndex
CREATE INDEX "trading_audit_logs_createdAt_idx" ON "trading_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corp_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "order_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_executions" ADD CONSTRAINT "order_executions_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corp_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_audit_logs" ADD CONSTRAINT "trading_audit_logs_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_audit_logs" ADD CONSTRAINT "trading_audit_logs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "order_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
