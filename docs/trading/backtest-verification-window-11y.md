# 백테스트 검증 창 11년 확장 — 데이터게이트 측정 인프라 (DAR-544)

> 신호 봉인 해제(TrackB 재검증 · 신호 유료화 이중 게이트)의 **데이터 측 선행 조건**.
> 현행 검증 창(≈1년)을 **11년(2015~2026)** 으로 확장해도 재검증(§8.2)·민감도 스윕(§8.4)이
> 신뢰성 있게 완주하도록 하는 **측정 인프라만** 다룬다.
> 정본 절차: `docs/trading/strategy-rulebook.md §8`. AI 자동조정 금지: 동 §8.4.

## 범위 (측정 인프라 한정)

- ★ **전략 파라미터 변경 0**: 손절·익절·보유일·minBuyScore·사이징·한도 등 어떤 전략 값도
  만들거나 바꾸지 않는다. 이 인프라는 **데이터 커버리지 감사**와 **러너 완주**만 담당한다.
- ★ **§8.4 정합**: 리포트·완주 결과를 근거로 파라미터를 **자동 변경하는 경로가 없다**. 반영은
  오직 §8.1 3게이트(정본 문서 개정 → 재검증 → 사람 승인)로만. AI 개입 0.
- ★ **M10 무접촉(불가침)**: 전 경로 **read-only**. `BacktestRun`/`BacktestTrade`/`PaperTrade`
  영속 0 — M10 졸업 측정 트랙·운용 트랙을 건드리지 않는다(읽기·계산만, 룰북 §8.5 클록 보호 준수).
  리포트는 응답으로만 반환하는 휘발 산출물.

## 1. 데이터 커버리지 감사 — 연도별 결측 리포트

`engine3-quant-market/backtest/data-coverage/`

| 파일 | 역할 |
|---|---|
| `data-coverage.ts` | 순수 리포트 빌더(집계 → 연도별 상태·게이트 판정). DB·시각·AI 0. |
| `data-coverage.service.ts` | read-only 집계 질의(가격 `stock_daily_prices` · 공시 `disclosures` 연도 프리픽스 groupBy 2건) + KRX 달력(SSOT `common/time/market-calendar`)의 연도별 기대 거래일·달력 등재 여부 산출. |
| `data-coverage.manual.ts` | 수동 러너. |

- **연도별 산출**: 가격 행수 · 실재 거래일/기대 거래일(**충족률%**, 참고치) · 커버 종목 수 · 공시 행수 · 커버 기업 수 · 연도 상태(`FULL`/`PARTIAL`/`MISSING`).
- **게이트 판정**: 창 전 연도가 `FULL` 가격 커버 + 공시 존재이면 `gateReady=true`(`verdict=READY`). 결측·부분은 `PARTIAL`/`INSUFFICIENT`로 정직 표기.
- ★ **달력 불완전 강건성**: KRX 하드코딩 달력(`KRX_HOLIDAYS`)은 최근 연도만 공휴일을 담아 과거 연도는 기대 거래일이 과대(주말만 제외)다. 그래서 **완전 연도**는 충족률%가 아니라 **실거래일 절대 하한** `FULL_YEAR_MIN_TRADING_DAYS=240`(KRX 연간 실거래일 ≈242~250)으로 판정해 달력 공백을 데이터 결측으로 오판하지 않는다. 달력 미등재 연도는 `coveragePctReliable=false`로 표기.
- **부분 연도**(창/asOf 절단, 예: 진행 중 2026)만 달력 등재 충족률 `FULL_COVERAGE_MIN_PCT=98%`로 판정한다. `asOf`(기본 현재 KST)까지만 기대 거래일을 계상해 미래 거래일을 결측으로 오판하지 않는다.
- ★ 임계값(`240`·`98%`)은 **측정 임계(전략 파라미터 아님)**.

```bash
npx ts-node -r dotenv/config \
  src/engine3-quant-market/backtest/data-coverage/data-coverage.manual.ts [startYear=2015] [endYear=2026]
```

## 2. 백테스트 러너 11년 완주 — 청크 실행 + 성능 처리

`engine3-quant-market/backtest/replay/`

| 파일 | 역할 |
|---|---|
| `caching-price-data.adapter.ts` | 종목당 창 일봉 1회 적재 캐시. 러너의 일자별 `getDailyPrices(stock, day, day)` 질의 팬아웃(종목당 O(거래일))을 O(1)로 접는다. **결과 불변**(내부 어댑터 반환 행을 슬라이스만). |
| `extended-window-replay.service.ts` | 확장 창을 연 단위(설정 가능) 청크로 완주시키는 read-only 오케스트레이터. 청크별 완주 로그(신호·거래·성과·경과·캐시통계) 산출. `executeReplay`(러너+성과, **DB 영속 분리부**) 재사용. |
| `extended-window-replay.manual.ts` | 수동 러너. |

- **성능/메모리 처리**: 11년(≈2,700 거래일)에서 러너가 완주하지 못하는 병목은 **질의 팬아웃**(메모리가 아님)이다. 캐싱 어댑터가 종목당 창 1회 적재로 이를 접고, 청크(연 단위)가 종목별 캐시를 청크 창(≈245행)으로 제한한다.
- **모드**: `chunkYears` ≥ 창 길이 → `MONOLITHIC`(단일 11년 패스, 캐시로 완주 가능). 미만 → `CHUNKED`.
- ★ **청크 경계 주의**: 연 단위 청크는 경계에서 미청산 포지션을 강제청산(`FORCE_EXIT`)한다 → **청크별 성과 합 ≠ 단일 11년창 전략 성과**. 청크 모드는 **완주·성능 프로브**(측정 인프라)이고, 단일창 성과가 필요하면 `MONOLITHIC`을 쓴다.
- 기본 전략은 기존 `DEFAULT_REPLAY_STRATEGY`(시스템 하드룰 트랙) — **새 파라미터 도입 아님**.

```bash
# 연 단위 청크 완주(성능·메모리 상한)
npx ts-node -r dotenv/config \
  src/engine3-quant-market/backtest/replay/extended-window-replay.manual.ts 2015 2026 1
# 단일 11년 패스(캐시 완주, 단일창 성과)
npx ts-node -r dotenv/config \
  src/engine3-quant-market/backtest/replay/extended-window-replay.manual.ts 2015 2026 99
```

## 검증 (DAR-544 DoD)

- `npx tsc --noEmit` 0 · `nest build` 0 · `jest` 그린(신규 23 스펙 포함, 회귀 0).
- 커버리지 리포트 산출(연도별 결측) + 러너 11년 완주 로그(청크별) — 아래 PR 증거.
- **dev DB 주의**: dev/demo DB 수치는 prod 대표값이 아니다(권위 판정 아님). 이 인프라는 창을 완주시키고 결측을 정직하게 드러내는 **측정 도구**이며, 게이트 통과 판정·활성 결정은 통합자·사용자 소관(do-no-harm, §8.1 3게이트).
