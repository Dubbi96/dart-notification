-- DAR-276: 기업상세 화면 핫쿼리의 where{corpCode}+orderBy{정렬키} 메모리 정렬 해소용 복합 인덱스 2건.
--
-- ① disclosures: findMany 가 where{corpCode}(또는 corpCode IN 관심목록) + orderBy[rcpDt DESC, rcpNo DESC].
--    기존 [corpCode]·[rcpDt]·[corpCode,rcpNo](DAR-214) 단일/부분 인덱스만 있어
--    Postgres 가 [corpCode] 로 필터 후 (rcpDt, rcpNo) 를 힙에서 메모리 정렬했다
--    ([corpCode,rcpNo] 는 rcpNo 순이라 rcpDt 정렬 미지원). 공시 많은 대형사 기업상세서 정렬비용.
--    → (corpCode, rcpDt, rcpNo) 복합 인덱스가 corpCode equality 필터 + (rcpDt,rcpNo) 정렬을
--      동시에 커버한다(ASC btree 역방향 스캔으로 DESC 정렬 서빙). 기존 [corpCode,rcpNo] 는
--      워치리스트 grouped count(용도 상이)라 유지한다.
--
-- ② disclosure_events: findMany 가 where{corpCode?} + orderBy{extractedAt DESC}.
--    [corpCode]·[extractedAt] 따로 있어 동일 메모리 정렬. → (corpCode, extractedAt) 로 필터+정렬 커버.
--
-- 가산형 인덱스(데이터 무변경, 무손실). 쿼리 결과 불변 → 회귀 0. 자연키 rcpNo PK·corpCode FK 불변.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 deploy 사항(prisma/CLAUDE.md). 에이전트 자동 적용 금지.

-- CreateIndex: 기업상세 공시목록 필터+정렬 커버
CREATE INDEX IF NOT EXISTS "disclosures_corpCode_rcpDt_rcpNo_idx" ON "disclosures"("corpCode", "rcpDt", "rcpNo");

-- CreateIndex: 기업별 이벤트목록 필터+정렬 커버
CREATE INDEX IF NOT EXISTS "disclosure_events_corpCode_extractedAt_idx" ON "disclosure_events"("corpCode", "extractedAt");
