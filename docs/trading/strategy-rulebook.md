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
- **발효 이후 변경 절차(P07 선연계)**: 규칙 변경은 **① 이 문서 개정 → ② 재검증(백테스트/모의 엣지 확인) →
  ③ 사람 승인** 을 거친 뒤에만 코드 상수에 반영한다. **문서 개정·승인 없이 코드 상수만 바꾸는 것을 금지**한다.
  변경 절차의 정식 명문화는 P07의 소관이며, 이 문서가 그 전제다.
- **신규 트랙 선기재(P06 원칙)**: 향후 신규 트랙(Wave 1 코어·위성 등)의 진입/청산/사이징/한도 룰은 **구현 착수 전
  이 문서 §6에 먼저 기재**한다. 코드가 문서를 앞서지 않는다. → §6 참조.
- **M10 클록 보호**: 측정 중인 트랙(시스템 모의·전략 4종·철학 4종·분봉 단타)의 **매매 행동 값은 이 문서로 변경하지
  않는다**. 이 문서는 현재 코드 값을 서술·통합할 뿐, 값을 조정하지 않는다(측정 트랙 무수정).

---

## 1. 공통 규약

| 항목 | 값 | 출처(코드/문서) |
|---|---|---|
| 초기 가상원금(전 트랙) | **10,000,000 KRW** | `STRATEGY_INITIAL_CAPITAL` · `PaperSimulationService.INITIAL_CAPITAL` · `SCALP_INITIAL_CAPITAL` (모두 10_000_000) |
| 진입 시점(일봉 트랙) | **다음 거래일 시가**(`NEXT_OPEN`) — 공시 당일 체결 금지(lookahead bias 방지) | `StrategyParams.entryRule` · engine5 CLAUDE.md §"진입 규칙" |
| 장마감(15:30) 후 공시 | +2 거래일 시가 진입 | engine5 CLAUDE.md §"진입 규칙" |
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

각 전략은 **두 표면**으로 운용된다(동일 `preset` 상수, 청산 적용 방식만 다름):
1. **백테스트 리플레이**(§18) — 과거 1년 point-in-time 재생(`BacktestRun`/`BacktestTrade`), 매일 05:00 KST 갱신.
   청산은 `BacktestRunnerService`가 아래 `exitRules`를 **리터럴 트리거**로 판정(익절/손절/최대보유 도달 = 청산).
2. **라이브 forward 모의**(§21.3, live-readiness W1) — 라이브 신호에 동일 `preset.params` 적용,
   전용 포트폴리오 `styleTag='strategy:<key>'`, 평일 **19:45 KST** 크론(`paper.strategy-forward`).
   청산은 시스템 모의와 같은 engine4 **합성 Exit Score(6-트리거, §3.2)** 경유
   (`strategy-forward-simulation.service.ts:524 calculateExitScore(..., [])`, 공시 이벤트 빈 배열) — 아래 `exitRules`는
   그 합성 안의 하드 오버라이드 보장선(`stopLossPct`·`takeProfitPct`·`maxHoldDays` 포지션 주입값)이 된다.

공통: `entryRule='NEXT_OPEN'` · `initialCapital=10,000,000`. 아래 표의 사이징(`sizeRule`)은 **백테스트 리플레이의 배분 룰**이다.

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

---

## 8. Wave 1 예정 트랙 — 선기재 대기 (구현 착수 전 여기 확정)

> **P06 원칙**: 신규 트랙 룰은 **구현 착수 전 이 섹션에 먼저 기재**한다(문서가 코드를 앞선다).
> 아래는 계획(`cc-trading-robustness-plan-2026-07-03.md §4 Wave 1`)상 예정 트랙의 **자리표시(placeholder)**다 —
> 실제 룰 값·상수는 각 구현 이슈(P12/P14)가 이 표를 채우고 승인받은 뒤에야 코드로 내려간다. **아직 미확정(TBD)**.

| 예정 트랙 | 유형 | 계획 ID | 룰 개요(초안, 미확정) | 자본 프레임 |
|---|---|---|---|---|
| 듀얼모멘텀 코어 | 코어(자산배분) | P12·P13 | 상대(미S&P500 vs KODEX200 12개월) + 절대(음수면 채권 대피). 월말 리밸런싱. `styleTag='alloc:dual-momentum'` | 2단 프레임 코어 65% (P16) |
| 변동성 돌파 위성 | 위성(단기) | P14·P15 | 목표가 = 시가 + 전일 Range×K(0.5) + **변동성 조절 사이징**. 익일 시가 청산. `styleTag='satellite:vol-breakout'` | 2단 프레임 위성 25% (P16) |

- **활성 게이트(P16)**: 2단 자본 프레임(코어 65% / 위성 25% / 버퍼 10%) + **백테스트 엣지 양수 게이트** — 게이트 통과 전 forward 활성 금지.
- **선기재 절차**: P12/P14 구현 이슈는 (1) 진입/청산/사이징/한도 전값을 이 §8에 확정 기재 → (2) 사람 승인 → (3) 순수 함수·프리셋 구현.

---

## 9. 코드 SSOT 포인터 (문서↔코드 대조표)

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
| 체결 파라미터 | `engine5-trading-risk/domain/fill-simulator.ts` | `DEFAULT_FILL_PARAMS`·`roundTripCostPct` |

관련 API 문서: `docs/api-specification.md` §18(전략 변형 트랙)·§19(분봉 단타)·§21(시스템 모의·철학 스타일·전략 forward).
스케줄 상세: `docs/workflow.md` §6.7(분봉 단타). 백테스트 리플레이 설계: `docs/roadmap/phase-10-backtest.md`.

---

*정본 버전: 1.0 (2026-07-03, DAR-475 신설). 출처: 견고화 계획 `docs/roadmap/cc-trading-robustness-plan-2026-07-03.md §4 P06`(PR #441).*
*설립 시점 전값은 코드 상수를 무보정 전사했다(code=truth). 이후 변경은 §0 절차(문서 개정→재검증→사람 승인)를 따른다.*
