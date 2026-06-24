-- DAR-433: 진입가↔청산평가 cross-source 가짜손절 차단 — 진입 시세 소스 영속.
-- 가산형(비파괴) 마이그레이션:
--   positions 에 entryPriceSource(nullable TEXT) 컬럼 추가. 진입가가 어느 소스로 기록됐는지
--   (REALTIME|REAL|SYNTHETIC)를 보존해, 청산/평가가 진입과 다른 소스(예: 진입=정체 일봉 REAL ↔
--   청산=실시간 REALTIME)로 떨어지는 cross-source 갭 가짜손절을 평가 시 진입 소스로 정렬해 막는다.
--   기존 row 는 NULL(레거시) → 정렬 가드 면제(기존 동작 보존·회귀 0).
-- 적용(prisma migrate deploy)은 사용자/운영 승인 후 수행.

ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "entryPriceSource" TEXT;
