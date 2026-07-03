# 전략 룰북 — 매매 트랙 규칙 정본 (SSOT)

> **위치**: 견고화 계획 P06(정본: `docs/roadmap/cc-trading-robustness-plan-2026-07-03.md §4`, PR #441).
> **범위**: 현행 매매 트랙 전수(시스템 모의 1 + 전략 변형 4 + 분봉 단타 1 + 철학 스타일 4 = **10 트랙**)의
> **진입·청산·사이징·한도 전값**을 한 곳에 통합한다.
> **AI 금지영역 불가침**: 이 문서가 다루는 모든 진입·청산·사이징·리스크 규칙은 **순수 Rule**(engine3 시세·지표 / engine5 리스크)이다. AI/LLM(engine2)은 이 규칙 결정에 개입하지 않는다.

---

## 0. 이 문서의 지위 — 정본과 구현의 관계

- **정본 = 이 문서. 코드 상수는 이 문서의 구현이다.** 향후 규칙 값의 기준(authoritative source)은 이 문서다.
- **설립 시점(2026-07-03)의 값은 코드에서 무보정 전사했다.** 룰북 발효 이전까지 유일한 완전 정본은 코드 상수였고
  문서는 흩어진 stale 미러였으므로, 이 문서는 **현재 코드 상수를 진실로 보고 그대로 옮겼다**(임의 보정 0).
  각 값에는 대조 가능한 **코드 포인터**(파일·상수명)를 병기해 문서↔코드 동기화를 감사 가능하게 한다.
- **발효 이후 변경 절차(→ §8)**: 규칙 변경은 **① 이 문서 개정 → ② 재검증(백테스트/재검증 프로토콜) →
  ③ 사람 승인** 을 거친 뒤에만 코드 상수에 반영한다. **문서 개정·승인 없이 코드 상수만 바꾸는 것을 금지**한다.
  이 원칙의 정식 의무 조항·인용 규정은 **§8(변경 절차)**에 명문화한다(P07, DAR-478).
- **신규 트랙 선기재(P06 원칙)**: 향후 신규 트랙(Wave 1 코어·위성 등)의 진입/청산/사이징/한도 룰은 **구현 착수 전
  이 문서 §9(Wave 1)에 먼저 기재**한다. 코드가 문서를 앞서지 않는다. → §9 참조.
- **M10 클록 보호**: 측정 중인 트랙(시스템 모의·전략 4종·철학 4종·분봉 단타)의 **매매 행동 값은 이 문서로 변경하지
  않는다**. 이 문서는 현재 코드 값을 서술·통합할 뿐, 값을 조정하지 않는다(측정 트랙 무수정).

---

## 1. 공통 규약

| 항목 | 값 | 출처(코드/문서) |
|---|---|---|
| 초기 가상원금(전 트랙) | **10,000,000 KRW** | `STRATEGY_INITIAL_CAPITAL` · `PaperSimulationService.INITIAL_CAPITAL` · `SCALP_INITIAL_CAPITAL` (모두 10_000_000) |
| 진입 체결 — 시스템 모의·백테스트 리플레이 | **예약 → 다음 거래일 시가**(`NEXT_OPEN`) — 공시 당일 체결 금지(lookahead bias 방지). 리플레이는 시가에 슬리피지 반영 | `StrategyParams.entryRule='NEXT_OPEN'` · `backtest-runner.service.ts:130` · engine5 CLAUDE.md §"진입 규칙" |
| 진입 체결 — 철학 스타일·전략 forward | **결정 당일 최근 종가 즉시체결**(예약 없음) — ★후속 "결정 → 익일 시가"(α) 규약으로 통일 예정(코드 주석 명시) | `philosophy-style-simulation.service.ts:269 latestClose` · `strategy-forward-simulation.service.ts:338 latestClose`(헤더 :22–23 α) |
| 장마감(15:30) 후 공시(`NEXT_OPEN` 트랙 한정) | +2 거래일 시가 진입 | engine5 CLAUDE.md §"진입 규칙" |
| 장외 체결 의미론(시스템 모의) | 19:30 사이클은 **주문 결정만**(매수 PENDING 예약·청산 판정) → 체결은 장중 첫 유효 틱 또는 19:30 폴백이 **당일 시가**로 수행. 미체결 예약은 이월(≤3거래일 초과 시 CANCELLED) | `PENDING_ENTRY_MAX_CARRY_TRADING_DAYS=3` · `docs/workflow.md §6.10` |
| 실주문 | **0** — 모든 체결은 `simulateFill`(순수 시뮬). 증권사 주문 API 호출·OrderRequest 실사용 0(M11 실주문 루프 미연동) | engine5 CLAUDE.md §"절대 규칙" |
| 승률 정의(전 표면 통일) | 순손익>0 거래 / 전체 청산 거래. 본전(0)은 분모만, 패는 순손익<0만 | api-spec §18.1 |

---

## 2. 전 트랙 요약 매트릭스

> 값은 코드 상수의 무보정 전사다. 트랙별 상세·근거·코드 포인터는 §3~§6 참조.
> 사이징 열: **점수가중**=`SCORE_WEIGHT`, **균등**=`EQUAL_WEIGHT`, **등급×점수**=등급계수×buyScore가중(`entryBudgetScored`, 시스템 모의 전용, §3.1),
> **등급 계수만**=`entryBudget`(등급계수만·buyScore 가중 미적용, 철학 스타일, §6.1).
> ★ 익절/손절/최대보유 열(일봉 트랙): 시스템 모의·철학·전략 forward에서 이 값들은 **단일 하드룰이 아니라 engine4 합성
> Exit Score(6-트리거)의 하드 오버라이드 보장선**이다(§3.2). 전략 4종의 **백테스트 리플레이(§18)**에서는 리터럴 청산 트리거다(§4).

### 2.1 일봉 트랙 (시스템 모의 · 전략 변형 4종 · 철학 스타일 4종)

| # | 트랙 | key | 진입 기준 | 익절 | 손절 | 최대보유 | 사이징 | 최대 종목 |
|---|---|---|---|---|---|---|---|---|
| 1 | 시스템 모의 | `paper-simulation` | 등급 ≥ WATCH **AND** entryReady=true (슬롯 여유 시 buyScore ≥ 50 폴백) | **+20%** | **−8%** | **20거래일** | 등급×점수 | **50** |
| 2 | 이벤트엣지 | `event-edge` | robust 양(+)-edge 이벤트 동적 선별 · 매수점수 **≥35** | **+20%** | **−10%** | **20거래일** | 점수가중 | **20** |
| 3 | 단기모멘텀 | `short-momentum` | 매수점수 **≥40**(상위 ~3%) | **+10%** | **−5%** | **5거래일** | 균등 | **20** |
| 4 | 보수가치 | `conservative-value` | 매수점수 **≥50**(상위 ~0.6%) | **+20%** | **−10%** | **20거래일** | 점수가중 | **10** |
| 5 | 공격분산 | `aggressive-diversified` | 매수점수 **≥30**(상위 ~6.6%, 하한) | **+20%** | **−8%** | **20거래일** | 균등 | **50** |
| 6 | 철학 버핏 | `BUFFETT` | 등급 ≥ WATCH **AND** philosophy-fit **≥50** | **+20%** | **−8%** | **20거래일** | 등급 계수만 | **50** |
| 7 | 철학 린치 | `LYNCH` | 등급 ≥ WATCH **AND** philosophy-fit **≥50** | **+20%** | **−8%** | **20거래일** | 등급 계수만 | **50** |
| 8 | 철학 그린블라트 | `GREENBLATT` | 등급 ≥ WATCH **AND** philosophy-fit **≥50** | **+20%** | **−8%** | **20거래일** | 등급 계수만 | **50** |
| 9 | 철학 드러켄밀러 | `DRUCKENMILLER` | 등급 ≥ WATCH **AND** philosophy-fit **≥50** | **+20%** | **−8%** | **20거래일** | 등급 계수만 | **50** |

> 철학 스타일 4종(6~9)은 시스템 모의 축 위의 오버레이다 — **청산(§3.2)·한도**는 시스템 모의(1)와 동일 상수를 재사용하되
> **사이징은 등급 계수만**(buyScore 가중·섹터 가드 미적용, §6.1)이고 **진입에 스타일별 philosophy-fit ≥50 게이트를 추가**한다(§6).

### 2.2 분봉 트랙 (당일 진입·당일 청산 · 단위가 다름)

| # | 트랙 | key | 진입 기준 | 익절 | 손절 | 청산 | 사이징 | 최대 동시보유 |
|---|---|---|---|---|---|---|---|---|
| 10 | 분봉 단타 | `intraday-scalp` | 거래량 폭발 **∧** 돌파 **∧** VWAP 상회 (3조건 AND) | **순 +2.0%** | **순 −1.2%** | **15:20 강제청산**(오버나잇 금지) | 종목당 원금 **3%** | **5** |

> 분봉 익절/손절은 **순(net·수수료 후) 기준**이다(§4). 왕복 거래비용율 ≈ 0.31%를 gross에서 차감해 판정한다.

---

## 3. 시스템 모의 (`paper-simulation`)

M10 30일 모의운용의 정본 트랙. 전역 단일 시스템 모의(합성 시스템 유저 `paper-sim@system.local`, `provider='system'`).
오케스트레이터: `backend/src/engine5-trading-risk/paper-simulation/paper-simulation.service.ts`.

### 3.1 진입

- **후보 pool**: `signal ≥ SIM_MIN_ENTRY_GRADE`(기본 **`WATCH`**). 1순위 `entryReady=true` 후보로 슬롯을 채우고,
  슬롯이 남으면 `entryReady=false`라도 `buyScore ≥ ENTRY_FALLBACK_MIN_BUY_SCORE`(**50**) 인 상위 후보로 보강(품질 하한 유지).
  종목당 1건 디듑 후 가용 슬롯만큼 절단.
  - 코드: `simulation-entry.ts` — `SIM_MIN_ENTRY_GRADE='WATCH'` · `ENTRY_FALLBACK_MIN_BUY_SCORE=50`.
- **차등 사이징(등급×점수)**: 진입예산 = `baseBudget × 등급계수 × buyScore가중`.
  - `baseBudget = 가상원금 × maxSinglePositionPct`(Risk 하드룰 envelope, **10%**).
  - **등급계수**(`GRADE_SIZING_FACTOR`): STRONG_BUY 1.0 / BUY 0.75 / WATCH 0.4.
  - **buyScore가중**(`buyScoreSizingMultiplier`): buyScore ≥ 80 → 1.0, ≤ 20 → FLOOR 0.5, 사이 선형.
    상수: `SIZING_SCORE_REF_HIGH=80` · `SIZING_SCORE_REF_LOW=20` · `SIZING_SCORE_MULT_FLOOR=0.5`.
  - 결합계수 ∈ (0, 등급계수] ≤ 1.0 → 종목당 예산은 **항상 baseBudget 이내**(하드룰 보존).
- **섹터 분산 가드**: 진입 시 동일 섹터 비중 상한 `maxSectorPct`(기본 **30%**) enforce. `industryCode` 미상(null)은 가드 면제.
  - 코드: `simulation-entry.ts sectorHeadroomBudget` · 호출부 `paper-simulation.service.ts`.
- **진입 시점**: 다음 거래일 시가(장외 체결 의미론, §1).

### 3.2 청산 — 합성 Exit Score 엔진 (engine4)

★ 시스템 모의의 실제 청산 판정은 **단일 하드 손절이 아니라 engine4 `calculateExitScore`(6-트리거 합성, 순수 Rule)**다
(`paper-simulation.service.ts:1622` — 실 기술지표·악재 공시를 주입, F3 2026-06-26). 아래 DEFAULT 값은 그 합성 안에서
**하드 오버라이드 보장선**으로 작동한다. 코드 정본: `backend/src/engine4-portfolio-exit/domain/exit-score.calculator.ts`.

**액션 사다리**(`scoreToAction`, 0~100): HOLD 0–29 · WATCH 30–49 · REDUCE 50–69 · **EXIT 70–89** · **BLOCK_REBUY 90–100**.
`exitAction ∈ {EXIT, BLOCK_REBUY}`일 때만 실제 매도(`EXIT_ACTIONS`). exitScore = 6 트리거 합 − 긍정모멘텀 보너스, 0~100 clamp.

| # | 트리거(컴포넌트, 상한) | 핵심 임계(코드) |
|---|---|---|
| 1 | 손실 리스크(0~20) | 하드 손절 pnl ≤ −`stopLossPct`(**−8%**) → 20(하드) · ATR 이탈 close < 진입 − **1.5×ATR14** → +15 · **트레일링 고점 −6%**(close < 고점×0.94) → +12 · 포트 일손실 한도 초과 → +10 |
| 2 | 투자논리 훼손(0~20) | invalidConditions 충족수 1/2/≥3 → 8/14/20 · primary 충족 → 최소 16 |
| 3 | 차트 훼손(0~20) | <MA5 +6 · <MA20 +10 · <VWAP +4 · <20일저가 +8 · 당일 캔들 −3% 이하 +6 |
| 4 | 공시 악재(0~20) | 고위험 5종 단건 +16(severe) · 일반 악재 +5 · 내부자 대량 순매도 +12(severe) · 소프트 캡 20 |
| 5 | 리밸런싱 과대비중(0~10) | 단일종목 비중 > `maxSinglePositionPct`(**10%**) 초과분 선형(상한 8) |
| 6 | 시간 초과(0~10) | 보유 거래일 > `maxHoldDays`(**20**) → +8 · 5일+ 초과수익<0 → +4 · 5일 평균거래량비<0.5 → +2 |
| − | 긍정 모멘텀 보너스(0~20, 감산) | 5일 초과수익 >5%/>2% → −8/−4 · 3일 거래량비 >1.5 → −6 |

**하드 오버라이드**(순수 Rule, 모멘텀 감산보다 우위):
- 하드 손절(손실점수=20) → **최소 EXIT 70** 보장.
- **하드 익절**: pnl ≥ `takeProfitPct`(**+20%**) → 최소 EXIT 70 보장(`TAKE_PROFIT` 트리거 primary). 매도 시 **부분 스케일아웃 50%**(잔량 보유, `TAKE_PROFIT_SCALE_OUT_FRACTION=0.5`).
- 투자논리 완전 훼손(=20) 또는 공시 severe → **최소 WATCH 30** 보장(권고 노출 — 자동 실주문 아님).

| DEFAULT 하드 파라미터(포지션 주입값) | 값 | 코드 상수 |
|---|---|---|
| 하드 손절 `stopLossPct` | **−8%** | `PaperSimulationService.DEFAULT_STOP_LOSS_PCT = 8` |
| 하드 익절 `takeProfitPct` | **+20%** | `DEFAULT_TAKE_PROFIT_PCT = 20` · 스케일아웃 `TAKE_PROFIT_SCALE_OUT_FRACTION = 0.5` |
| 시간 초과 `maxHoldDays` | **20거래일** | `DEFAULT_MAX_HOLD_DAYS = 20` |
| 장중 실시간 손절 신선도 게이트 | 진입소스(REAL) 일봉 ≤2거래일 신선 시 실시간 하락 신뢰→즉시 체결, 초과 시 DAR-433 소스정렬 폴백 | `INTRADAY_REAL_FRESH_MAX_DAYS = 2` |

- **테제 오버라이드**: PositionThesis의 `exitRules`가 있으면 `stopLossPct`·`maxHoldDays`를 종목별로 대입(`deriveExitParams`),
  없으면 위 DEFAULT 폴백. 익절은 항상 DEFAULT(+20%).

### 3.3 한도·주기

| 항목 | 값 | 코드 |
|---|---|---|
| 최대 보유종목 | **50** | `MAX_HOLDINGS = 50` |
| 초기자본 | 10,000,000 | `INITIAL_CAPITAL` |
| 운용 주기(cron) | 평일 **19:30 KST** 일일 사이클 + 장중 5분 모니터(실시간 손절) | `paper-simulation.scheduler.ts @Cron('30 19 * * 1-5')` |
| 표면(딥링크) | `/portfolio?tab=sim` | `TRADE_DEEP_LINK` |

---

## 4. 전략 변형 4종 (engine3 `strategy-presets`)

단일 라이브 리플레이(DAR-385)를 **진입/청산/사이징 룰이 다른 전략 변형 4종**으로 분기한 '트레이딩 로직' 축.
**정본 코드 = `backend/src/engine3-quant-market/backtest/strategies/strategy-presets.ts`** (`STRATEGY_PRESETS`).

각 전략은 **두 표면**으로 운용된다(동일 `preset` 상수 — 단 **진입 체결·사이징 envelope·청산 적용 방식이 다름**):
1. **백테스트 리플레이**(§18) — 과거 1년 point-in-time 재생(`BacktestRun`/`BacktestTrade`), 매일 05:00 KST 갱신.
   **진입 체결 = 예약 → 다음 거래일 시가**(시가에 슬리피지 반영, `backtest-runner.service.ts:130`, `preset.entryRule='NEXT_OPEN'` 준수).
   청산은 `BacktestRunnerService`가 아래 `exitRules`를 **리터럴 트리거**로 판정(익절/손절/최대보유 도달 = 청산).
2. **라이브 forward 모의**(§21.3, live-readiness W1) — 라이브 신호에 동일 `preset.params` 적용,
   전용 포트폴리오 `styleTag='strategy:<key>'`, 평일 **19:45 KST** 크론(`paper.strategy-forward`).
   **진입 체결 = 결정 당일 최근 종가 즉시체결**(예약 없음, `strategy-forward-simulation.service.ts:338 latestClose` — ★후속 α "익일 시가" 규약 통일 예정).
   청산은 시스템 모의와 같은 engine4 **합성 Exit Score(6-트리거, §3.2)** 경유
   (`strategy-forward-simulation.service.ts:524 calculateExitScore(..., [])`, 공시 이벤트 빈 배열) — 아래 `exitRules`는
   그 합성 안의 하드 오버라이드 보장선(`stopLossPct`·`takeProfitPct`·`maxHoldDays` 포지션 주입값)이 된다.

공통: `initialCapital=10,000,000`. 아래 표의 **`sizeRule`(EQUAL/SCORE_WEIGHT) 산식은 양 표면 동일**하되, **forward는 추가로 Risk envelope(원금 × `maxSinglePositionPct` 10%) 절단**(`min(budget, envelope)`, `strategyEntryBudget`)을 적용한다 — SCORE_WEIGHT 최대 1.5배 배분이 리플레이에선 envelope 미절단(예: 보수가치 고buyScore 최대 1.5M)이나 forward에선 1M 상한으로 바인딩된다.

| key(라벨) | minBuyScore | 익절 | 손절 | 최대보유 | 사이징(sizeRule) | 최대종목 | 특이 |
|---|---|---|---|---|---|---|---|
| `event-edge`(이벤트엣지) | **35** | +20% | −10% | 20 | 점수가중(`SCORE_WEIGHT`) | 20 | **robustEventGate=true** |
| `short-momentum`(단기모멘텀) | **40** | +10% | −5% | 5 | 균등(`EQUAL_WEIGHT`) | 20 | 빠른 회전 |
| `conservative-value`(보수가치) | **50** | +20% | −10% | 20 | 점수가중(`SCORE_WEIGHT`) | 10 | 최고 확신·소수집중 |
| `aggressive-diversified`(공격분산) | **30** | +20% | −8% | 20 | 균등(`EQUAL_WEIGHT`) | 50 | 최광 분산 |

### 4.1 minBuyScore 임계 사다리 (DAR-413)

임계값은 **buyScore 실측 분포**에 맞춘 a-priori 상수 사다리다(런타임 윈도 분포 계산 금지 = 미래정보 누수 방지, frozen).
정체성 = '상대적 엄격도(percentile rank)', 통계적으로 의미있는 거래수 확보:

- **보수가치 50**(상위 ~0.6%, 최고 확신) > **단기모멘텀 40**(상위 ~3%) >
  **이벤트엣지 35**(상위 ~4%, robust 게이트가 추가로 좁힘) > **공격분산 30**(상위 ~6.6%, 최광·하한).
- 근거 분포(trading_signals 89,754건, max=88, p95=33): ≥50: 0.65% · ≥40: 3.2% · ≥35: 4.4% · ≥30: 6.6%.

### 4.2 event-edge robust 게이트 (DAR-408)

`robustEventGate=true`인 event-edge는 매수 이벤트를 **하드코딩하지 않는다**. refresh 시 EventStudy robust 통계
(`winsorizedMeanArD20 ?? medianArD20`)가 **양(+) 초과수익을 확인한 이벤트 유형만 동적으로 매수**한다.
산술평균(이상치 오염)은 쓰지 않는다. **양-edge 그룹이 없으면 진입 0**(do-no-harm) — 데이터가 쌓여 양-edge가 생기면 자동 활성.
(라이브 forward에서는 `EventEdgeSelector` robust allowlist를 당일 1회 해석, 비면 진입 0.)

> ⚠️ **stale 주의**: 과거 문서/코드 주석에 남아 있던 "이벤트 6종 한정 · 매수점수 ≥50"은 **DAR-408·DAR-413 이전 값**이다.
> 현행 정본은 위 표(≥35 · robust 동적 선별). api-spec §18은 본 문서 발효와 함께 정정했다(§7).

---

## 5. 분봉 단타 (`intraday-scalp`)

당일 진입·당일 청산(오버나잇 금지) **실시간 페이퍼 트랙**. 분봉은 KIS **forward-only**(당일치만) → 백테스트 불가, 정규장 중
실시간 모의로만 누적. 신호 정의 = engine3 순수 함수, 체결·리스크·청산·영속 = engine5 독립.

- 신호 코드: `backend/src/engine3-quant-market/intraday-scalp/intraday-scalp-signal.ts`
- 청산·상수 코드: `backend/src/engine5-trading-risk/paper-simulation/intraday-scalp/intraday-scalp-exit.ts`

### 5.1 진입 (3조건 AND, DAR-411/415)

| 조건 | 기준 | 코드 상수(`DEFAULT_SCALP_ENTRY_PARAMS`) |
|---|---|---|
| ① 거래량 폭발 | 현재 분 거래량 ≥ 직전 **20분** 평균 × **2.5** | `volumeMultiple=2.5` · `volumeAvgLookbackMin=20` |
| ② 돌파 | 현재가(분봉 종가) > 직전 **15분** 고가 | `breakoutLookbackMin=15` |
| ③ 추세 확인 | 현재가 > 당일 VWAP | — |

- 진입 태그: `SCALP_ENTRY_TAG='VOLUME_BREAKOUT_VWAP'`.
- **윈도우 스캔(DAR-415)**: 직전 스캔 이후 도착한 신규 분봉 전부를 각 봉을 '현재'로 point-in-time 평가해 **첫 충족봉**을 포착.
  진입ts=충족봉 시각, 진입가=충족봉 종가. 종목당 1라운드트립.
- **진입 fee 허들(DAR-418)**: 기대이동(gross TP폭)이 왕복비용 + **최소마진 0.3%**를 넘어야 진입.
  상수: `ENTRY_FEE_HURDLE_MIN_MARGIN_PCT=0.3`.
- **신규 진입 마감**: **15:20**(포함) 이후 진입 금지 — `ENTRY_CUTOFF_HHMM='1520'`.

### 5.2 청산 (fee-aware net, DAR-418)

| 규칙 | 값(순·net) | 코드 상수 |
|---|---|---|
| 익절 | **순 +2.0%** (gross ≈ +2.31%) | `TAKE_PROFIT_PCT=2.0` |
| 손절 | **순 −1.2%** (gross ≈ −0.89%) | `STOP_LOSS_PCT=-1.2` |
| 강제청산 | **15:20** 손익 무관 전량(오버나잇 금지) | `FORCE_EXIT_HHMM='1520'` |
| 왕복 거래비용율 | ≈ **0.31%** = 2·0.015% + 0.18% + 2·0.05% (체결 파라미터 파생 SSOT, 하드코딩 금지) | `DEFAULT_ROUND_TRIP_COST_PCT = roundTripCostPct(DEFAULT_FILL_PARAMS)` |

net 판정: `netReturnPct = grossReturnPct − roundTripCostPct`. 소액 익절이 수수료에 먹혀 적자전환하는 문제를 차단.

### 5.3 사이징·한도·주기

| 항목 | 값 | 코드 |
|---|---|---|
| 종목당 예산 | 가상원금의 **3%** (engine5 1회 매수 하드룰 3%와 정합) | `PER_POSITION_BUDGET_PCT=0.03` |
| 동시 보유 상한 | **5** | `MAX_OPEN_POSITIONS=5` |
| 초기자본 | 10,000,000 | `SCALP_INITIAL_CAPITAL` |
| 운용 주기(cron) | 진입·청산 매 10분 **09:02~15:52**(`2-59/10 9-15 * * 1-5`) · 강제청산 **15:20**(`20 15 * * 1-5`) | `docs/workflow.md §6.7` |
| 저표본 임계 | 청산 표본 < 20이면 LOW_SAMPLE 정직 표기 | `LOW_SAMPLE_THRESHOLD=20` |

---

## 6. 철학 스타일 4종 (`philosophy-style*`)

Main Thesis B(모의수익 검증). BUFFETT(버핏)/LYNCH(린치)/GREENBLATT(그린블라트)/DRUCKENMILLER(드러켄밀러) 4개 거장
스타일별 분기 모의운용. **시스템 모의 축 위의 오버레이** — **청산(§3.2 합성 Exit Score)·한도**는 시스템 모의와 동일 상수를
재사용하되, **사이징은 등급 계수만**(buyScore 가중·섹터 가드 미적용 — 시스템 모의와 차이)이고 **진입에 philosophy-fit ≥50 게이트를 추가**한다.

- 코드: `philosophy-style.ts`(스타일 상수) · `philosophy-style-simulation.service.ts`(운용).

### 6.1 진입 (스타일 게이트 추가)

- 후보: `signal ≥ SIM_MIN_ENTRY_GRADE`(WATCH) — 시스템 모의와 동일.
- **진입 체결: 결정 당일 최근 종가 즉시체결**(예약 없음 — 시스템 모의의 예약→익일 시가와 다름).
  `philosophy-style-simulation.service.ts:269 latestClose` + `entryDate=new Date()`. ★후속 α "익일 시가" 규약 통일 예정(코드 주석).
- **스타일 적격 게이트**: 종목의 해당 스타일 **philosophy-fit score ≥ STYLE_ENTRY_MIN_FIT(50)** 이고 `computable`인 스타일에만 후보 진입.
  - 코드: `philosophy-style.ts STYLE_ENTRY_MIN_FIT = 50` · `eligibleStylesForCompany`.
- **사이징: 등급 계수만** (시스템 모의와 다름 — buyScore 가중 미적용). `budget = entryBudget(baseBudget, grade)` =
  `baseBudget × gradeSizingFactor`(STRONG 1.0 / BUY 0.75 / WATCH 0.4), `baseBudget = 가상원금 × maxSinglePositionPct 10%`.
  buyScore 가중(`entryBudgetScored`)은 시스템 모의(§3.1) 전용이다.
  - 코드: `philosophy-style-simulation.service.ts:272 entryBudget(baseBudget, sig.signal)` → `simulation-entry.ts:64 entryBudget`.
- **섹터 분산 가드: 미적용**(시스템 모의 전용). 철학 진입 경로에는 `sectorHeadroomBudget` 호출이 없다 —
  섹터 상한(`maxSectorPct 30%`)은 시스템 모의 `openNewPositions`(`paper-simulation.service.ts:1103`)에서만 enforce된다.

### 6.2 청산·한도·주기 (시스템 모의 재사용)

청산 판정도 시스템 모의와 같은 engine4 **합성 Exit Score(6-트리거, §3.2)**를 쓴다
(`philosophy-style-simulation.service.ts:447 calculateExitScore(posSnap, tech, thesisSnap, [])`). 단, 시스템 모의(악재 공시 주입)와
달리 **공시 이벤트는 빈 배열(`[]`)**로 넘겨 트리거 4(공시 악재)는 항상 0이다. 아래 값은 §3.2 하드 오버라이드 보장선의 포지션 주입값이다.

| 규칙 | 값 | 코드(재사용) |
|---|---|---|
| 손절 | **−8%** | `PaperSimulationService.DEFAULT_STOP_LOSS_PCT` |
| 익절 | **+20%** | `PaperSimulationService.DEFAULT_TAKE_PROFIT_PCT` |
| 최대보유 | **20거래일** | `PaperSimulationService.DEFAULT_MAX_HOLD_DAYS` |
| 최대 보유종목 | **50** | `PaperSimulationService.MAX_HOLDINGS` |
| 초기자본 | 10,000,000 | `PaperSimulationService.INITIAL_CAPITAL` |
| 운용 주기(cron) | 평일 **19:40 KST**(시스템 모의 19:30 직후) | `forward-tracks.scheduler.ts @Cron('40 19 * * 1-5')` |

- 누적수익 랭킹·LOW_SAMPLE 정직 표기는 성적표 공통 규칙을 따른다.

---

## 7. 공유 Risk 하드룰·킬스위치·체결 파라미터 (engine5)

아래는 트랙별 사이징을 감싸는 **Risk envelope**(순수 Rule)이다. 모의 트랙의 사이징 값은 "가상원금 배분 비율"일 뿐
이 하드룰을 **대체·우회하지 않는다**. 손실 한도 veto(dailyLoss/weeklyLoss)는 `OrderRiskService`(M11/M12 실주문 루프의
진입 게이트)에서 강제되며, 실주문 루프는 아직 미연동이다(현재 모의 체결은 `simulateFill`만 사용).

### 7.1 Risk 하드룰 (`DEFAULT_RISK_LIMITS`)

코드: `backend/src/engine5-trading-risk/domain/risk-check.types.ts`.

| 규칙 | 기본값 | 설명 |
|---|---|---|
| singleBuyMaxPct | **0.03 (3%)** | 1회 매수 최대 비율 |
| singlePositionMaxPct | **0.10 (10%)** | 단일 종목 최대 비중 |
| dailyLossMaxPct | **−0.02 (−2%)** | 일간 손실 한도 — **BUY 전용 side-gate**(SELL 미차단) |
| weeklyLossMaxPct | **−0.05 (−5%)** | 주간 손실 한도 — **BUY 전용 side-gate**(SELL 미차단) |
| maxOpenOrders | **5** | 최대 미체결 주문 수 |
| maxDailyTrades | **10** | 일간 최대 거래 횟수 |

> side-gate(GAP-11): 손실 한도는 신규 진입(BUY)만 차단, 청산·위험 축소(SELL)는 자기잠금 방지 위해 통과. 순수 Rule.

### 7.2 킬스위치 자동 발동 (`DEFAULT_AUTO_KILL_CONDITIONS`)

- 연속 손실 **≥ 5회**
- 시장 급락 **≤ −5%** (조건에 `marketDropPct` 설정 시 활성)
- API 오류 누적 **≥ 3회**
- **모드**: 기본 `REDUCE_ONLY`(발동 중 BUY 차단·SELL 허용). 전면 중단은 `FULL_HALT`로 상수 교체. 코드: `risk-check.types.ts DEFAULT_KILL_SWITCH_MODE`.

### 7.3 체결 시뮬레이터 (`DEFAULT_FILL_PARAMS`)

코드: `backend/src/engine5-trading-risk/domain/fill-simulator.ts`.

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| commissionRate | **0.00015 (0.015%)** | 매수·매도 공통 수수료 |
| sellTaxRate | **0.0018 (0.18%)** | 매도 증권거래세(2024 기준) |
| slippagePct | **0.0005 (0.05%)** | 기본 슬리피지(시장충격 모델) |
| partialFillThreshold | **0.1** | 유동성비율 10% 미만 시 부분체결 |

왕복 거래비용율 = `2·commissionRate + sellTaxRate + 2·slippagePct` = **0.31%**(분봉 단타 net 판정 SSOT).

### 7.4 RiskGuard 공용 진입 게이트 (DAR-496 [견고화 W2·P18])

코드: `backend/src/engine5-trading-risk/domain/risk-guard-gate.ts`(순수 게이트) + `services/risk-guard.service.ts`(영속·알림).

- **역할**: §7.1 하드룰 중 **일일손실 한도**(dailyLossMaxPct −2%, `DEFAULT_RISK_LIMITS` 재사용)와 **현금 불변식**(가용현금 − 진입예산 ≥ 0, DAR-426 패턴) 2종을 트랙 컨텍스트만 받는 순수 게이트로 추출해 **전 진입 트랙**이 진입 확정 직전 1줄로 호출한다. 배경: 일일손실 순수 룰이 그동안 분봉 단타(및 미연동 실주문 루프)에만 강제되고 시스템 모의·철학·전략 forward 에는 미배선(갭 A1), 전략 forward 진입 루프엔 현금 가드 자체가 없었다(갭 A5).
- **판정**: `ALLOW`(위반 0) / `SHADOW_VIOLATION`(위반이나 기록만) / `BLOCK`(위반으로 차단).
- **트랙별 모드**(`DEFAULT_RISK_GUARD_MODES`):

  | 트랙 | 모드 | 근거 |
  |---|---|---|
  | 시스템 모의 · 철학 4종 · 전략 forward 4종 | **SHADOW** | M10 측정 중 — 매매 행동 무변경(§8.5) |
  | 분봉 단타 | SHADOW(로그만) | 기존 `checkRisk` 하드룰 유지 — 중복 강제 금지 |
  | 듀얼모멘텀 코어 forward | **ENFORCE** | 측정 대상 아님(§9.3.2 위험조정 게이트 통과 신규 트랙) |

- **★수용 기준(§8.5 준수)**: 측정 트랙 기본값 **SHADOW** 는 M10 클록 보호의 절대 조건이다. ENFORCE 플립은 환경변수 `RISK_GUARD_MODE_<TRACK>=ENFORCE` 로 **코드 변경 없이** 가능하나, 측정 트랙 플립은 **M10 졸업 측정 완료 + §8.1 3게이트(문서→재검증→사람 승인) 통과 전까지 금지**(Wave 2 P23). 순수 게이트의 불변식상 SHADOW 는 절대 BLOCK 을 반환하지 않아 배선 전후 진입 후보·수량·예약이 동일하다.
- **영속·알림**: 판정을 `RiskDecisionLog`(FK 없는 additive 모델)에 기록. 위반은 P02 OPS_ALERT — SHADOW 는 트랙+거래일 dedupe(일 1회 요약), ENFORCE BLOCK 은 즉시. 드로다운 컷·월간 한도·자동 킬은 후속(P19~P21).

---

## 8. 변경 절차 (Change Control — 규칙·파라미터 변경 공식 절차)

> **지위**: 이 장은 §0의 "발효 이후 변경 절차" 원칙을 정식 **의무 조항**으로 승격한다(P07, DAR-478).
> 지금까지 산발적으로 존재·실사용되던 3개 규정(재검증 프로토콜·룰 완화 게이트·AI 자동조정 금지)을 **일반 의무 조항**으로 통합한다. 근거: 견고화 계획 `docs/roadmap/cc-trading-robustness-plan-2026-07-03.md §4 Wave 0 P07`.

### 8.1 3-게이트 원칙 (모든 룰·파라미터 변경에 무예외 적용)

**어떤 전략 파라미터·룰(진입·청산·사이징·한도·Risk 하드룰·킬스위치·체결·이벤트 base score 포함)도 아래 3게이트를 순서대로 통과하지 않고 코드 상수를 변경하는 것을 금지한다.**

1. **① 정본 문서 개정** — 변경 대상 값을 먼저 이 룰북(§1~§7 해당 항)에서 개정한다. 코드가 문서를 앞서지 않는다(§0). 신규 트랙은 §9(Wave 1) 선기재 절차를 따른다.
2. **② 재검증 통과** — §8.2 재검증 프로토콜을 실행하고 합격선을 충족한다. AI/LLM은 이 판정에 개입하지 않는다(순수 Rule·수식, §8.4).
3. **③ 사람 승인** — 재검증 결과를 사람이 검토·승인한다. 승인 없이 코드 반영 금지. 특히 **룰 완화**(하드→소프트 강등 등)는 사람 승인 게이트가 강제된다(§8.3).

> **문서 개정·재검증·승인 없이 코드 상수만 바꾸는 것을 금지한다.** (§0 재확인)

### 8.2 재검증 프로토콜 (출처: `docs/roadmap/buy-logic-validation-baseline.md §3`)

데이터가 늘 때·주기적·룰 변경 시 실행하는 고정 절차:
1. `POST /event-study/calculate` — 근거 재계산(READY 수·관측수 갱신)
2. `POST /signals/generate` — 신호 재생성
3. `POST /backtest/replay {startDate,endDate,name}` — point-in-time 백테스트
4. `GET /backtest/signal-accuracy`·`/calibration`·`/feature-ab` — 등급↔실현 정합·calibration gap
5. baseline 대비 totalReturn·grade 단조성·READY 수 추이 기록

- **합격선(논리 성립)**: grade 단조성 + 전체 d20 avgExcess 비음 + backtest totalReturn 우상향. (동 문서 §3)
- **frozen 상수 갱신 경로**: 이벤트 base score·impliedScore 등 frozen 상수는 이 프로토콜의 **robust(median) 산출**을 통과한 값만 반영한다(예: 상향권고는 median 기반 + 사람 게이트 통과분만; 동 문서 §2). 단일 장세 과적합 신호는 미반영.

### 8.3 룰 완화 특칙 — 2회차 재검증 + 사람 승인 게이트 (출처: `docs/roadmap/cc-live-readiness-diagnosis-2026-07-03.md §2`)

리스크 회피 룰의 **완화**(폐기·하드→소프트 강등)는 §8.1 3게이트에 더해 다음을 강제한다:
- **완화 후보 한정**: "회피 룰 폐기 0건"이 기준. 완화 대상은 `isInvestmentCaution`·`isAbnormalSurge`의 하드→소프트 강등뿐이며, **사람 승인 게이트** 통과 전까지 비활성(현재 0종목). 이벤트 하드블록 3종·거래정지·관리종목은 수익과 무관하게 유지.
- **재검증 2회차 순서(고정)**: ①측정층 수정(dedup·층화·축 분리) → ②백필 상태플래그 PIT화 → ③EventStudy 입력 스냅샷 고정 후 재실행 → ④**그 결과로만** 룰 완화·WATCH 재설계 논의. 순서를 건너뛴 완화 금지.

### 8.4 AI 자동 조정 절대 금지 (출처: `docs/roadmap/phase-10-backtest.md`)

- 백테스트 결과 기반 **AI가 전략 파라미터를 자동 조정·최적화하는 행위는 과적합(overfitting) 위험으로 절대 금지**.
- Gate 판정을 AI가 번복·예외 처리하는 행위 절대 금지. AI의 실전 수익 예측·보증 금지(백테스트는 과거 검증, 미래 보장 아님).
- 변경 절차의 ②재검증·③승인은 전부 **순수 Rule/수식 + 사람** 경로다. engine2(AI/LLM)는 이 3게이트 어디에도 개입하지 않는다(§0 · engine5 AI 금지영역 불가침).
- **파라미터 민감도 스윕 하니스(read-only, 견고화 W3·P24 / DAR-485)**: `engine3 backtest/strategies/parameter-sweep.*`(API `POST /paper-trading/simulation/strategies/:key/sensitivity-sweep`·수동 스크립트)는 프리셋 이웃값 그리드(손절 ±2%p·익절 ±5%p·보유일 ±5일·minBuyScore ±5)의 성과 안정성을 **측정·리포트만** 한다. 이 하니스는 §8.2 ②재검증에 쓸 근거(과최적화 여부·최민감 축)를 제공할 뿐, 결과를 근거로 파라미터를 **자동 변경하는 경로가 없다**. 반영은 반드시 §8.1 3게이트(문서 개정→재검증→사람 승인)로만 한다. 상시 크론 없음(수동 트리거·운용/측정 트랙 무접촉·BacktestRun 영속 0).

### 8.5 M10 클록 보호 — 측정 트랙 리스크 룰 ENFORCE 플립 금지 (Wave 2 P23 근거 조항)

- **M10 졸업 측정이 완료되기 전에는, 측정 중인 트랙(시스템 모의·전략 4종·철학 4종·분봉 단타)의 리스크 룰을 관측(observe)에서 강제(ENFORCE)로 플립하는 것을 금지한다.**
- 근거: 측정 트랙의 매매 행동을 측정 기간 중 바꾸면 M10 졸업 지표의 시계열이 오염된다(측정 오염 = 판정 무효; `cc-live-readiness-diagnosis §2` TB-1/TB-2 교훈과 동형). 이 기간에는 관측·알림·문서·데이터층 변경만 허용한다(견고화 W0 공통 DoD⑤).
- ENFORCE 플립은 M10 졸업 측정 완료 **후**, §8.1 3게이트(문서 개정→재검증→사람 승인)를 별도로 통과해야 한다. 이 조항은 Wave 2 **P23**(리스크 룰 ENFORCE 전환)의 선행 근거 조항이다.

---

## 9. Wave 1 예정 트랙 — 선기재 대기 (구현 착수 전 여기 확정)

> **P06 원칙**: 신규 트랙 룰은 **구현 착수 전 이 섹션에 먼저 기재**한다(문서가 코드를 앞선다).
> 아래는 계획(`cc-trading-robustness-plan-2026-07-03.md §4 Wave 1`)상 예정 트랙의 **자리표시(placeholder)**다 —
> 실제 룰 값·상수는 각 구현 이슈(P12/P14)가 이 표를 채우고 승인받은 뒤에야 코드로 내려간다. **아직 미확정(TBD)**.

| 예정 트랙 | 유형 | 계획 ID | 룰 개요(초안, 미확정) | 자본 프레임 |
|---|---|---|---|---|
| 듀얼모멘텀 코어 | 코어(자산배분) | P12·P13 | 상대(미S&P500 vs KODEX200 12개월) + 절대(음수면 채권 대피). 월말 리밸런싱. `styleTag='alloc:dual-momentum'` | 2단 프레임 코어 65% (P16) |
| 변동성 돌파 위성 | 위성(단기) | P14·P15 | 목표가 = 시가 + 전일 Range×K(0.5) + **변동성 조절 사이징**. 익일 시가 청산. `styleTag='satellite:vol-breakout'` | 2단 프레임 위성 25% (P16) |

- **활성 게이트(P16)**: 2단 자본 프레임(코어 65% / 위성 25% / 버퍼 10%) + **백테스트 엣지 양수 게이트** — 게이트 통과 전 forward 활성 금지.
- **선기재 절차**: P12/P14 구현 이슈는 (1) 진입/청산/사이징/한도 전값을 이 §9에 확정 기재 → (2) 사람 승인 → (3) 순수 함수·프리셋 구현. (일반 절차는 §8.)

### 9.1 변동성 돌파 위성 — 확정 룰 (DAR-491 P14, `satellite:vol-breakout`)

> 🛑 **기각(2026-07-03, 사용자 결정 — DAR-494)**: P16 게이트 실행에서 위성은 totalReturn **−99.33%** · 승률 **8.4%** · PF **0.04**(보수적 비용 가정, 구간 2020-08~2026-07)로 **완전 붕괴**했다. 사용자가 **위성 forward 활성을 기각**했다(§9.3.1 결과 참조). **RSI 전략 기각 전례와 동일 처리**(`docs/roadmap/rsi-strategy-backtest-2026-06-26.md`) — 엣지 미확인 트랙은 활성하지 않는다(do-no-harm).
> - **forward 배선 없음**: P15(위성 forward)·P27은 발행 취소. `alloc:*`/`satellite:*` forward 트랙 미생성.
> - **코드 보존(비활성)**: `volatility-breakout/` 순수 함수·상수·`two-tier-backtest/satellite-breakout-backtest.ts`는 **삭제하지 않는다**(백테스트·재도전 자산으로 존치). 배선이 없어 매매 행동 0.
> - **재도전 조건**: §8 변경 절차로 **파라미터 재설계**(K·목표변동성·비용 가정·대상 등) → **게이트 재통과**(위성은 엄격 기준 유지) → 사람 승인. 그 전에는 활성 금지.

> 이 섹션은 선기재 절차 ①을 완료한 **확정 룰**이다. 하기 값은 코드 상수와 1:1 대응한다(§10 SSOT 포인터 참조).
> ★ 어떤 값도 §8.1 3게이트(문서 개정→재검증→사람 승인) 없이 코드·이 문서 모두 변경 금지. **(현재 기각·비활성 — 위 배너 참조.)**

**대상**: KODEX 200(`069500`) 단일. 거래세 면제 ETF, 유동성 최상. 다종목 확장은 P16 이후 검토.

#### 진입 규칙

| 항목 | 값 | 비고 |
|---|---|---|
| 목표가 공식 | `시가 O + 전일 Range(H−L) × K` | 호가단위 반올림(nearest) 정렬 후 사용 |
| 돌파 계수 K | **0.5 (a-priori frozen)** | P16 백테스트 + §8 절차로만 변경 가능. AI 자동조정 금지(§8.4) |
| 진입 조건 | 장중 현재가 ≥ 목표가 | 1일 1회, 재진입 없음. 스캔·dedup은 P15 소관 |
| 호가 정렬 방식 | KRX 호가단위 **반올림(nearest)** | engine5 `krxTickSize` SSOT 재사용. 비호가 가격 방지 목적 |
| 추세 필터(옵션) | 전일 종가 > SMA(종가, 5일) | 기본 **OFF** — ON/OFF 최종 판정은 P16 백테스트 |
| 전일 데이터 결측 | `null` 반환 → 진입 스킵 | fail-safe 기본값 |
| Range ≤ 0 (거래정지 등) | `null` 반환 → 진입 스킵 | degenerate 방어 |

#### 청산 규칙

| 항목 | 값 | 비고 |
|---|---|---|
| 청산 시점 | 익일 시가 전량 | forward 배선·체결은 P15 소관 |

#### 변동성 조절 사이징 (룰북 8-4 첫 실적용 — 갭 A11)

| 항목 | 공식 / 값 | 비고 |
|---|---|---|
| 전일 Range% | `(H−L) / 전일 종가 × 100` | 변동성 측정 분모 |
| 사이징계수 | `min(1, 목표변동성% / 전일 Range%)` | 레버리지 상한 1 (목표보다 낮은 변동성이면 캡) |
| 목표 일간 변동성 | **1.0% (a-priori frozen)** | P16 백테스트 + §8 절차로만 변경 가능 |
| 위성 배분금액 | 총자본 × 25% | 2단 프레임 배선은 P16 소관. 이 이슈에선 상수로만 선기재 |
| 매수 수량 | `floor(배분금액 × 사이징계수 / 참조가)` | 정수(floor). 참조가 = 목표가(P15) 또는 전일 종가(폴백) |

#### 자본 프레임 상수

| 항목 | 값 |
|---|---|
| 트랙 자본 비율 | 25% (위성) |
| styleTag | `satellite:vol-breakout` |
| 활성 게이트 | P16 백테스트 엣지 양수 통과 후 — **현재 비활성** |

### 9.2 듀얼모멘텀 코어 — 확정 룰 (DAR-492 P12, `alloc:dual-momentum`)

> 이 섹션은 선기재 절차 ①을 완료한 **확정 룰**이다. 하기 값은 코드 상수와 1:1 대응한다(§10 SSOT 포인터 참조).
> ★ 어떤 값도 §8.1 3게이트(문서 개정→재검증→사람 승인) 없이 코드·이 문서 모두 변경 금지.
> 이 이슈는 **판정 순수 함수 계층만** 소유한다 — forward 트랙·월말 크론·매도→매수 실행·DB 쓰기는 P13, 백테스트 엣지 게이트는 P16.

**전략**: 한국형 듀얼모멘텀(Antonacci GEM 변형). 국내 상장 ETF, 월말 1회 리밸런싱, 거래세 면제(ETF).

#### 대상 유니버스 (무레버리지, `etf-universe.ts` 역할 1:1)

| 축 | ETF | 코드 | 역할 |
|---|---|---|---|
| 공격A (MomA) | TIGER 미국S&P500 | `360750` | 해외주식 모멘텀 |
| 공격B (MomB) | KODEX 200 | `069500` | 국내주식 모멘텀 |
| 절대 모멘텀 임계 (MomT) | KODEX 단기채권 | `153130` | 무위험 대용(T-bill) |
| 방어 | KODEX 종합채권(AA-이상) | `273130` | 절대 모멘텀 미충족 시 회피처 |

#### 판정 규칙 (매월 마지막 거래일 1회)

| 항목 | 값 | 비고 |
|---|---|---|
| 판정 시점 | 매월 **마지막 거래일** 1회 | 월말 거래일 판정은 P09 `market-calendar`(`lastTradingDayOfMonth`)로 P13 수행 — 이 이슈 재구현 금지 |
| 모멘텀 정의 | `현재 수정종가 / 룩백일 전 수정종가 − 1` | 12개월 수익률(소수). 수정종가 기준 |
| 룩백 | **252 거래일 (a-priori frozen)** | "252영업일 vs 캘린더 12개월" 중 **252 거래일** 채택. 근거: 순수 함수 결정론(캘린더 의존 제거·거래일 판정은 P09/P13 소관), 1년 ≈ 252 KRX 거래일, EtfDailyPrice는 거래일만 존재 |
| 상대 모멘텀 | `argmax(MomA, MomB)` | 동점 시 공격A(해외) 우선 — frozen tiebreak(결정론) |
| 절대 모멘텀 필터 | `max(MomA, MomB) > MomT` 이면 공격, 아니면 방어 | 경계(`==`)는 방어(초과가 아니면 진입 안 함) |
| 목표 보유 | 공격 승자 100% **또는** 종합채권(`273130`) 100% | 단일 자산 100%(2단 프레임 내 코어 배분은 P16) |

#### 리밸런싱 규칙

| 항목 | 값 | 비고 |
|---|---|---|
| 무행동 | 현재 보유 == 목표 → **리밸런싱 생략(HOLD)** | 회전 최소화 |
| 교체(SWITCH) | 현재 보유 != 목표 → 전량 매도 → 목표 매수 | **매도 후 매수 순서**(현금 확보 후 진입). 실행·부분체결 방어는 P13 |
| 결측 fail-safe | 이력 < **253봉**(룩백+현재) 또는 window 결측일 → `null` | **매매 보류 + 전월 포지션 유지**(무주문). 계획의 "13개월 미만 이력"을 거래일 기준 253봉으로 정밀화 |

#### 자본 프레임 상수

| 항목 | 값 |
|---|---|
| 트랙 자본 비율 | 65% (코어) |
| styleTag | `alloc:dual-momentum` |
| 활성 게이트 | P16 백테스트 엣지 양수 통과 후 — **현재 비활성** |

### 9.3 2단 자본 프레임 + 검증 게이트 (DAR-493 P16)

> 신규 2트랙(§9.1 위성·§9.2 코어) forward 활성의 **선행 조건**. 게이트는 계산 코드까지가 P16 범위이고,
> **판정·활성 결정은 통합자·사용자 소관**이다(do-no-harm — RSI 엣지 없음 기각 전례).

**2단 자본 프레임(frozen)**: 코어 65% / 위성 25% / 현금 버퍼 10% (합 100%). 코드: `two-tier-backtest/capital-frame.constants.ts`.

**ETF 비용 프로파일**: ETF 는 증권거래세 **면제**(taxRate=0). 수수료·슬리피지는 개별주와 동일. 개별주 4전략 백테스트는 기존 프로파일(거래세 0.18%) 무변경. 코드: `two-tier-backtest/etf-cost-profile.ts`.

**게이트 산출·기록 절차**:
1. P11 수동 백필 러너로 ETF 일봉 3년 구간 적재 → 커버리지 확인(360750 상장 2020-08 고려).
2. `two-tier-backtest.manual.ts`(또는 JWT `POST /api/paper-trading/backtest/two-tier-gate`)로 비용 반영 백테스트 실행 → 게이트 리포트.
3. 리포트 지표: 트랙별 totalReturn·승률·PF·MDD·표본수 + **엣지 양수 여부**(비용 반영 후 `totalReturn > 0 && > 벤치마크(KODEX200 매수후보유)`).
4. **코어는 월단위 관측 ≈12회/년 → 통계 검증력 낮음**(문헌 엣지 참조 불가피 — 정직 표기).
5. 게이트 결과는 리뷰 산출물(리포트)로 기록하고, 통합자·사용자가 활성 여부를 결정한다. **불합격 시 파라미터 튜닝은 §8 변경 절차로만**(AI 자동조정 금지 §8.4).

#### 9.3.1 게이트 실행 결과 (2026-07-03, 통합자 로컬 dev 실행 — DAR-494 기록)

- 백필: `069500`·`153130` 2,686행(2015~) · `273130` 2,209행(2017~) · `360750` 1,446행(상장 2020-08~). 구간 **2020-08~2026-07**, 비용 반영(ETF 거래세 0).
- **코어(듀얼모멘텀 `alloc:dual-momentum`)**: totalReturn **+375.72%** · 승률 80% · PF 10.49 · **MDD −20.61%** · 거래 10/판정 72.
- **벤치마크(KODEX200 매수후보유)**: +389.28% · **MDD −34.32%** → 코어는 수익률 **96.5%** 유지 + **MDD 40% 개선**(−20.61 vs −34.32).
- **위성(변동성 돌파 `satellite:vol-breakout`)**: totalReturn **−99.33%** · 승률 8.4% · PF 0.04 — 보수적 비용 가정에서 붕괴.

#### 9.3.2 코어 한정 위험조정 게이트 기준 (사후 개정 — §8 사람 승인 2026-07-03)

> 초기 게이트(§9.3 위 3번)는 `totalReturn > 0 && > 벤치마크`(엄격)였다. 코어는 GTAA(전술적 자산배분) 원전 목적(§2-5: 벤치마크와 **유사 수익률** + **MDD 축소**)에 부합하나 절대 수익률이 벤치마크를 근소하게 하회(96.5%)해 엄격 기준으로는 탈락한다. 이는 GTAA 설계 의도(하락 방어)와 상충하므로, 사용자가 §8 3-게이트(문서 개정 → 재검증 → **사람 승인**, 2026-07-03)로 **코어 한정** 위험조정 기준 개정을 승인했다(§8.3 룰 완화 특칙 — 트랙 한정·근거 명시).

| 항목 | 값 |
|---|---|
| **edgePositive(core)** | `totalReturn > 0` **AND** `totalReturn ≥ 벤치마크 × 0.9` **AND** `전략 MDD > 벤치마크 MDD`(MDD 개선; 둘 다 ≤0 → '>'=덜 깊음) |
| 수익률 하한 계수 | **0.9** (`RISK_ADJUSTED_RETURN_FLOOR`) — 벤치마크 대비 ±10% 이내 유사 |
| 적용 범위 | **코어(듀얼모멘텀)에만.** 위성·기타 트랙은 기존 엄격 기준(`>0 && >벤치`) 유지 |
| 코드 | `two-tier-backtest/gate-report.ts` `buildTrackGateMetrics(opts.riskAdjusted)`·`RISK_ADJUSTED_RETURN_FLOOR`·`computeBuyHoldMddPct` |

**활성 결정(2026-07-03, 사용자)**: 위험조정 기준으로 **코어 게이트 통과**(수익률 96.5% ≥ 90% · MDD 40% 개선) → **코어만 forward(모의) 활성**(P13/DAR-494 배선, `alloc:dual-momentum`). **위성은 기각**(§9.1 기각 기록 참조).

---

## 10. 코드 SSOT 포인터 (문서↔코드 대조표)

| 트랙/영역 | 정본 코드 파일 | 핵심 상수 |
|---|---|---|
| 전략 변형 4종 | `engine3-quant-market/backtest/strategies/strategy-presets.ts` | `STRATEGY_PRESETS` · `STRATEGY_INITIAL_CAPITAL` |
| 시스템 모의(청산·한도) | `engine5-trading-risk/paper-simulation/paper-simulation.service.ts` | `DEFAULT_STOP_LOSS_PCT`·`DEFAULT_TAKE_PROFIT_PCT`·`DEFAULT_MAX_HOLD_DAYS`·`MAX_HOLDINGS`·`INITIAL_CAPITAL` |
| **합성 Exit Score 엔진**(§3.2, 시스템 모의·철학·전략 forward 공용) | `engine4-portfolio-exit/domain/exit-score.calculator.ts` | `calculateExitScore`·`scoreToAction`(6-트리거·0~100 사다리·1.5×ATR·트레일링 −6%·하드 오버라이드 EXIT 70) |
| 모의 진입·사이징 | `engine5-trading-risk/paper-simulation/simulation-entry.ts` | `SIM_MIN_ENTRY_GRADE`·`GRADE_SIZING_FACTOR`(등급계수만=`entryBudget`)·`buyScoreSizingMultiplier`(=`entryBudgetScored`, 시스템 모의 전용)·`ENTRY_FALLBACK_MIN_BUY_SCORE` |
| 철학 스타일 | `engine5-trading-risk/paper-simulation/philosophy-style.ts` | `PHILOSOPHY_STYLES`·`STYLE_ENTRY_MIN_FIT` |
| 분봉 단타 신호 | `engine3-quant-market/intraday-scalp/intraday-scalp-signal.ts` | `DEFAULT_SCALP_ENTRY_PARAMS`·`SCALP_ENTRY_TAG` |
| 분봉 단타 청산·상수 | `engine5-trading-risk/paper-simulation/intraday-scalp/intraday-scalp-exit.ts` | `TAKE_PROFIT_PCT`·`STOP_LOSS_PCT`·`MAX_OPEN_POSITIONS`·`PER_POSITION_BUDGET_PCT`·`ENTRY_CUTOFF_HHMM`·`FORCE_EXIT_HHMM` |
| Risk 하드룰 | `engine5-trading-risk/domain/risk-check.types.ts` | `DEFAULT_RISK_LIMITS`·`DEFAULT_AUTO_KILL_CONDITIONS`·`DEFAULT_KILL_SWITCH_MODE` |
| **RiskGuard 공용 진입 게이트** (§7.4) | `engine5-trading-risk/domain/risk-guard-gate.ts` | `evaluateRiskGuardEntry`·`resolveRiskGuardMode`·`DEFAULT_RISK_GUARD_MODES`(측정 SHADOW·코어 ENFORCE)·`RISK_GUARD_DAILY_LOSS_MAX_PCT`. 모델 `RiskDecisionLog`(FK 없음) |
| 체결 파라미터 | `engine5-trading-risk/domain/fill-simulator.ts` | `DEFAULT_FILL_PARAMS`·`roundTripCostPct` |
| **변동성 돌파 위성 신호·사이징** (§9.1) | `engine3-quant-market/volatility-breakout/volatility-breakout-signal.ts` | `computeBreakoutTarget`·`computeVolAdjustedSizing`·`evaluateBreakoutEntry`·`BREAKOUT_ENTRY_TAG` |
| **변동성 돌파 위성 상수** (§9.1) | `engine3-quant-market/volatility-breakout/volatility-breakout.constants.ts` | `VOL_BREAKOUT_K`·`TARGET_DAILY_VOL_PCT`·`VOLATILITY_BREAKOUT_PRESET`·`SATELLITE_TARGET_ETF_CODE` |
| **듀얼모멘텀 코어 판정** (§9.2) | `engine3-quant-market/dual-momentum/dual-momentum-signal.ts` | `computeMomentum`·`decideDualMomentumTarget`·`resolveRebalanceAction`·`decideMonthlyRebalance` |
| **듀얼모멘텀 코어 상수** (§9.2) | `engine3-quant-market/dual-momentum/dual-momentum.constants.ts` | `MOMENTUM_LOOKBACK_DAYS`·`DUAL_MOMENTUM_PRESET`·`CORE_OFFENSE_INTL_CODE`·`CORE_DEFENSE_BOND_CODE`·`CORE_CAPITAL_ALLOCATION_PCT` |
| **2단 프레임·ETF 비용·게이트** (§9.3) | `engine3-quant-market/two-tier-backtest/` | `TWO_TIER_CAPITAL_FRAME`·`ETF_COST_PROFILE`·`backtestCoreDualMomentum`·`backtestSatelliteBreakout`·`assembleGateReport`·`RISK_ADJUSTED_RETURN_FLOOR`(§9.3.2 위험조정)·`computeBuyHoldMddPct` |
| **듀얼모멘텀 코어 forward 트랙**(§9.3.2 활성·모의) | `engine5-trading-risk/paper-simulation/dual-momentum-forward/dual-momentum-forward.service.ts` | `DualMomentumForwardService`(월말 판정=`decideMonthlyRebalance` 재사용·예약→익일 시가 체결)·`ETF_FILL_PARAMS`(거래세 0)·`DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL`(10M). 모델 `DualMomentumForwardTrade`(FK 없음) |

관련 API 문서: `docs/api-specification.md` §18(전략 변형 트랙)·§19(분봉 단타)·§21(시스템 모의·철학 스타일·전략 forward).
스케줄 상세: `docs/workflow.md` §6.7(분봉 단타). 백테스트 리플레이 설계: `docs/roadmap/phase-10-backtest.md`.

---

*정본 버전: 1.7 (2026-07-04). 1.0 DAR-475 신설 → 1.1 DAR-478 §8 변경 절차 장 신설(P07) → 1.2 DAR-485 §8.4 파라미터 민감도 스윕 하니스(read-only 측정·자동조정 없음) 명기(견고화 W3·P24) → 1.3 DAR-491 §9.1 변동성 돌파 위성 확정 룰 선기재·§10 SSOT 포인터 추가(견고화 W1·P14) → 1.4 DAR-492 §9.2 듀얼모멘텀 코어 확정 룰 선기재·§10 SSOT 포인터 추가(견고화 W1·P12) → 1.5 DAR-493 §9.3 2단 자본 프레임·ETF 비용 프로파일·백테스트 엣지 게이트 절차 신설·§10 SSOT 포인터 추가(견고화 W1·P16) → 1.6 DAR-494 §9.3.1 게이트 실행 결과 기록·§9.3.2 코어 한정 위험조정 게이트 기준(§8 사람 승인 2026-07-03)·§9.1 위성 기각 기록(견고화 W1·P13) → 1.7 DAR-496 §7.4 RiskGuard 공용 진입 게이트(일일손실·현금 2종·측정 SHADOW·코어 forward ENFORCE·§8.5 준수)·§10 SSOT 포인터 추가(견고화 W2·P18). 출처: 견고화 계획 `docs/roadmap/cc-trading-robustness-plan-2026-07-03.md §4 P06·P07·P24·P14·Wave1·Wave2`.*
*설립 시점 전값은 코드 상수를 무보정 전사했다(code=truth). 이후 변경은 §8 변경 절차(문서 개정→재검증→사람 승인)를 따른다.*
