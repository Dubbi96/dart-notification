-- DAR-323: 신호 억제 사유(suppressionReason) 영속 — '왜 강한 신호가 아닌지' 가독성·정직성.
-- A1(DAR-321) 이후 omittedBuckets 가 의미를 가지면서, BUY 미만 신호가 '근거 부족'으로
-- 약한지 '정직하게 약한지'를 사용자가 구분할 수 있도록 도출 enum 을 영속한다.
--   EVENT_STUDY_DARK | INDICATORS_MISSING | UNMODELED_EVENT | NO_POLARITY | GENUINELY_NEUTRAL
-- 점수 산식·등급 임계값 불변(Rule 금지영역). 순수 파생 표시값.
--
-- 가산형 nullable 컬럼 — 기존 행은 모두 null(미도출)로 무손실 보존. BUY 이상·BLOCKED 도 null.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 deploy 사항(prisma/CLAUDE.md). 에이전트 자동 적용 금지.

-- AlterTable: 억제 사유 컬럼 추가
ALTER TABLE "trading_signals" ADD COLUMN IF NOT EXISTS "suppressionReason" TEXT;
