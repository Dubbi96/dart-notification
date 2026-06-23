-- DAR-424: 라이브 페이퍼 체결 알림(매수/매도) — TRADE_ENTRY/TRADE_EXIT.
-- 가산형(비파괴) 마이그레이션:
--   1) NotificationType enum 에 TRADE_ENTRY/TRADE_EXIT 값 추가(ADD VALUE — 기존 row 무영향).
--   2) notification_settings 에 tradePushEnabled 컬럼 추가(기본 ON — 체결 통지 기본 수신).
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행.
--
-- 주의: PostgreSQL 은 동일 트랜잭션에서 ADD VALUE 직후 그 값을 사용할 수 없다.
--   본 마이그레이션은 enum 값을 추가만 하고 사용하지 않으므로(데이터 백필 없음) 안전하다.

-- 1) enum 값 추가(가산형·멱등)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRADE_ENTRY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRADE_EXIT';

-- 2) 체결 알림 토글(기본 ON)
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "tradePushEnabled" BOOLEAN NOT NULL DEFAULT true;
