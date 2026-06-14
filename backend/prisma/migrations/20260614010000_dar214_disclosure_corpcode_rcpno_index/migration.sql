-- DAR-214: 워치리스트 신규 공시(unread) grouped count 의 조인 조건 서빙용 복합 인덱스.
-- findAll 은 (corpCode, 커서) VALUES 를 disclosures 와 LEFT JOIN 하여
--   d.corp_code = v.corp_code AND d.rcp_no > v.cursor
-- 로 corpCode 별 신규 공시 수를 단일 쿼리로 집계한다(N+1 → 1). 이 조인/범위 조건을
-- (corpCode, rcpNo) 복합 인덱스가 직접 서빙한다(corpCode equality → rcpNo range scan).
-- 기존 단독 (corpCode) 인덱스는 corpCode 만 좁히고 rcpNo 비교는 힙 필터라 비효율.
--
-- 가산형 인덱스(데이터 무변경, 무손실). 자연키 rcpNo PK·corpCode FK 불변. 회귀 0.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 deploy 사항(prisma/CLAUDE.md). 에이전트 자동 적용 금지.

-- CreateIndex: 워치리스트 grouped count 조인용
CREATE INDEX IF NOT EXISTS "disclosures_corpCode_rcpNo_idx" ON "disclosures"("corpCode", "rcpNo");
