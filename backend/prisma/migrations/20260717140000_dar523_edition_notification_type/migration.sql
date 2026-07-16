-- DAR-523(Wave B/B2·P0): 일일 에디션 발행 푸시 — NotificationType 에 EDITION 값 추가.
-- 가산형(비파괴) 마이그레이션 — 알림·데이터층만 변경(매매 행동 무접점·M10 클록 안전):
--   1) NotificationType enum 에 EDITION 값 추가(ADD VALUE — 기존 row 무영향).
-- 신규 테이블·컬럼 없음(발송 상태는 기존 push_delivery_log·notification_history 재사용).
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행.
--
-- 주의: PostgreSQL 은 동일 트랜잭션에서 ADD VALUE 직후 그 값을 사용할 수 없다.
--   본 마이그레이션은 enum 값을 추가만 하고 사용하지 않으므로(데이터 백필 없음) 안전하다.

-- 1) enum 값 추가(가산형·멱등)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EDITION';
