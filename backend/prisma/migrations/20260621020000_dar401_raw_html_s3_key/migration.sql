-- DAR-401: 공시 원본 HTML 저장을 S3/객체 스토리지로 고정 — 로컬 디스크 저장/조회 제거.
--
-- 배경(실측): 원본 HTML 은 LocalStorageService 가 fetch 시 로컬 디스크 storage/{rcpNo}/index.html 에
--    쓰고 경로를 rawFilePath 에 기록했다(23GB·58,683건 누적·런타임 미사용 쓰기전용). 앞으로 저장 장소를
--    S3(disclosure-rawhtml/{rcpNo}.html.gz, gzip)로 고정하고 키를 rawHtmlS3Key 포인터에 기록한다.
--
-- ⚠️ create-only — DB 운영 반영(prisma migrate deploy)은 휴먼 승인 사항이다(guard 훅 휴먼 게이트).
--    에이전트 자동 적용 금지.
--
-- 비파괴(순수 가산): rawHtmlS3Key(nullable) 컬럼만 추가한다. 기존 rawFilePath(레거시 로컬 경로) 값은
--    보존된다. 신규 fetch 부터 rawFilePath 는 NULL 로 두고 rawHtmlS3Key 에 S3 키를 기록한다(애플리케이션
--    레벨, 본 마이그레이션과 분리). 기존 23GB 로컬분의 S3 이전은 별도 데이터 마이그레이션이 담당한다.

-- 저장된 원본 HTML 객체 키 포인터. 미저장/레거시 행은 NULL.
ALTER TABLE "disclosure_documents" ADD COLUMN "rawHtmlS3Key" TEXT;
