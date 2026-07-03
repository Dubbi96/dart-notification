-- DAR-473(P01): 리스크·운영 알림 채널 신설 — RISK_ALERT/OPS_ALERT.
-- 가산형(비파괴) 마이그레이션 — 관측·알림·데이터층만 변경(매매 행동 무접점·M10 클록 안전):
--   1) NotificationType enum 에 RISK_ALERT/OPS_ALERT 값 추가(ADD VALUE — 기존 row 무영향).
--   2) notification_settings 에 opsPushEnabled 컬럼 추가(기본 ON — 운영 알림 기본 수신).
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행.
--
-- 주의: PostgreSQL 은 동일 트랜잭션에서 ADD VALUE 직후 그 값을 사용할 수 없다.
--   본 마이그레이션은 enum 값을 추가만 하고 사용하지 않으므로(데이터 백필 없음) 안전하다.

-- 1) enum 값 추가(가산형·멱등)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RISK_ALERT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OPS_ALERT';

-- 2) 리스크·운영 알림 토글(기본 ON)
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "opsPushEnabled" BOOLEAN NOT NULL DEFAULT true;
