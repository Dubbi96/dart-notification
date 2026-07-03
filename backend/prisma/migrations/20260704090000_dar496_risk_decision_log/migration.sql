-- DAR-496 [견고화 W2·P18]: RiskGuard 공용 진입 게이트 판정 이력.
--
-- 배경(갭 A1·A5): DAILY_LOSS 순수 룰은 분봉 단타에서만 진입 강제되고, 시스템 모의·철학·전략
--    forward 경로에는 미배선. 전략 forward 진입 루프에는 현금 가드도 없다. 본 게이트는
--    일일손실 한도 + 현금 불변식(cash≥0, DAR-426) 2종을 전 트랙 진입 확정 직전에 판정한다.
--    측정 트랙은 SHADOW(기록만·차단 0), 듀얼모멘텀 코어 forward 는 ENFORCE(위반 시 BLOCK).
--
-- 모델 선택 근거(택1): 기존 TradingAuditLog 는 OrderRequest/OrderExecution(M11 실주문 루프)
--    전용 스키마 + 닫힌 AuditAction enum 이라, 주문 FK 가 없는 페이퍼 진입 게이트의 고빈도 SHADOW
--    텔레메트리에는 부적합하다. DAR-494(DualMomentumForwardTrade) 전례처럼 FK 없는 전용 additive
--    모델로 분리해 M11 감사 추적을 오염시키지 않는다. 자연키 = id(cuid), 관계 FK 없음.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블만 추가한다. 기존 스키마 무변경. M10 클록 안전 —
--    기존 측정 트랙(시스템 모의·철학·전략 forward·분봉 단타)의 매매 행동·집계 무접촉.

-- CreateTable
CREATE TABLE "risk_decision_logs" (
    "id" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "totalCapital" DECIMAL(16,2) NOT NULL,
    "dailyRealizedPnl" DECIMAL(16,2) NOT NULL,
    "availableCash" DECIMAL(16,2) NOT NULL,
    "entryBudget" DECIMAL(16,2) NOT NULL,
    "violationCodes" TEXT NOT NULL DEFAULT '',
    "corpCode" TEXT,
    "stockCode" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_decision_logs_track_idx" ON "risk_decision_logs"("track");

-- CreateIndex
CREATE INDEX "risk_decision_logs_tradeDate_idx" ON "risk_decision_logs"("tradeDate");

-- CreateIndex
CREATE INDEX "risk_decision_logs_action_idx" ON "risk_decision_logs"("action");

-- CreateIndex
CREATE INDEX "risk_decision_logs_createdAt_idx" ON "risk_decision_logs"("createdAt");
