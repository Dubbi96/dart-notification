-- DAR-486 [견고화 W3·P25]: 종목상태 일별 이력화 + 상폐 감액 — 백테스트 생존편향 처리.
--
-- 배경(갭 B5 partial): PriceConstraintService.canEnter(거래정지·관리종목·상한가 차단)는 있으나,
--    일별 상태 플래그가 채워지지 않아 prod 백테스트에서 사실상 비활성이었다(상한가 추격·정지종목
--    진입 미차단 → 수익률 낙관 편향). 08:50 종목상태 수집을 forward-only 로 일별 축적해 백테스트
--    어댑터에 point-in-time 플래그를 공급한다.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): 신규 테이블 1개 추가 + ExitReason enum 값 1개 추가. 기존 스키마 무변경.
--    측정·데이터층 전용 — 운용 매매 경로 무접촉(M10 클록 안전).
--
-- ★소급 백필 금지(lookahead 불가침): 과거 날짜의 현재 상태 소급 적재는 미래정보 누설이므로 금지.
--    이력 없는 과거 거래일은 어댑터가 미설정(false)으로 처리한다.

-- 1) 종목상태 일별 이력 테이블 (stockCode, tradeDate 복합 PK — 하루 1행/종목, forward-only)
CREATE TABLE "stock_status_daily" (
    "stockCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "isTradingSuspended" BOOLEAN NOT NULL DEFAULT false,
    "isManagement" BOOLEAN NOT NULL DEFAULT false,
    "isInvestmentCaution" BOOLEAN NOT NULL DEFAULT false,
    "isAbnormalSurge" BOOLEAN NOT NULL DEFAULT false,
    "statusNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_status_daily_pkey" PRIMARY KEY ("stockCode", "tradeDate")
);

-- CreateIndex (거래일 범위 조회·신선도 판정용)
CREATE INDEX "stock_status_daily_tradeDate_idx" ON "stock_status_daily"("tradeDate");

-- 2) 상폐(가격 소멸) 확정 감액 청산 사유 — 가산형·멱등.
--    주의: PostgreSQL 은 동일 트랜잭션에서 ADD VALUE 직후 그 값을 사용할 수 없다. 본 마이그레이션은
--    enum 값을 추가만 하고 사용하지 않으므로(데이터 백필 없음) 안전하다(DAR-473 선례와 동일).
ALTER TYPE "ExitReason" ADD VALUE IF NOT EXISTS 'DELISTED';
