-- DAR-338: DAR-346 후속 — OTHER 재누적분 분류 확대
-- 라이브 DisclosureEvent eventType=OTHER(NEEDS_REVIEW) 15530건 reportName 재조사 →
-- 기존 룰 미커버 12027건(701종) 상위 유형 4종 신규 추가.
-- 가산형(ADD VALUE) 마이그레이션. PostgreSQL enum 값 추가는 비파괴적이며 기존 row에 영향 없음.
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행. 적용 후 OTHER 이벤트 reprocess 시 재분류된다.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'REGULATORY_ADMIN_NOTICE';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'VALUE_UP_PLAN';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'EARNINGS_PREANNOUNCEMENT';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'VOLUNTARY_MANAGEMENT_DISCLOSURE';
