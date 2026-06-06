-- DAR-91: calibration → 라이브 신호 confidence 자기보정 피드백 루프 (engine3)
-- 백테스트가 드러낸 등급별 실현 적중률 괴리를 라이브 신호 confidence 로 환류한다.
-- ★ 점수/confidence 한정 — 실주문·자동승인과 무연결(안전3원칙). 원본 buyScore·임계값 불변.
-- 가산형 nullable: 보정 미적용(계수 1.0 폴백)·기존 행은 NULL. 자연키(rcpNo,persona) 정합.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- AlterTable: TradingSignal 에 calibratedConfidence(-100~100 정수) 가산 (nullable)
ALTER TABLE "trading_signals" ADD COLUMN IF NOT EXISTS "calibratedConfidence" INTEGER;
