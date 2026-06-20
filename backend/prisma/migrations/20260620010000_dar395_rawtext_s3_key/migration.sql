-- DAR-395: 공시 원문(disclosure_documents.rawText) S3/객체 스토리지 오프로드 — DB 경량화.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): rawTextS3Key(nullable) 컬럼만 추가한다. 기존 rawText 데이터는 보존된다.
--    오프로드 드레이너가 백그라운드로 rawText → 객체 스토리지 이전 후 rawText 컬럼을 비운다(애플리케이션
--    레벨, 본 마이그레이션과 분리). 디스크 회수는 운영 VACUUM 단계(docs/deployment.md 참조).

-- 오프로드된 원문 객체 키 포인터. 미오프로드 행은 NULL(rawText 컬럼이 원문 보유).
ALTER TABLE "disclosure_documents" ADD COLUMN "rawTextS3Key" TEXT;
