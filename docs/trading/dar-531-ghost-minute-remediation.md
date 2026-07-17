# DAR-531 — 개장 직후 유령 분봉 오염 데이터 정리 제안 (PM 승인 경유)

> **상태: 제안(PROPOSED) — 실행 보류.** 아래 정리(minute 봉 정정·유령 진입 무효화)는 **M10 측정 정본에
> 영향**하므로, **PM/오너 승인 전에는 어떤 쓰기(DELETE/UPDATE)도 실행하지 않는다.** 본 문서는 식별
> 쿼리(read-only)와 정리 옵션·근거를 확정해 승인 판단 자료를 제공한다. 코드 재발 방지(수집 거부·스캐너
> 미래봉 가드·경보 dedupe)는 별개 PR 로 이미 봉인됨(승인 불요).

## 1. 무엇이 오염됐나 (2026-07-17 prod)

개장 2분 뒤(09:02 KST) 스캘프 트랙이 **미래 타임스탬프 충족봉** 기반으로 5건 진입했다:

| 종목 | 진입 로그 | 충족봉 ts(UTC) | 정황 |
|---|---|---|---|
| 005930 | `[Scalp] 진입 005930 1주 @259000` | `2026-07-17T11:49:00Z` | 미래봉 |
| 034020 | `[Scalp] 진입 034020 4주 @70100` | `2026-07-17T14:15:00Z` | 미래봉 |
| 189330 | `[Scalp] 진입 189330 33주 @9010` | `2026-07-17T11:32:00Z` | 즉시 `청산 ts 보정 09:02→11:32 STOP_LOSS` |
| (외 2건) | `진입 사이클 … 진입=5` | 미래 | — |

**근본**: 09:05 분봉 수집이 `신규적재=37,536행`(96종목×약 390봉 = 하루치 전체)을 tradeDate=20260717
로 적재. 개장 5분 시점에 하루치가 있을 수 없다 → **KIS 가 당일 분봉 미형성 상태에서 전일(7/16) 세션
전체를 반환**했고, 수집기가 봉 자신의 영업일(`stck_bsop_date`)을 검증하지 않고 tradeDate=오늘으로
오라벨 적재했다(기지의 "환경시계 vs KIS 실데이터일" 함정 재발, DAR-414/444 가드의 커버리지 구멍).

## 2. 오염 식별 (read-only — 실행 안전)

`ts`·`entryTs`·`createdAt` 는 모두 naive timestamp 다. `ts`(=`entryTs`)는 **KST 벽시계를 UTC 컴포넌트에
담은 naive instant**(`minuteTimestamp` SSOT)라, 그 봉의 실제 UTC instant = `ts − 9h`. `createdAt` 은 실
UTC instant. 정상 봉은 **`createdAt ≥ ts − 9h`**(봉 시각에 도달한 뒤에 수집·적재). **`createdAt < ts − 9h`**
는 "봉이 생기기도 전에 적재된" 물리적으로 불가능한 미래봉 = 오라벨 유령봉이다.

### 2.1 오염 분봉 (stock_minute_prices)
```sql
-- 개장 직후 전일 오라벨로 미래 시각에 둔갑한 봉(불가능-미래) 카운트.
SELECT count(*) AS ghost_minute_rows
FROM stock_minute_prices
WHERE "tradeDate" = '20260717'
  AND "createdAt" < "ts" - INTERVAL '9 hours';

-- 상세(시각 분포 확인용).
SELECT "stockCode", "ts", "createdAt"
FROM stock_minute_prices
WHERE "tradeDate" = '20260717'
  AND "createdAt" < "ts" - INTERVAL '9 hours'
ORDER BY "ts"
LIMIT 50;
```

### 2.2 유령 진입(모의 포지션) (intraday_scalp_trades)
```sql
-- 미래 충족봉 기반 진입(진입 시각이 생성 시각보다 미래).
SELECT id, "stockCode", "tradeDate", "entryTs", "createdAt", status, "exitReason", "netPnl"
FROM intraday_scalp_trades
WHERE "tradeDate" = '20260717'
  AND "createdAt" < "entryTs" - INTERVAL '9 hours'
ORDER BY "entryTs";
-- 기대: 5행(005930·034020·189330 포함). 189330 은 즉시 STOP_LOSS 청산(CLOSED)일 수 있음.
```

> **경계 caveat**: 09:00~09:04 대역의 오라벨봉은 같은 시각의 정상 조기봉과 구분 불가라 위 조건에 안 걸릴 수
> 있다(소수·무해). 물질적 오염(09:05~15:30 미래봉·5건 진입)은 전부 포착된다. 정밀 필요 시 09:05 수집 배치의
> `createdAt` 구간(예: `date_trunc('minute',"createdAt")` = 그 배치 시각)으로 교차 확인.

## 3. 정리 옵션 (실행은 PM 승인 후)

### 3.1 오염 분봉 — 권고: DELETE
전일(7/16) 실봉은 tradeDate=20260716 로 **별도 정상 적재**되어 있어 삭제해도 실데이터 소실 0(분봉은
forward-only·소급 백필 불가지만 이 행들은 7/16 의 중복 오라벨본). 미래봉이 남아 있으면 이후 스캐너
가드(코드)로 진입은 막히나 조회·통계에 잔존하므로 정정 권장.
```sql
-- ★PM 승인 후에만. 실행 전 SELECT count(*) 로 대상 수 재확인(멱등: 재실행 시 0행).
DELETE FROM stock_minute_prices
WHERE "tradeDate" = '20260717'
  AND "createdAt" < "ts" - INTERVAL '9 hours';
```

### 3.2 유령 진입 5건 — PM 판정 필요(M10 측정 정본 영향)
이 5건은 **미래봉이라는 존재하지 않은 신호**로 발생한 가짜 체결이다. M10 측정에서 제거/무효화해야
승률·손익·표본이 오염되지 않는다. 판정 옵션:

- **옵션 A(권고) — 하드 삭제**: 5행 DELETE. 애초에 유효하지 않은 체결이라 이력 연속성 훼손 아님.
  ```sql
  -- ★PM 승인 후에만. 위 2.2 SELECT 로 id 확정 후 그 id 집합만 삭제(범위 오삭제 방지).
  DELETE FROM intraday_scalp_trades
  WHERE "tradeDate" = '20260717'
    AND "createdAt" < "entryTs" - INTERVAL '9 hours';
  ```
- **옵션 B — 소프트 무효화**: 스키마에 soft-void 컬럼이 없어(현재 status=OPEN|CLOSED 뿐) 추가 마이그레이션
  필요 → 단순 사고 정리엔 과함. 감사 추적을 반드시 남겨야 한다면 채택.
- **옵션 C — 방치**: 코드 가드로 재발은 막히나 이미 적재된 5건이 M10 통계에 남음 → **비권고**(측정 오염 잔존).

**권고: 3.1 DELETE + 3.2 옵션 A.** 단, **M10 측정 정본 영향이므로 실행 승인·시점은 PM/오너가 결정.**

## 4. 실행 절차 (승인 후)
1. dev/staging 스냅샷에 먼저 적용 → 2절 카운트가 0 으로 수렴하는지·회귀 없는지 확인.
2. prod 는 백업(`dart-db-backups`) 후 적용. 쓰기 쿼리는 트랜잭션으로 감싸고 실행 전 `SELECT count(*)` 재확인.
3. 적용 후 재확인 쿼리(2.1/2.2)가 0 행인지 검증하고 결과를 이슈에 첨부.
4. **재발 방지 코드(수집 실데이터일 거부·스캐너 미래봉 하드가드·경보 dedupe)는 별도 PR 로 선반영** —
   본 정리는 과거 오염 1회성 청소이며 코드 배포와 독립.

## 5. 재발 방지 (코드·이 이슈 PR)
- **수집 거부**: `stock-minute-price.collector.ts` `persistCandles` — 봉의 `stck_bsop_date`(KIS 원응답)이 요청
  거래일과 다르면 적재 거부(`rejectedByDate` 정직 로그). `KisMinuteCandle.tradeDate` 필드 신설·파싱.
- **스캐너 미래봉 하드가드**: `scanEntrySignals(…, nowMs)` — `ts > now(KST)` 봉을 신호 대상에서 제외
  (prefix 절단·커서 정합). engine5 `runEntryCycle` 이 `now + 9h`(naive KST) 경계를 주입.
- **경보 dedupe**: `auto-kill:<track>` OPS_ALERT 를 에스컬레이션 전환 1회만 발행(§7.7·10분 스팸 차단).
- **AI 금지영역 불가침**: Risk 하드룰(`checkRisk`·`checkAutoKill` 임계·`activate()`) 무변경 — 수집·스캐너·알림
  계층에서만 해결. 측정 SHADOW 중립성 유지.
