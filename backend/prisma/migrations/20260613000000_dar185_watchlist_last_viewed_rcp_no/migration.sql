-- DAR-185: 워치리스트 신규 공시 unread 집계를 rcpDt(일 단위) → rcpNo(접수번호) 커서로 전환.
-- 마지막으로 본 공시의 rcpNo 를 저장해, 같은 날 이후 들어온 공시도 정확히 신규로 집계한다.
-- 가산(nullable, 무손실) 컬럼이라 기존 행에 영향이 없다.
ALTER TABLE "watch_lists" ADD COLUMN "lastViewedRcpNo" TEXT;
