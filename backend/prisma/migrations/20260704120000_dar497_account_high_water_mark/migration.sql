-- DAR-497 [견고화 W2·P19]: 계좌 고점(High-Water Mark) 추적 — 드로다운 컷(룰북 §7.5) 발동 근거.
--
-- 배경(갭 A2 — 감사의 유일한 absent-high): 계좌 고점 추적·드로다운 임계 트리거가 전무해
--    룰북 8-6(-15~20% 컷·자동 재개 금지)이 발화 자체가 불가능했다. 기간 리셋(일간/주간 캡)은
--    자동 재개라 요건과 상충 → 리셋 없는 영속 고점이 필요하다. 킬스위치 인프라(DB 영속·수동 해제만·
--    REDUCE_ONLY)는 이미 완비 — 본 마이그레이션은 발동 근거가 되는 HWM 영속 테이블만 추가한다.
--
-- 모델 선택 근거(택1): 기존 PortfolioRiskSnapshot 확장 대신 FK 없는 전용 additive 모델로 분리한다.
--    스냅샷은 일별 시계열(리셋·재생성 가능)이라 forward-only max 고점의 영속 SSOT 로 부적합하고,
--    측정 트랙 집계 스키마를 오염시키지 않기 위함이다(RiskDecisionLog·DualMomentumForwardTrade 전례).
--    자연키 = portfolioId(유니크), 관계 FK 없음.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블만 추가한다. 기존 스키마 무변경. M10 클록 안전 —
--    기존 측정 트랙(시스템 모의·철학·전략 forward·분봉 단타)의 매매 행동·집계 무접촉.

-- CreateTable
CREATE TABLE "account_high_water_marks" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "highWaterMark" DECIMAL(16,2) NOT NULL,
    "peakDate" TEXT NOT NULL,
    "lastEquity" DECIMAL(16,2) NOT NULL,
    "lastDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_high_water_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_high_water_marks_portfolioId_key" ON "account_high_water_marks"("portfolioId");

-- CreateIndex
CREATE INDEX "account_high_water_marks_track_idx" ON "account_high_water_marks"("track");
