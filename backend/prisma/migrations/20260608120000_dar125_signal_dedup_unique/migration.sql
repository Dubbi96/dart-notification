-- DAR-125: TradingSignal 원천 중복 제거 (DB 멱등 강화 + 기존 중복 정리)
-- ★ 적용은 휴먼 수동 승인. 이 파일은 커밋만 한다(자동 적용 금지).
--
-- 배경: 신호 생성부는 자연키 (corpCode, rcpNo, eventType, persona) upsert 로 멱등화한다.
-- DisclosureEvent.rcpNo 가 @unique(공시:이벤트 1:1)라 기존 (rcpNo, persona) 유니크와
-- 동치이나, eventType 을 키에 명시해 향후 1:N 확장에도 원천 중복을 차단한다.

-- 1) 기존 중복 정리 (손실 금지: 그룹별 대표 1건 보존).
--    대표 = 최신 createdAt, 동률 시 id 사전순 최대. 나머지 비대표 중복만 삭제.
--    현재 데이터는 기존 (rcpNo, persona) 유니크로 이미 정합 → 일반적으로 0건 삭제(no-op).
--    제약 도입 이전 잔여/레거시 중복에 대한 방어적 안전망이다.
DELETE FROM "trading_signals" t
USING (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "corpCode", "rcpNo", "eventType", "persona"
           ORDER BY "createdAt" DESC, "id" DESC
         ) AS rn
  FROM "trading_signals"
) d
WHERE t."id" = d."id" AND d.rn > 1;

-- 2) 자연키 전체 그레인으로 유니크 강화 (기존 (rcpNo, persona) 대체).
DROP INDEX IF EXISTS "trading_signals_rcpNo_persona_key";
CREATE UNIQUE INDEX "trading_signals_corpCode_rcpNo_eventType_persona_key"
  ON "trading_signals" ("corpCode", "rcpNo", "eventType", "persona");
