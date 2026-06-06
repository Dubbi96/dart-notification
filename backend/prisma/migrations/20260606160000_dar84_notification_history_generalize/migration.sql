-- DAR-84: 통합 알림 이력 모델 일반화 — NotificationHistory를 공시 전용에서 다형 인박스로 확장
-- 가산형·무파괴: 신규 컬럼은 nullable/기본값, 기존 행은 type=DISCLOSURE·refId=disclosureRcpNo로 백필.
-- 기존 공시 조회/생성 경로 회귀 0 (공시 멱등은 (userId,type,refId)로 재설계, DISCLOSURE+rcpNo == 기존 유니크).
-- ★ 이 마이그레이션은 create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지.
-- AI/실주문 미개입(순수 스키마). 실발송/푸시 파이프라인은 DAR-85 범위.

-- 1) 다형 알림 유형 enum 신규
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('DISCLOSURE', 'SIGNAL', 'EXIT', 'THESIS_VIOLATED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) 가산형 컬럼 추가 (멱등: IF NOT EXISTS)
ALTER TABLE "notification_history" ADD COLUMN IF NOT EXISTS "type" "NotificationType" NOT NULL DEFAULT 'DISCLOSURE';
ALTER TABLE "notification_history" ADD COLUMN IF NOT EXISTS "refId" TEXT;
ALTER TABLE "notification_history" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "notification_history" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "notification_history" ADD COLUMN IF NOT EXISTS "deepLink" TEXT;

-- 3) disclosureRcpNo nullable로 완화 (공시 외 타입 수용)
ALTER TABLE "notification_history" ALTER COLUMN "disclosureRcpNo" DROP NOT NULL;

-- 4) 기존 행 백필 (멱등): type=DISCLOSURE(기본값 적용됨), refId=disclosureRcpNo
UPDATE "notification_history"
SET "refId" = "disclosureRcpNo"
WHERE "refId" IS NULL AND "disclosureRcpNo" IS NOT NULL;

-- 5) 유니크 재설계: (userId, disclosureRcpNo) → (userId, type, refId)
--    공시 행(type=DISCLOSURE, refId=rcpNo)에 대해 기존 제약과 동치 → 중복방지 회귀 0.
DROP INDEX IF EXISTS "notification_history_userId_disclosureRcpNo_key";
CREATE UNIQUE INDEX IF NOT EXISTS "notification_history_userId_type_refId_key"
  ON "notification_history"("userId", "type", "refId");
