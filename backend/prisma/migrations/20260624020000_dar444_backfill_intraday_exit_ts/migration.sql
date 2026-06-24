-- DAR-444: 분봉 단타 과거 거래이력 청산 시각 백필 (데이터 전용 · 스키마 무변경)
--
-- 배경: DAR-435(#383) 이전 구코드는 청산 시각을 `exitTs = new Date()`(진짜 UTC instant)로
--   영속했다. timestamp(no tz) 컬럼에는 UTC 벽시계 컴포넌트가 그대로 저장되므로, KST 10:22 청산이
--   `2026-06-24 01:22:00.xxx`(장외 01시·밀리초 fraction)로 남았다 → 거래이력 카드에 00·01시 매도
--   표시 + exitTs<entryTs(역전). 신규 거래는 DAR-435 가 naive-KST 로 통일했고 DAR-444 가드레일이
--   재발을 봉인하지만, restore 된 과거 행은 1회성 백필이 필요하다.
--
-- 보정 규약(가드레일 sealScalpExitTimebase 와 동일): UTC-naive 로 저장된 exitTs 에 +9h 를 더해
--   naive-KST(UTC 컴포넌트 = KST 벽시계)로 환산한 뒤, 장중 경계 [max(entryTs, 09:00), 15:30] 로
--   clamp 한다. holdMinutes 도 (exitTs − entryTs)/60 으로 재계산. entryTs 는 분봉 충족봉(장중)이라
--   하한으로 안전하다.
--
-- 멱등성: 보정 대상은 '장외(시각 09~15시 밖) 또는 역전(exitTs<entryTs)' 행뿐이다. 보정 후에는
--   장중·진입 이후가 보장되어 재실행 시 WHERE 에 매칭되지 않는다.

UPDATE "intraday_scalp_trades" AS t
SET
  "exitTs" = c.exit_ts,
  "holdMinutes" = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (c.exit_ts - t."entryTs")) / 60))::int
FROM (
  SELECT
    s.id,
    LEAST(
      GREATEST(
        s."exitTs" + interval '9 hours',                                  -- UTC → naive-KST 환산
        s."entryTs",                                                       -- 하한: 진입 이후
        date_trunc('day', s."entryTs") + interval '9 hours'               -- 하한: 09:00 KST
      ),
      date_trunc('day', s."entryTs") + interval '15 hours 30 minutes'      -- 상한: 15:30 KST
    ) AS exit_ts
  FROM "intraday_scalp_trades" s
  WHERE s."styleTag" = 'intraday-scalp'
    AND s."status" = 'CLOSED'
    AND s."exitTs" IS NOT NULL
    AND (
      EXTRACT(HOUR FROM s."exitTs") NOT BETWEEN 9 AND 15  -- 장외 시각
      OR s."exitTs" < s."entryTs"                          -- 진입>청산 역전
    )
) AS c
WHERE t.id = c.id;
