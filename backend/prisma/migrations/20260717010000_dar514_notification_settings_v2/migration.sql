-- DAR-514 [Wave A/cross·P0]: 알림 설정 센터 v2 — 계열별 on/off·보수적 기본값·일일 캡.
--
-- 가산형(비파괴) 마이그레이션 — 알림 설정·로그층만 변경(매매 행동 무접점·M10 클록 안전):
--   1) notification_settings 에 신규 2계열 토글(editionPushEnabled/digestPushEnabled) 추가.
--      ★기본 OFF(신규 계열 보수적 기본값). 실제 발송 배선은 Wave B 가 소비(현재 '예약').
--   2) notification_settings 에 dailyPushCap(일일 푸시 상한) 추가 — 기본 30(보수적 상한).
--   3) 푸시 실발송/억제 원장(push_delivery_log) + 상태 enum 신설 — 캡 계산 SSOT + 억제 로그.
--
-- 기존 설정 무손실: 세 컬럼 모두 DEFAULT 로 추가되어 기존 행에 자동 채워진다(수용기준 3).
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행 — 에이전트 자동 적용 금지(guard 훅 휴먼 게이트).

-- 1) 신규 2계열 토글(에디션 발행·다이제스트) — ★기본 OFF(예약 계열).
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "editionPushEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "digestPushEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 2) 사용자별 일일 푸시 캡 — 기본 30(보수적 상한). 면제 계열(RISK/OPS)은 앱레벨에서 캡 미적용.
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "dailyPushCap" INTEGER NOT NULL DEFAULT 30;

-- 3) 푸시 실발송/억제 상태 enum.
CREATE TYPE "PushDeliveryStatus" AS ENUM ('SENT', 'SUPPRESSED_CAP');

-- 3) 푸시 실발송/억제 원장 — 일일 캡 SSOT + 억제 로그(FK 없음·forward-only 감사 이력).
CREATE TABLE "push_delivery_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "refId" TEXT NOT NULL,
    "kstDate" TEXT NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_delivery_log_pkey" PRIMARY KEY ("id")
);

-- 멱등: 통지 1건(userId,type,refId)당 원장 1건 — 잡 재시도에도 중복 카운트 0.
CREATE UNIQUE INDEX "push_delivery_log_userId_type_refId_key" ON "push_delivery_log"("userId", "type", "refId");

-- 캡 카운트(당일 SENT 집계) 조회용.
CREATE INDEX "push_delivery_log_userId_kstDate_status_idx" ON "push_delivery_log"("userId", "kstDate", "status");
