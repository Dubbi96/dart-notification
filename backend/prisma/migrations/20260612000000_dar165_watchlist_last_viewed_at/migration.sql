-- DAR-165: 워치리스트 신규 공시 unread 배지
-- 사용자가 종목을 마지막으로 조회한 시각을 추적해 그 이후 신규 공시 수(unread)를 파생한다.
ALTER TABLE "watch_lists" ADD COLUMN "lastViewedAt" TIMESTAMP(3);
