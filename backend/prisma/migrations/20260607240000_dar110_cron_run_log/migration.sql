-- DAR-110: 크론 실행 헬스 로그 (데이터 신선도 모니터 / 수집 안전망, 패널 v5 #5)
-- ★Main Thesis A(수집 안전망): 수집이 조용히 멈추면 신호·수익검증 입력이 통째로 비어도
-- 인지하지 못한다. 자체 로그가 없던 경량 크론(신호생성·모의운용·내부자수집·파싱재처리)의
-- 마지막 성공시각/처리건수를 통일 기록해 freshness/stale 판정의 입력으로 쓴다.
-- 기존 도메인 *CollectionLog(공시·재무·시세) 및 크론 거동은 불변 — 가산 테이블만 추가.
-- AI·실주문·KRX 무관(수집 메타만).
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- CreateTable
CREATE TABLE "cron_run_logs" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "cron_run_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cron_run_logs_jobKey_startedAt_idx" ON "cron_run_logs"("jobKey", "startedAt");

-- CreateIndex
CREATE INDEX "cron_run_logs_jobKey_status_finishedAt_idx" ON "cron_run_logs"("jobKey", "status", "finishedAt");

-- CreateIndex
CREATE INDEX "cron_run_logs_status_idx" ON "cron_run_logs"("status");
