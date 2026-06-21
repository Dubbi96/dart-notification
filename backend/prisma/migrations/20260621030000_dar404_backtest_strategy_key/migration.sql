-- DAR-404: 시스템 트레이딩 전략 변형 4종 — 백테스트 다중 트랙.
--
-- 배경: 단일 모의매매(라이브 1년 리플레이, DAR-385)를 '진입/청산/사이징 룰이 다른 전략 변형
--    4종'으로 분기해 각각 과거 매수/매도 트랙을 BacktestRun/Trade 에 쌓고 비교한다. 거장철학
--    (DAR-76)·페르소나 축과 별개의 '트레이딩 로직' 축이다.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): strategyKey(nullable) 컬럼 + 인덱스만 추가한다. 기존 단일 트랙 리플레이
--    (DAR-385)는 strategyKey=NULL 로 남아 동작이 변하지 않는다. 전략 변형 트랙만 키(event-edge /
--    short-momentum / conservative-value / aggressive-diversified)를 기록한다.

-- 트레이딩 로직 식별 키. 단일 트랙(라이브 리플레이) 행은 NULL.
ALTER TABLE "backtest_runs" ADD COLUMN "strategyKey" TEXT;

-- 전략별 최신 완료 run 조회(비교/거래내역 엔드포인트)용 인덱스.
CREATE INDEX "backtest_runs_strategyKey_idx" ON "backtest_runs"("strategyKey");
