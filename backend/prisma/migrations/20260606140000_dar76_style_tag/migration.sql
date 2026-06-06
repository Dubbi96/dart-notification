-- DAR-76: 철학 스타일별 모의 포트폴리오 분기 운용 — styleTag 가산형 컬럼 추가
-- 가산형(nullable) — 기존 단일 시뮬 데이터는 NULL 유지 → 회귀 0. AI 미개입(순수 스키마).
-- ★ 적용은 휴먼 수동 실행(에이전트는 마이그레이션 적용 명령 미실행).

-- paper_trades.styleTag
ALTER TABLE "paper_trades" ADD COLUMN "styleTag" TEXT;
CREATE INDEX "paper_trades_styleTag_idx" ON "paper_trades"("styleTag");

-- position_daily_snapshots.styleTag
ALTER TABLE "position_daily_snapshots" ADD COLUMN "styleTag" TEXT;
CREATE INDEX "position_daily_snapshots_styleTag_idx" ON "position_daily_snapshots"("styleTag");
