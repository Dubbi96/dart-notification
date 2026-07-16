-- DAR-522 [Wave C/C1·P0]: PRICE_MOVE(±5%) 역방향 리즈닝 — 48h 공시 원인 역추적 AI Task.
--
-- 가산형(비파괴) 마이그레이션 — (1) AiTaskName enum 값 1개 추가(AIUsageLog 비용 귀속용),
--   (2) 역방향 리즈닝 결과 캐시 테이블 1개 추가. 기존 스키마·row 무변경.
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행 — 에이전트 자동 적용 금지(guard 훅 휴먼 게이트).
--
-- ★ enum 신규 값은 이 마이그레이션 안에서 사용(참조)하지 않는다(테이블 DDL은 AiCostLevel만 사용) →
--   PostgreSQL 'unsafe use of new value' 제약 무해. 신규 값은 런타임 AIUsageLog INSERT 시점에만 쓰인다.

-- (1) AI 태스크 식별자 확장: 역방향 리즈닝(설명층 원인 해석).
ALTER TYPE "AiTaskName" ADD VALUE IF NOT EXISTS 'price-move-reasoning';

-- (2) 역방향 리즈닝 결과 캐시 — 등락 이벤트(refId)당 1행(멱등). FK 없음(시세성 이벤트·rcpNo nullable 논리 FK).
CREATE TABLE "price_move_reasonings" (
    "id" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "changePct" DOUBLE PRECISION NOT NULL,
    "rcpNo" TEXT,
    "status" TEXT NOT NULL,
    "level" "AiCostLevel",
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_move_reasonings_pkey" PRIMARY KEY ("id")
);

-- 멱등 자연키 — 등락 이벤트(`<stockCode>-<YYYYMMDD>`)당 1건(중복 AI 호출·재처리 방지).
CREATE UNIQUE INDEX "price_move_reasonings_refId_key" ON "price_move_reasonings"("refId");

-- 종목·거래일·causal 공시별 조회용.
CREATE INDEX "price_move_reasonings_corpCode_idx" ON "price_move_reasonings"("corpCode");
CREATE INDEX "price_move_reasonings_tradeDate_idx" ON "price_move_reasonings"("tradeDate");
CREATE INDEX "price_move_reasonings_rcpNo_idx" ON "price_move_reasonings"("rcpNo");
