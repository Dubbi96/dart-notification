-- DAR-399: 공시 파싱 표(disclosure_documents.tables JSONB) S3/객체 스토리지 오프로드 — DB 경량화.
--
-- 배경(실측): rawText 전량 오프로드 후에도 disclosure_documents 1.7GB 잔존. 분해 결과 TOAST 의
--    진짜 bulk 는 rawText 가 아니라 tables JSONB(~1.6GB, 58k 문서)였다. parsedJson 은 ~5MB(콜드 아님).
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): tablesS3Key(nullable) 컬럼만 추가한다. 기존 tables 데이터는 보존된다.
--    오프로드 드레이너가 백그라운드로 tables → 객체 스토리지 이전 후 tables 컬럼을 비운다(애플리케이션
--    레벨, 본 마이그레이션과 분리). 디스크 회수는 운영 VACUUM 단계(docs/deployment.md 참조).

-- 오프로드된 tables 객체 키 포인터. 미오프로드 행은 NULL(tables 컬럼이 표 보유).
ALTER TABLE "disclosure_documents" ADD COLUMN "tablesS3Key" TEXT;
