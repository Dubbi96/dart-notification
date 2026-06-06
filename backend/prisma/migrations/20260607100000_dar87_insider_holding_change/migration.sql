-- DAR-87: 내부자·대량보유 지분변동 수집 (engine1)
-- DART 정형 엔드포인트 2종(majorstock.json·elestock.json) → InsiderHoldingChange.
-- ★Main Thesis A 미수집 데이터원: 내부자·5%보유자 매매 = 미공개 펀더멘털 주체 행동신호.
-- AI 미개입(순수 Rule). 자연키 corpCode(FK → companies). 멱등키 (source,rcptNo,reporter).
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- AlterEnum: EventType 지분변동 3종 추가 (가산형, 기존 값 회귀 0)
-- ※ 새 값을 같은 트랜잭션 내에서 사용(INSERT/UPDATE)하지 않으므로 PG12+ 안전.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'INSIDER_BUY';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'INSIDER_SELL';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'MAJOR_HOLDER_5PCT';

-- CreateTable
CREATE TABLE "insider_holding_changes" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rcptNo" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "reporter" TEXT NOT NULL,
    "relation" TEXT,
    "isExecutive" BOOLEAN,
    "isRegistered" BOOLEAN,
    "isMajorShareholder" BOOLEAN,
    "sharesAfter" BIGINT,
    "sharesChange" BIGINT,
    "ratioAfter" DOUBLE PRECISION,
    "ratioChange" DOUBLE PRECISION,
    "tradeType" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION,
    "reportReason" TEXT,
    "reportedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insider_holding_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insider_holding_changes_corpCode_idx" ON "insider_holding_changes"("corpCode");

-- CreateIndex
CREATE INDEX "insider_holding_changes_tradeType_idx" ON "insider_holding_changes"("tradeType");

-- CreateIndex
CREATE INDEX "insider_holding_changes_reportedAt_idx" ON "insider_holding_changes"("reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "insider_holding_changes_source_rcptNo_reporter_key" ON "insider_holding_changes"("source", "rcptNo", "reporter");

-- AddForeignKey
ALTER TABLE "insider_holding_changes" ADD CONSTRAINT "insider_holding_changes_corpCode_fkey" FOREIGN KEY ("corpCode") REFERENCES "companies"("corpCode") ON DELETE RESTRICT ON UPDATE CASCADE;
