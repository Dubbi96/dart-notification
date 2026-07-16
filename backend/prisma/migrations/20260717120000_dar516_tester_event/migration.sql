-- DAR-516 [Wave A/cross·P1]: 테스터 코호트 계측 — 인증 사용자 인앱 행동 이벤트 로깅.
--
-- 가산형(비파괴) 마이그레이션 — 신규 계측 테이블 1개만 추가(기존 스키마 무변경).
--   FunnelEvent(비인증 온보딩 퍼널)의 인증판 형제. 매매 행동 무접점(M10 클록 안전 —
--   engine5 테이블·실주문·킬스위치 미접촉, 읽기 파생 집계만).
--
-- ★ PII 무수집(수용기준 1): userId·event·createdAt(ts) 3필드만. 카드/종목 식별자·자유텍스트·
--   기기정보 미저장. 오픈율·재방문 집계는 createdAt→KST일 파생(AT TIME ZONE)으로 산출한다.
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행 — 에이전트 자동 적용 금지(guard 훅 휴먼 게이트).

-- 테스터 코호트 인앱 행동 이벤트 원장 — forward-only 감사 이력(FK 없음).
CREATE TABLE "tester_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tester_events_pkey" PRIMARY KEY ("id")
);

-- 사용자별 이벤트 시계열(재방문 = 활동일 ≥2 판정) 조회용.
CREATE INDEX "tester_events_userId_createdAt_idx" ON "tester_events"("userId", "createdAt");

-- 이벤트 종류별 집계(오픈율·이벤트별 카운트) 조회용.
CREATE INDEX "tester_events_event_createdAt_idx" ON "tester_events"("event", "createdAt");
