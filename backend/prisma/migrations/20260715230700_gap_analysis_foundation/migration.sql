-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('FREE', 'PRO');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PRICE_MOVE';

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'EARNINGS_GUIDANCE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tier" "UserTier" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "priceMovePushEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pro_waitlist_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_flow_daily" (
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "foreignNetBuyQty" BIGINT NOT NULL,
    "foreignNetBuyAmount" BIGINT NOT NULL,
    "institutionNetBuyQty" BIGINT NOT NULL,
    "institutionNetBuyAmount" BIGINT NOT NULL,
    "individualNetBuyQty" BIGINT NOT NULL,
    "individualNetBuyAmount" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_flow_daily_pkey" PRIMARY KEY ("stockCode","tradeDate")
);

-- CreateTable
CREATE TABLE "search_miss_logs" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "tag" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_miss_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_events" (
    "id" TEXT NOT NULL,
    "anonId" TEXT,
    "userId" TEXT,
    "step" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_selling_daily" (
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "shortSellingVolume" BIGINT NOT NULL,
    "shortSellingAmount" BIGINT,
    "shortBalanceQty" BIGINT,
    "shortBalanceRatio" DOUBLE PRECISION,
    "publishedDate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_selling_daily_pkey" PRIMARY KEY ("stockCode","tradeDate")
);

-- CreateIndex
CREATE UNIQUE INDEX "pro_waitlist_entries_userId_key" ON "pro_waitlist_entries"("userId");

-- CreateIndex
CREATE INDEX "investor_flow_daily_tradeDate_idx" ON "investor_flow_daily"("tradeDate");

-- CreateIndex
CREATE INDEX "search_miss_logs_createdAt_idx" ON "search_miss_logs"("createdAt");

-- CreateIndex
CREATE INDEX "search_miss_logs_tag_idx" ON "search_miss_logs"("tag");

-- CreateIndex
CREATE INDEX "funnel_events_step_createdAt_idx" ON "funnel_events"("step", "createdAt");

-- CreateIndex
CREATE INDEX "short_selling_daily_tradeDate_idx" ON "short_selling_daily"("tradeDate");

-- CreateIndex
CREATE INDEX "short_selling_daily_publishedDate_idx" ON "short_selling_daily"("publishedDate");

-- AddForeignKey
ALTER TABLE "pro_waitlist_entries" ADD CONSTRAINT "pro_waitlist_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

