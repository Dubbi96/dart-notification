-- DAR-85: 신호·청산·논리훼손 푸시 토글 추가 (notification_settings)
-- 가산형·무파괴: 신규 컬럼은 기본값 false(★기본 OFF — 스팸 차단·안전). 기존 행/경로 회귀 0.
-- 토글 OFF면 NotificationHistory(인박스) 기록만, 실발송 미수행.
-- ★ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지.
-- AI/실주문 미개입(순수 스키마). 알림→실주문/Kill 직결 없음.

ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "signalPushEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "exitPushEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "thesisPushEnabled" BOOLEAN NOT NULL DEFAULT false;
