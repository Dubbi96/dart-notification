-- DAR-122: 모의 포지션 종목당 1행 보장 — 기존 중복 OPEN 정리 + (portfolioId, stockCode) OPEN 부분 유니크.
--
-- 배경: positions 테이블에 (portfolioId, stockCode) OPEN 유니크 제약이 없어, 진입 배치가
-- 동일 종목 복수 신호(복수 공시)에 대해 Position 을 중복 생성했다(예: 코칩 17주 4행).
-- 코드 측 진입 디듑(dedupeCandidatesByCorpCode)과 P2002 backstop 은 이미 반영됐고,
-- 이 마이그레이션이 DB 레벨 백스톱(부분 유니크)과 기존 중복 데이터 정리를 완성한다.
--
-- ★주의: Prisma 스키마는 부분 유니크 인덱스(WHERE 절)를 표현하지 못하므로 이 인덱스는
-- raw SQL 로만 관리된다(schema.prisma Position 모델 주석 참고). `prisma migrate deploy` 적용.

-- 1) 기존 중복 OPEN 포지션 정리: (portfolioId, stockCode) 당 가장 먼저 진입한 1건만 보존.
--    자식(position_daily_snapshots / exit_signals)은 onDelete: Cascade 로 함께 정리된다.
--    PaperTrade 는 Position FK 가 없어 영향 없음.
DELETE FROM "positions" p
USING (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "portfolioId", "stockCode"
           ORDER BY "entryDate" ASC, "createdAt" ASC, "id" ASC
         ) AS rn
  FROM "positions"
  WHERE "status" = 'OPEN'
) dup
WHERE p."id" = dup."id" AND dup.rn > 1;

-- 2) 동일 (portfolioId, stockCode) OPEN 중복 재발을 DB 레벨에서 차단(부분 유니크).
--    CLOSED 포지션은 인덱스에서 제외되므로 청산 후 동일 종목 재진입은 정상 허용된다.
CREATE UNIQUE INDEX IF NOT EXISTS "positions_portfolioId_stockCode_open_key"
  ON "positions" ("portfolioId", "stockCode")
  WHERE "status" = 'OPEN';
