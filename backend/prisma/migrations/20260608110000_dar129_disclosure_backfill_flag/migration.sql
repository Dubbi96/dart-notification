-- DAR-129: 과거 공시 전체 백필 → 분석 baseline (라이브 신호 격리)
-- Disclosure 에 isBackfill 표식 컬럼 가산. true = 추이/분석 baseline 용도로만 적재된 과거 공시.
-- ★ 라이브 신호 생성·신호 피드·푸시 알림에서 절대 제외(불가침). Event Study·통계·백테스트는 백필 포함 전체 사용.
-- 가산형 boolean default false: 기존 행은 모두 false(라이브 취급) → 회귀 0. 자연키 rcpNo PK 불변.
-- isBackfill 단독 인덱스: 신호생성 후보 이벤트의 relation 필터(disclosure.isBackfill=false) 조회 성능용.
-- ⚠️ create-only — DB 반영(적용)은 휴먼 승인 사항. 에이전트 자동 적용 금지. node_modules add 금지.

-- AlterTable: disclosures 에 isBackfill(boolean) 가산 (default false)
ALTER TABLE "disclosures" ADD COLUMN IF NOT EXISTS "isBackfill" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: 신호생성·신호피드 백필 제외 필터 조회용
CREATE INDEX IF NOT EXISTS "disclosures_isBackfill_idx" ON "disclosures"("isBackfill");
