-- DAR-474: 슬리피지 측정 표면 — 신호시점 기대가(expectedPrice) 보존.
-- 체결기(fillPendingEntries)가 entryPrice를 체결일 시가로 덮어써 신호시점 기대가가 소실되던 문제를
-- 해소하기 위한 additive nullable 컬럼. 기존 행은 NULL(측정은 신규 예약·체결부터 유효, graceful).
-- ★기록·측정 전용 — 체결 로직/가격 시맨틱 무변경. 백필 없음.
ALTER TABLE "paper_trades" ADD COLUMN "expectedPrice" DECIMAL(12,2);
