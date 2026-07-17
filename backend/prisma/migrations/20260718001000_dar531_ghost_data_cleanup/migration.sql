-- DAR-531 유령 데이터 1회성 정리 — 오너 승인(2026-07-17 "정리합시다") 집행.
-- 정본: docs/trading/dar-531-ghost-minute-remediation.md §3.1 + §3.2 옵션 A(권고안 그대로).
--
-- 가드: "봉이 생기기도 전에 적재됨"(createdAt < ts − 9h) — 물리적으로 불가능한 행만 대상.
--   ts/entryTs 는 KST 벽시계를 담은 naive instant(실 UTC = ts − 9h), createdAt 은 실 UTC.
--   정상 데이터는 조건을 절대 만족할 수 없어 오삭제 불가·재실행 시 0행(멱등).
-- 재발 방지 코드(수집 실데이터일 거부·스캐너 미래봉 하드가드)는 PR #509 로 선반영됨.
-- 7/16 실봉은 tradeDate=20260716 으로 정상 별도 적재 — 본 삭제로 실데이터 소실 0.

-- §3.1 오염 분봉(전일 오라벨 미래봉) 삭제
DELETE FROM stock_minute_prices
WHERE "tradeDate" = '20260717'
  AND "createdAt" < "ts" - INTERVAL '9 hours';

-- §3.2 옵션 A: 미래 충족봉 기반 유령 진입(모의 체결) 삭제 — M10 측정 무결성 복원
DELETE FROM intraday_scalp_trades
WHERE "tradeDate" = '20260717'
  AND "createdAt" < "entryTs" - INTERVAL '9 hours';
