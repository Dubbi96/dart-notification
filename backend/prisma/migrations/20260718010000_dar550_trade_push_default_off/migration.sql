-- DAR-550 [BE·P1·오너결정]: 공개 코호트 트레이딩 알림 차단 — 체결 계열 기본값 가드.
--
-- 오너 결정(트레이딩 표면 첫 게시 제외): 체결(TRADE_ENTRY/TRADE_EXIT) 푸시가 공개(Play)
-- 사용자에게 기본 발송되지 않도록, notification_settings.tradePushEnabled 의 컬럼 기본값을
-- ON(true) → ★OFF(false) 로 전환한다.
--
-- 비파괴(무손실) 보장 — ★기존 사용자 설정 무손실(수용기준 2):
--   * SET DEFAULT 만 변경한다. 기존 row 의 저장값은 재기록하지 않는다(백필 UPDATE 없음).
--     → tradePushEnabled=true 로 이미 켜 둔 기존 사용자는 그대로 켜진 채 유지된다.
--   * 신규 INSERT(가입 시 notificationSettings 생성)에서 컬럼을 생략하면 새 기본값 false 가
--     적용된다 → 신규 가입자 기본 OFF(수용기준 1). 애플리케이션(auth.service)도 가입 경로에서
--     tradePushEnabled:false 를 명시해 DB 기본값과 이중으로 보장한다.
--
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행 — 에이전트 자동 적용 금지(guard 훅 휴먼 게이트).

ALTER TABLE "notification_settings"
  ALTER COLUMN "tradePushEnabled" SET DEFAULT false;
