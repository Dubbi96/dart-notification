-- DAR-563 [APK트리아지·BE]: 알림 뱃지 seen/read 이원화 — User.notificationsLastSeenAt 추가.
--
-- 배경: 알림 뱃지가 isRead:false 전건수라 '탭 열람=확인' 개념이 없어 99+가 영구 누적됐다(§1-5b).
--    행 하이라이트(isRead)는 그대로 두고, 뱃지만 이 컬럼(마지막 알림탭 방문 시각) 기준
--    sentAt > notificationsLastSeenAt 신규 건수로 재정의한다(POST /notifications/seen 이 갱신).
--
-- 비파괴(순수 가산): nullable 컬럼 1개 추가, 기본값 없음 — 기존 행 전부 NULL(무손실).
--    NULL = 미방문 취급(서비스 레이어에서 전체 이력을 신규로 간주) — 데이터 마이그레이션 불요.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다. 에이전트 자동 적용 금지.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "notificationsLastSeenAt" TIMESTAMP(3);
