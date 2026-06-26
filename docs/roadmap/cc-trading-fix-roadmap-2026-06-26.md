# 자동 매수/매도·모의매매 결함 수정 로드맵 (SSOT)

- 작성일: 2026-06-26
- 작성 근거: 4축 코드 감사 → 13건 결함 심층 fix-spec 작성 → 적대적 검증 → 순서·릴리스 게이트 설계 (멀티에이전트 워크플로우 `trading-fix-roadmap`)
- 상태: **P0 + engine3 신호레인 구현 완료** (브랜치 `feat/trading-fixes-p0-engine3`) — 아래 진행 현황

### 진행 현황 (2026-06-26)
| Phase | fix | 상태 | 검증 |
|---|---|---|---|
| P0 | **F4** 통지 enum+dedup | ✅ 완료 | tsc 0 · 신규 통지 spec + 회귀 그린 |
| P0 | **F12** 졸업 표본 5→20 | ✅ 완료 | 4 fixture spec 그린 |
| P0 | **L[1]** 단타 가격결측 0% 날조 방지 | ✅ 완료 | 신규 spec 3건(동일 tradeDate 폴백) |
| P0 | **L[2]** 유동성 오라벨 정정 | ✅ 완료 | 주석만(동작 0) |
| 신호레인 | **F10** 거짓 corroboration 게이트 | ✅ 완료 | bucket-renorm spec 갱신+신규 |
| 신호레인 | **F9** 등급 임계 50/45/30 | ✅ 완료 | 5 spec 갱신, DAR-322 경계 보존 |
| — | **전체 회귀** | ✅ | `tsc 0` · `npm test` **242스위트 3200건 그린** · `npm run build` 통과 |
| P1 | F2(부분익절)·F1·F3 청산엔진 | ⬜ 대기 | 다음 작업 |
| P2 | F7·F8(Phase1) | ⬜ 대기 | |
| P3 | (F5+F11)→F6 리스크 게이트 | ⬜ 대기 | |
| 후속 | L[3] 강제청산 catch-up + 보류 5건 | ⬜ 백로그 | |
| P5 | 재검증·릴리스(0.1.0) | ⬜ | 전 PR 머지 후 |

> 커밋: F4 `608629d3` · F12 `5e28c147` · L `153ab9f4` · F10 `5b110087` · F9 `d71cf7c9` (브랜치 `feat/trading-fixes-p0-engine3`, main 미머지)
- 관련 정본: `docs/roadmap/buy-logic-validation-baseline.md`(엣지 baseline), `docs/roadmap/01-execution-roadmap.md §3`(회귀 매트릭스), `docs/roadmap/cc-mvp-definition.md §9`(졸업 게이트)

> 이 문서는 "직접 확인해가며 수정 → 새 버전 발행"의 기준선이다. 각 fix는 적대적 검증을 통과한 **교정안**을 기준으로 기술한다. 4건(F1·F3·F6·F9)은 1차 원안이 결함이 있어 폐기되었으니, 반드시 본 문서의 "수정안(교정)"을 따른다.

---

## 0. 배경과 핵심 원칙

### 0-1. 무엇이 문제인가 (감사 종합)
- **논리 타당성**: 매수·매도 룰 구조는 정교하나 **백테스트상 엣지가 없다**(baseline: totalReturn −14.5%, winRate 23%, 4개 전략 전부 음수익). 게다가 일부 핵심 트리거가 코드상 **작동조차 하지 않는다**.
- **시스템 처리 정합**: 내부 회계 항등식(평가자산=현금+보유시가)·중복방지·현금가드는 견고하지만, **손절이 실효 발화하지 않고**, 체결이 무마찰이며, 리스크 하드룰이 실행 경로에 결선되어 있지 않다.

### 0-2. 릴리스 원칙 (정직 게이트)
> **plumbing(손절·익절·회계·kill-switch) 정확성은 hard gate. "엣지 존재"는 hard gate가 될 수 없다.**

- 코드가 명세대로 동작함(정확성)을 증명하면 → **버전 발행 가능**(손익이 음수여도 막지 않음).
- 엣지가 미확인이면 → **execution(실주문/자동매매) 비활성 유지 + paper/research 라벨**.
- 졸업(M10)·실주문 승격(M11)은 별도 휴먼 승인 게이트(엣지·30일 모의·라이브 AI 스모크).

### 0-3. 불가침 제약 (모든 fix 공통)
- **AI 금지영역(Engine5 Risk 독립)**: 주문승인·하드룰·손익절·수량·리스크에 AI 개입 0. 변경 파일에 engine2/LLM import 금지.
- **과거 수정 보존**: DAR-433(cross-source 가짜손절 차단)·DAR-444(단타 청산시각 가드레일)·DAR-366(실시간 손절)·DAR-426(현금 음수 불가)·DAR-321/322(가짜 BUY 인플레이션 방지)를 **재유발하지 않는다.** (§7 주의 섹션)
- **DoD**: 매 PR `tsc --noEmit` 0 · `npm run build` · `npm test` 그린(회귀 0) · 문서 동기화 · main 직접 커밋 금지(`feat/<id>-<slug>` 브랜치 + PR, 격리 worktree).
- **스키마 변경 0**: 13건 모두 schemaChange=false. 스키마를 끌어들이는 옵션은 전부 보류/별도 직렬 PR(휴먼 ask)로 격리(§2).

---

## 1. 결함 카탈로그 (13건)

> 표기: 심각도 / effort(S·M·L) / 적대검증(✓ 통과, ✗ 원안결함→교정필수) / 의존

### 🔴 F1 — 실시간 손절이 cross-source 정렬에 상쇄됨 (높음 / M / ✗ / —)
- **근본원인**: 포지션은 장마감 후(19:30) cron으로만 개시되어 `entryPriceSource`가 거의 항상 `REAL`(정체 일봉). 장중 모니터가 실시간가를 적재해도 `evaluateExits → alignedPriceRow(entrySource)`가 entry=REAL에 정렬하느라 실시간 행을 버리고 정체 일봉으로 평가 → 장중 −8% 손절이 영영 미발화. `paper-simulation.service.ts:1071,1496-1510`, 진입소스 기록 `:888-890`.
- **현재동작**: 세 spec(intraday-exit-monitor / realtime-stoploss-price / cross-source-alignment)이 모두 그린인데 결함 통과 — 앞 둘은 픽스처에 `entryPriceSource`가 없어(undefined → 정렬 면제) 결함 경로를 한 번도 안 탄다. 즉 "장중 + entry=REAL" 교차점이 미검증.
- **수정안(교정)**: `evaluateExits(portfolioId, tradeDate, opts:{intraday?})` 시그니처 추가. `runDailyCycle`은 무인자(=일일 경로 불변, DAR-433 보존), `runIntradayExitMonitor`는 `{intraday:true}`. 신규 헬퍼 `exitPriceRow(corpCode, tradeDate, entrySource, intraday)`:
  - `intraday=false` → 기존 `alignedPriceRow`(불변).
  - `intraday=true` → 실시간 행 우선. `entrySource==='REAL'`일 때만 신선도 가드: **REAL 일봉 sourceDate와 실시간 sourceDate의 〈거래일 차〉(달력일 아님)** 가 임계(1~2 거래일) 이하면 실시간 신뢰(손절 발화), 초과(정체 일봉)면 정렬된 REAL로 폴백(DAR-433 가짜손절 차단).
  - **실시간 부재**(`day.source!=='REALTIME'`)면 raw day가 아니라 `alignedPriceRow(entrySource)`로 폴백(SYNTHETIC/하이브리드 정렬 보존).
- **⚠️ 원안 폐기 이유**: 원안의 `calendarDayDiff + 임계 2`는 **금→월(갭3)·연휴 직후(갭4~6)에 가드가 정체로 오판** → 운영 전 포지션의 장중 손절을 매주 월요일 전면 억제(DAR-366 ~1/5 거래일 재유발). 반드시 **거래일 차**로 계산.
- **검증**: 기존 3종 그린 유지 + 신규 2~3 케이스 (A)장중·entry=REAL·신선일봉·실시간 −10% → EXIT 발화 (B)장중·entry=REAL·정체일봉·실시간 −10% → 미발화(DAR-433 보존) **(C)장중·entry=REAL·REAL바=직전 금요일·실시간 월요일 −10% → EXIT 발화**(월요일 회귀 차단, 필수). 실시간 sourceDate는 `fetchedAtMs` 주입으로 결정론화(플래키 방지).
- **파일**: `paper-simulation.service.ts`, `paper-simulation/intraday-exit-monitor.spec.ts`.
- **열린결정**: 신선도 임계 = **거래일 1~2**(권장) 중 확정.

### 🔴 F2 — 익절(Take-Profit) 자동청산 부재 (높음 / M / ✓ / —)
- **근본원인**: `calculateExitScore`가 `pos.takeProfitPct`를 한 번도 읽지 않음(`exit-score.calculator.ts:419-499`). `TAKE_PROFIT` enum은 있으나 발화 경로 전무. `DEFAULT_TAKE_PROFIT_PCT=20`은 저장만 됨. 수익 포지션은 `calcPositiveMomentumBonus` 감산으로 청산점수가 오히려 낮아짐(승자 달리게 두기 — **의도된 설계**, 결함 아님).
- **수정안(교정)**: 손절 하드오버라이드(`:462-464`) 직후 순수 Rule 하드 익절 오버라이드 삽입:
  ```
  const tpPnlPct = pos.entryPrice>0 ? (tech.closePrice-pos.entryPrice)/pos.entryPrice*100 : 0;
  if (pos.takeProfitPct!==null && tpPnlPct >= Math.abs(pos.takeProfitPct)) {
    exitScore = Math.max(exitScore, 70);   // EXIT 플로어(90 BLOCK_REBUY로 올리지 말 것)
    takeProfitHit = true;                  // 블록 밖 let 스코프
  }
  // triggerTypes.unshift('TAKE_PROFIT') → primaryTrigger=TAKE_PROFIT
  ```
  컴포넌트(`ExitScoreComponents` 7키)·rawScore·모멘텀 보너스는 **무변경**(스키마/스냅샷 보존). evaluateExits는 무변경(EXIT 반환 시 기존 SELL 경로 자동 발화). TP는 손절과 동일 가격소스(`tech.closePrice`) 사용 → DAR-433/366 보존, 손익부호상 손절과 충돌 불가.
- **⚠️ 원안 검증 오류**: "synthetic-cycle.spec을 +20% 도달로 기대값 갱신"은 틀림 — 이 픽스처는 +1.01%라 TP 미발화, **무수정 통과가 정답**. 대신 **종가 ≥ entry×1.2 신규 sim 픽스처 1건**을 추가해 TP→SELL→`exitReason=TAKE_PROFIT` end-to-end 검증(현재 어떤 sim spec도 이 경로 미커버).
- **검증**: exit-engine.spec에 단위 4케이스(+20%→EXIT/+18.6%→HOLD/null→HOLD/모멘텀 보너스 공존에도 TP 우선) + sim 통합 1건.
- **파일**: `exit-score.calculator.ts`, `exit-engine.spec.ts`, `exit-score.calculator.regression.spec.ts`, sim 픽스처.
- **열린결정**: 전량 EXIT(권장) vs REDUCE 부분익절(Position 분할 필요·후속), TP 기본 20 유지 여부, 모멘텀 보너스 존속(권장).

### 🔴 F3 — evaluateExits 희소입력으로 6트리거가 −8% 단일 하드스탑으로 붕괴 (높음 / M / ✗ / —)
- **근본원인**: `evaluateExits`가 `calculateExitScore`에 공시이벤트 `[]`·기술지표(ma/atr/vwap/excessReturn 등) `null`을 넘김(`paper-simulation.service.ts:1094-1108`). 트레일링·차트붕괴·논리붕괴·시간초과·공시악재가 전부 EXIT(70) 미달 → 사실상 −8% 손절만 작동. **데이터는 실재**(technical_indicators 17만행, disclosure_events 13만행) — "주입을 안 해서" 생긴 결함. 부가: `low20`이 당일 저가로 채워져(`:1099`) 20일 저가 이탈 가점 영구 불발.
- **수정안(교정)**: evaluateExits의 tech/events 빌드만 교체(계산기 임계 70·가중 **불변** — 임계 하향안은 거짓 EXIT 위험으로 기각).
  - `loadTechnicalSnapshot`: `day.source∈{REAL,REALTIME}`일 때만 `technicalIndicator.findFirst({stockCode, tradeDate:{lte: day.sourceDate}}, desc)`로 ma5/ma20/atr14/vwap 주입. `SYNTHETIC`은 null 유지(한 종목 한 소스). `low20`은 `stockDailyPrice` 20거래일 min으로 별도 계산(`:1099` 동시 수정).
  - `loadNegativeDisclosureEvents`: `polarity=NEGATIVE` 또는 고위험타입만(호재 누적 거짓EXIT 방지). **`rcpDt` 상한은 코드베이스 표준 `lte:\`${until}999999\``** (천장 없으면 당일 타임스탬프 공시 누락). **SYNTHETIC이면 `[]` 반환**(정직 원칙·verification 정합).
- **⚠️ 원안 폐기 이유**: ① rcpDt 999999 천장 누락 → 당일 TRADING_SUSPENSION 등 청산대상 공시 누락 ② `low20From`의 stockDailyPrice 목 누락 → 비SYNTHETIC spec(intraday-exit-monitor 등) throw(루프에 try/catch 없음) ③ loadNegativeDisclosureEvents SYNTHETIC 가드 누락 ④ "고위험 공시 단독 EXIT70" 산술 비정합(공시 단독은 severe min WATCH 30, 안전3원칙). 신규 테스트의 EXIT70은 **loss=20 오버라이드(atr14+트레일링)** 경로로 구성.
- **검증**: 신규 `evaluate-exits-enrichment.spec.ts` + 회귀 spec들 prisma 목에 `technicalIndicator.findFirst`·`disclosureEvent.findMany`·`stockDailyPrice`(low20용) 추가(null/[] degrade).
- **파일**: `paper-simulation.service.ts` + 회귀 spec 다수 + 신규 spec.
- **열린결정**: 파생필드 phase(volumeRatio/excessReturn5d는 phase-2), 공시 윈도우(보유기간 vs 트레일링 N일), low20 동시수정(권장).

### 🔴 F4 — 매수신호 통지가 SignalGrade enum 불일치로 영구 미발화 (높음 / S / ✓ / —)
- **근본원인**: `NOTIFY_GRADES = Set(['STRONG_BUY','BUY'])`(`signal-generation.service.ts:218-221`)인데 실제 등급은 `'STRONG_BUY_CANDIDATE'`/`'BUY_CANDIDATE'`(`buy-signal.service.ts:131-138`, schema.prisma:992-999). 게이트(`:1291`)가 항상 false → **모든 매수신호 푸시가 조용히 차단**. `ReadonlySet<string>`이라 컴파일러가 못 잡음.
- **수정안(교정)**: 리터럴을 `'STRONG_BUY_CANDIDATE'`/`'BUY_CANDIDATE'`로 교정. 타입강화는 **`@prisma/client`의 기존 `SignalGrade`(line 14 import) 재사용**으로 `ReadonlySet<SignalGrade>`.
- **⚠️ 원안 주의**: 원안의 `import type { SignalGrade } from '../buy-signal/...'`는 line 14 기존 import와 **Duplicate identifier 컴파일 에러** → 금지.
- **검증**: 신규 notify spec(양성 STRONG/BUY 각 1회 enqueue / 음성 WATCH·NEUTRAL 미호출 / 재채점 음성). 운영: 수정 전 `trading_signals` *_CANDIDATE >0 인데 notifications type='SIGNAL' =0 대조 → 수정 후 enqueue 로그 증가.
- **파일**: `signal-generation.service.ts` (+ 신규 spec).
- **열린결정**: STRONG_BUY_CANDIDATE만 vs 둘다 통지 / **persona fan-out 중복**(공시1건당 watcher에게 최대 4푸시, signalId가 persona별로 달라 dedup 안 됨) 정책 / 첫 cron 스파이크 컷오프.

### 🔴 F5 — 분봉 단타 진입이 kill-switch 우회 (높음 / S / ✓ / F11)
- **근본원인**: `intraday-scalp.service.ts:549` `killSwitchActive:false` 하드코딩 + 생성자가 `KillSwitchManager` 미주입 + 모듈이 `TradingRiskModule` 미import → kill-switch ON이어도 단타 진입 계속.
- **수정안(교정)**: ① 모듈 imports에 `TradingRiskModule` 추가(공유 싱글톤 강제 — 별도 인스턴스 금지, in-memory state 미전파 버그 재발). ② 생성자에 `@Optional() killSwitch?: KillSwitchManager`(5번째 위치, 테스트 호환) + 미주입 시 경고 로그. ③ runEntryCycle 게이트 추가 `if (this.killSwitch?.isActive()) return {...base, reason:'킬스위치 발동'}` + line 549를 `this.killSwitch?.isActive() ?? false`로. 청산/forceCloseAll은 미변경(킬스위치는 진입만 차단).
- **검증**: 격리 생성 케이스 + **모듈 결선 테스트**(`Test.createTestingModule({imports:[IntradayScalpModule]})`로 import 제거 회귀 자동 포착 — @Optional false 폴백을 테스트 불변식으로 강제).
- **파일**: `intraday-scalp.service.ts`, `.module.ts`, `.service.spec.ts`.
- **열린결정**: @Optional(권장) vs required / line 549는 F11과 동일 호출부 → §3 클러스터 B로 묶어 처리.

### 🟡 F6 — 리스크 하드룰(OrderRiskService)이 모든 모의 실행루프에 미결선 (중간 / M / ✗ / —)
- **근본원인**: `OrderRiskService.evaluateOrder`(진짜 veto+영속 kill-switch 조회+TradingAuditLog) 실호출자 0. 5개 체결 경로(paper-trade.placeOrder / philosophy-style / paper-simulation / orchestrator / persona) 전부 게이트 우회. 단타만 checkRisk를 부르나 killSwitchActive 하드코딩.
- **수정안(교정)**: 논리적 단일 게이트 = `evaluateOrder`(이미 kill-switch·audit 내장). 물리 초크포인트:
  - [A] `PaperTradeService` 생성자에 `@Optional() orderRisk?`, placeOrder에 `riskContext` + **BUY일 때만** evaluateOrder 호출, reject면 `filledShares:0/status:'BLOCKED'` 비영속 반환(호출자는 이미 ≤0이면 스킵).
  - [B] orchestrator·intraday-scalp는 evaluateOrder 명시 호출(@Optional 미주입 시 현행 폴백).
- **⚠️ 원안 폐기 이유(다수)**: ① `currentPositionValue=fillPrice*shares`는 risk-check이 다시 +orderValue → **2배 계상**(신규는 0이어야) ② `fillPrice`는 placeOrder 반환 후 산출 → **미정의 참조**(price*shares 사용) ③ `openOrderCount/todayTradeCount=opened` → 사이클당 5/10건 **조용한 throttle**(30일 모의 표본 훼손) ④ singleBuyMaxPct 3% vs 사이징 10% **한도 충돌**(다수 진입 차단) ⑤ 사이클 spec이 placeOrder 스텁이라 **허위 그린** ⑥ intraday-scalp.module이 TradingRiskModule 미import → **무동작**.
- **수정안(교정 필수)**: ① currentPositionValue=해당 corpCode 기존 OPEN 보유가치(신규 0) ② limitPrice=price ③ openOrder/today=보수적 0 또는 실제 스냅샷(opened 매핑 금지) ④ **모의 전용 RiskLimits**(singleBuy≥사이징 envelope) 또는 단일종목 상한은 기존 사이징 가드에 위임 ⑤ **실 배선 통합 테스트**(스텁 아님 — kill off=진입불변, on=0) ⑥ TradingRiskModule import ⑦ **BUY-only 절대 준수**(SELL/청산을 kill-switch로 막으면 DAR-366 실시간 손절·DAR-444 15:20 강제청산 차단 → "거짓 안전" 재유발).
- **파일**: `paper-trade.service.ts`, `trading-risk.module.ts`, `paper-simulation.service.ts`, `philosophy-style-simulation.service.ts`, `simulation-orchestrator.service.ts`, `intraday-scalp.service.ts` + 모듈들.
- **열린결정**: §8 Tier1 — BUY-only 확정 / riskContext 산정 / 모의 전용 한도.

### 🟡 F7 — 매수 수수료가 운영 회계에서 폐기 + PaperPortfolio 죽은코드 (중간 / S / ✓ / —)
- **근본원인**: 체결기가 산출한 매수 commission(0.015%)이 entryAmount·netPnl·현금에 미반영(`paper-simulation.service.ts:949,979,1156`). 정확한 `PaperPortfolio.applyTrade`는 죽은 코드(+슬리피지 이중차감 자체버그). 동일 결함 philosophy-style `:477`.
- **수정안(교정)**: 갈래(a) Position 경로 직접 수정(스키마 0):
  - 청산: `buyCommission = p.entryAmount * DEFAULT_FILL_PARAMS.commissionRate; netPnl = grossPnl - buyCommission - sell.commission - sell.tax`(entryAmount==매수 체결금액이라 정확, intraday-scalp:646-650 패턴과 동치).
  - 진입 현금가드(`:979`): `availableCash -= fillPrice*shares + (trade.commission ?? 0)`.
  - philosophy-style `:477` 동일 + **`import { DEFAULT_FILL_PARAMS }` 추가**(누락 시 빌드실패).
  - PaperPortfolio는 **활성화 금지** → `@deprecated` 주석 + 슬리피지 이중차감 메모만(별도 클린업 이슈).
- **검증**: 신규 `buy-commission-accounting.spec.ts`(unrealizedPnl=grossPnl−entryAmount×0.00015−sellComm−sellTax 일치, roundTripCostRate 정합 교차검증).
- **파일**: `paper-simulation.service.ts`, `philosophy-style-simulation.service.ts`, `paper-portfolio.ts`(주석만).
- **열린결정**: 수수료 출처 commissionRate 재구성(권장·스키마0) vs entryFee 컬럼(스키마) / L979 가드강화 동일 PR vs 분리(분리 권장).

### 🟡 F8 — 무마찰 체결 현실화 (중간 / L / ✓ / —)
- **근본원인**: ① `liquidityRatio=1.0` 하드코딩 → 부분체결 영구 비활성(항상 전량) ② 슬리피지 규모·거래량 무관 고정 0.05% ③ 체결가가 KRX 호가단위 미반올림(50025원 같은 비호가 가격). 거래량 데이터는 가용한데 simulateFill에 미전달.
- **수정안(교정)**: **2단계 분리**.
  - **[Phase 1 — 이번 릴리스] KRX 호가단위 반올림(저위험)**: `krxTickSize(price)`(7구간) + `roundToTick(price, direction)`("불리한 방향 고정" BUY ceil/SELL floor → 슬리피지 항상 비용). 현금가드 정합을 위해 `:913` effPrice도 동일 roundToTick. fill-simulator spec 틱값 갱신 + **불변식 단언**(BUY>entry, SELL<entry, 틱그리드 정수).
  - **[Phase 2 — 백로그 분리] 거래량 기반 동적 슬리피지/부분체결**: 매도 PARTIAL이 전량청산 전제(`status=CLOSED` 무조건)와 충돌 → 유령청산 위험. K/floor/α 상수 미정(근거 필요). **이번 릴리스 제외.**
- **⚠️ 주의**: 저가주 틱 증폭(왕복 비용이 SSOT 0.31% 초과)을 "테스트 통과용 동결"로 숨기지 말고 주석/문서 고지. roundTripCostRate에 틱증분 반영 여부는 열린결정.
- **파일**(Phase1): `fill-simulator.ts`, `paper-trade.types.ts`, `fill-simulator.spec.ts`, `paper-simulation.service.ts`, `engine5-trading-risk/CLAUDE.md`.
- **열린결정**: §8 Tier1 — Phase1만 확정 / 반올림 방향 / 틱증분 SSOT 반영.

### 🟡 F9 — 소비자 등급 임계값(80/60/30)을 실측 분포에 재보정 (중간 / M / ✗ / F4·F10)
- **근본원인**: 실측 max=88·p95=33인데 임계 80/60/30 고정(`buy-signal.config.ts:74-80`) → STRONG 0.01%·BUY 0.1%, 93%+ NEUTRAL 침강(등급 변별력 붕괴). DAR-413이 전략 진입 임계만 30~50으로 재보정하고 소비자 등급은 stale.
- **수정안(교정)**: a-priori frozen 상수 재보정(런타임 퍼센타일은 point-in-time 누수로 기각). **BUY=45**(p99 ~1.2%, 보수성 경계 위), WATCH=30. STRONG 최종값은 §8 결정. `scoreBandOf` 라벨을 상수에서 파생(재발 방지). signal-accuracy.**service**.spec.ts:94 동반 수정.
- **⚠️ 원안 폐기 이유**: 권장 **BUY=40이 score 41(SHARE_BUYBACK ratio=0.1 무의미 규모)을 BUY로 격상** → DAR-322 보수성 가드 무력화, diagnostic:221-223 FAIL. → **BUY=45로 41 경계 위에 둔다.** 또한 통지효과(F4)·분포의존(F10)이 선행: **F10 머지 후 분포로 임계 재산출**, F4 없이는 통지효과 0.
- **검증**: buy-signal/signal-accuracy/signal-feature-ab/diagnostic spec 갱신 + 수정 후 diagnostic 재실행해 무의미규모 이벤트가 확정 BUY 미만임을 콘솔 확인.
- **파일**: `buy-signal.config.ts`, `signal-accuracy.ts`, `calibration.ts`, `bucket-renormalization.ts`(주석), 다수 spec, `buy-logic-validation-baseline.md`.
- **열린결정**: §8 Tier1 — STRONG/BUY/WATCH 사다리 최종값(50/45/30 권장).

### 🟡 F10 — 결측 재정규화가 상관버킷에 가중 집중 → buyScore가 상수로 수렴 (중간 / M / ✓ / —)
- **근본원인**: `renormalizeWeights`가 결측 버킷을 빼고 가용분을 합=1.0 재정규화하는데, disclosureEvent/keyMetric/personaFit/fundamental 4개는 **같은 공시 파생(강상관)**. 독립증거(chart/historical/volume/market/insider)가 전부 결측이면 상관버킷에 100% 몰려 buyScore≈EVENT_BASE_SCORES 상수로 수렴(corroboration 환상).
- **수정안(교정)**: 안전한 1차 완화책. renormalizeWeights에 게이트: 결측 없으면 base 반환(회귀0), **독립증거 1개라도 가용이면 기존 합=1.0 경로 불변**, **독립증거 0개일 때만** 상관그룹 내부 재정규화하되 그룹 effective 합을 그룹 base 합(0.5915)으로 캡(빠진 독립가중은 중립 drag로 점수를 0쪽 축소). 상수는 `import type { BucketKey }`로 순환 회피. bucket-renorm spec:137(버그 인코딩) 동일커밋 갱신 + sum≤1 불변식 + 음수점수 압축 케이스.
- **⚠️ 주의**: signal-feature-ab는 독립버킷 강제 true라 게이트 미발화 → **AB 백테스트 rebaseline 불필요**(원안 과장 정정). 이동 대상은 LIVE 리플레이 baseline뿐.
- **파일**: `bucket-renormalization.ts`, `buy-signal.config.ts`, spec 2종.
- **열린결정**: NO_CORROBORATION_GROUP_FACTOR(1.0 vs <0.8) / fundamental.growth 독립 분리(후속) / insider 독립 인정(권장).

### 🟡 F11 — 단타 checkRisk 입력 부정확 (중간 / M / ✓ / F5)
- **근본원인**: `weeklyPnl`이 당일 실현손익과 동일(`intraday-scalp.service.ts:545-546`) → 주간 손실한도(−5%) 사실상 무력. `currentPositionValue:0` 고정(단타 dedup+EOD 청산 불변식상 값은 맞으나 의도 가림).
- **수정안(교정)**: `weekStartCompact`(월요일 시작 KST 주) + `weeklyRealizedPnl(tradeDate)`(주 시작~tradeDate netPnl 합) 추가, line 546을 `weeklyPnl: weeklyRealized`로. currentPositionValue=0 유지 + 불변식 주석("EOD 강제청산 성공 전제"). **F5와 동일 호출부 → `buildScalpRiskInput` 단일 헬퍼로 묶어 착지.**
- **⚠️ 검증 필수**: `buildPrismaMock`의 findMany가 `{gte,lte}` 객체를 못 받으면 [] 반환 → 신규 WEEKLY 테스트 **가짜 그린**(검증 사각). 목 분기 확장 필수 + 'WEEKLY_LOSS_LIMIT' 로그 단언으로 실발화 증명.
- **파일**: `intraday-scalp.service.ts`, `.service.spec.ts`.
- **열린결정**: 주간 윈도우=월요일 KST주(권장) / 미실현 MTM 포함 여부.

### 🟡 F12 — 졸업 게이트 표본 하한(=5) 과소 (중간 / S / ✓ / —)
- **근본원인**: `GRADUATION_MIN_SAMPLE=5`(`graduation-gates.ts:15`)에서 55% 적중 판정은 이항잡음 압도(3/5=60% 통과). 단타 트랙 20과 불일치.
- **수정안(교정)**: **20으로 확정**(단타 LOW_SAMPLE_THRESHOLD=20과 정합 — 제목 근거 성립, 30일 윈도우 도달성도 30보다 안전). 4개 fixture 동시 갱신(graduation-gates/controller/metrics/ops-metrics, evaluated/hits/accuracyPct 내부정합 유지). cc-mvp-definition.md §9에 "졸업 표본 하한=20" 1줄.
- **⚠️ 주의**: 30은 distinct 값 5종 신설로 SSOT drift 악화 + 윈도우 내 도달 불가 위험. 중복 신규 테스트(기존 72-89와 동일)는 생략.
- **파일**: `graduation-gates.ts` + 4 spec + `cc-mvp-definition.md`.
- **열린결정**: 20 확정 동의 / LOW_SAMPLE 상수 난립(5/5/5/20) SSOT 통합은 별도 이슈.

### ⚪ L — 낮은 심각도 묶음 트리아지 (낮음 / M / ✓ / —)
- **[즉시] 단타 강제청산 가격결측 0% 폴백**: `intraday-scalp.service.ts:731,753`이 가격 null이면 진입가 폴백 → 0% 손익으로 영속(실손실 은폐). 수정: runExitCycle null이면 skip+warn / forceCloseAll은 **폴백체인**(실시간→당일 분봉종가→**당일(동일 tradeDate) 일봉종가**→진입가 최후폴백+`logger.error` priceMissing).
  - **⚠️ 교정 필수**: 일봉 폴백을 `orderBy desc`로 하면 15:20 시점 당일 일봉 미수집 → **어제 종가를 오늘 PnL로 영속(cross-day 가짜손익, DAR-433 재유발)**. 반드시 `findFirst({where:{stockCode, tradeDate: t.tradeDate}})`(동일 거래일 한정).
- **[즉시] volume-liquidity "하드 차단" 오라벨**: `-100`은 veto 아님(가중합산 ≈−9). 주석만 정정("강한 감점, veto 아님; 실제 차단은 entryCondition 게이트 — 단 buyScore≥50 폴백 경로로 절대적 아님"). 동작 0.
- **[이번 릴리스] 단타 강제청산 catch-up**: 15:20~15:30 프로세스 다운 시 오버나잇 잔존 + 익일 정리 부재. 익일 개장 stale sweep(`status:OPEN, tradeDate<오늘`을 해당 거래일 15:30 clamp로 청산) — runExitCycle force-time 경로에 동일 resolveExitPrice 재사용 권장.
- **[후속 보류 5건]**: REDUCE 부분청산 / MDD·Sharpe 지표 / RSI +20 베이스라인 재캘리브 / countTradingDays 공휴일 / unrealizedPnl 리네이밍. 각각 기능추가·스키마·백테스트 의존 → 백로그.
- **파일**: `intraday-scalp.service.ts`, `volume-liquidity.scorer.ts`, `.service.spec.ts`.

---

## 2. Prisma 스키마 변경 — 직렬 규칙

**13건 모두 schemaChange=false.** 아래 옵션을 채택하면 스키마로 전환 → 별도 직렬 PR + 휴먼 승인(ask)으로 격리, 본 로드맵 제외:
- F7 `Position.entryFee` 컬럼 → 기본안(commissionRate 재구성) 채택, 컬럼안 보류
- L 가격결측 마커 영속 → 1차 로그만
- F2 REDUCE 부분익절(Position 분할) / F6 거부주문 영속 → 후속

---

## 3. 의존·충돌 그래프 + 실행 순서

### 3-1. 충돌 클러스터
- **A 청산엔진**: `exit-score.calculator.ts`(F2) + `paper-simulation.service.ts::evaluateExits`(F1, F3). 순서 **F2 → F1(day 해상도) → F3(그 위 enrichment)**.
- **B 단타 리스크 입력** `intraday-scalp.service.ts:537-549`: F5+F11 → `buildScalpRiskInput` 단일 헬퍼로 동시 착지, 이후 F6가 evaluateOrder로 치환. (L은 같은 파일 다른 영역 forceCloseAll → 파일잠금 조율)
- **C 체결·회계** `paper-simulation.service.ts` openNewPositions: F7 → F8(Phase1). philosophy-style·paper-trade·fill-simulator 공유.
- **D 매수신호·등급(engine3, A~C와 파일 독립)**: F4 → F10 → F9.

### 3-2. 숨은 의존
- **F10 → F9**: F10이 분포를 이동시키므로 **F10 머지 후** diagnostic 재실행해 F9 최종 임계 재산출.
- `paper-simulation.service.ts`가 레인 직렬 병목(F1/F3 → F7/F8 → F6) → 매 PR rebase.

### 3-3. Phase 배치

| Phase | 포함 | effort | 병렬성 |
|---|---|---|---|
| **P0** 즉효·저위험 | F4, F12, L(즉시 [1][2]) | S/S/M | 3건 병렬 |
| **P1** 청산엔진 | F2 → F1 → F3 | M/M/M | 레인 내부 직렬 |
| **P2** 회계·체결 | F7 → F8(Phase1) | S/L | P1 후 |
| **P3** 리스크 게이트 | (F5+F11) → F6 | S+M/M | P2 후 |
| **P4** 신호·등급(engine3) | F10 → F9 | M/M | P0(F4) 후, P1~P3과 병렬 |
| **P5** 재검증·릴리스 | (코드 없음) | — | 전 PR 머지 후 |

```
레인 A (engine5 직렬): P1[F2→F1→F3] → P2[F7→F8p1] → P3[(F5+F11)→F6]
레인 B (engine3 병렬): F4 → F10 → F9(임계 재산출)
레인 C (독립): F12, L[1][2][3]
         ─── 전 PR 머지 ───▼  P5 재검증·릴리스
```

---

## 4. Phase별 DoD 게이트
공통: 매 PR `tsc 0`·`build`·`npm test 그린`·AI 금지영역 미침범·문서 동기화. 동일파일 직렬 PR은 직전 머지 위 rebase.

- **P1**: 기존 3종 청산 spec 그린 유지. F1 **월요일/연휴 거래일차 회귀 신규 필수**. F3 rcpDt 999999·stockDailyPrice 목·SYNTHETIC 가드. F2 synthetic-cycle 무수정 통과.
- **P2**: cash-guard·사이클 spec 그린. F7 philosophy DEFAULT_FILL_PARAMS import. F8 fill-simulator 틱값+불변식 단언.
- **P3**: risk-check/kill-switch-persistence 그린. F5 **모듈 결선 테스트**. F11 목 {gte,lte} 분기+로그 단언. F6 **실 배선 통합 테스트**(kill off=불변, on=0).
- **P4**: F10 bucket-renorm spec:137 동일커밋+sum≤1. F9 signal-accuracy.service.spec:94+diagnostic:221-223(score 41) 재확인.

---

## 5. 재검증 파이프라인 (P5)

코드 머지 후 순서대로(앞 실패 시 중단):
- **A 정적**: `tsc --noEmit` → `npm run build` → `npm run test:core` → `npm test` → mobile typecheck+bundle.
- **B 통합/E2E**: `npm run test:integration`(롤백) → `ts-node src/e2e/integration-regression.ts`(졸업 E2E + AI 금지영역 감사, AI는 `SMOKE_LLM=1` 시만).
- **C 라이브 재검증**(baseline §3): `POST /api/event-study/calculate` → `POST /api/signals/generate`(F4·F9·F10 반영) → `POST /api/backtest/replay`(totalReturn·MDD·sharpe 재측정) → `GET /api/backtest/signal-accuracy|calibration|feature-ab`(read-only) → 전략 4종 `strategies/refresh`+comparison → `GET /api/graduation/metrics|funnel`(F12) → 단타 status+trade-history(F5·F11·L 발화 확인).
- **D 라이브 AI 스모크**(선택, AI 변경 시).

---

## 6. 버전 발행 게이트

### 6-A. RELEASE HARD GATE (전부 통과 = 발행, 손익 음수여도 무방)
- H1 타입·빌드 0 / H2 단위 회귀 0 / H3 통합·E2E·롤백 잔여 0
- **H4 손절 발화**(F1/F3): −8% 단일 붕괴 아님, cross-source 상쇄 0
- **H5 익절 동작**(F2): TP 자동청산 net 기준 정확
- **H6 회계 무결성**(F7/F8): 매수 수수료 반영·이중차감 0·호가 반올림
- **H7 kill-switch veto**(F5/F6): 단타 진입 veto·단일 게이트 경유
- **H8 AI 금지영역**: 감사 통과·AIUsageLog 누락 0
- **H9 통지 발화**(F4): NOTIFY 게이트 true 발화

### 6-B. EDGE/GRADUATION GATE (발행 차단 안 함 — execution-enable blocker)
- 엣지 미확인 → execution 비활성 + paper/research 라벨. 졸업(G1~G7)은 추적·기록만(표본 부족 시 `pass=null` 정직 표기).
- 졸업/실주문 승격은 별도 휴먼 승인.

### 6-C. 버전·문서
- `backend/package.json` `0.0.1 → 0.1.0`(pre-1.0 minor; 1.0.0은 졸업·실주문 예약). main 직접 커밋 금지 → 릴리스 브랜치+PR.
- `CHANGELOG.md` 신규(0.1.0에 F1~F12·L Fixed/Changed + baseline 대비 측정값 정직 첨부).
- 문서 동기화: `buy-logic-validation-baseline.md`(§3 프로토콜 갱신, −14.5%는 이력 보존), `NEXT_STEPS.md`/`development-plan.md`(완료 `[x]`·엣지 미확인·execution 비활성 명시), `api-specification.md`(F4·F9 동작 주석), 각 "최종 수정일" 2026-06-26.
- 회귀 매트릭스(01-execution-roadmap §3): 데이터 정합·AI 비용·AI 금지영역·문서 동기화 전부 클린.

**발행 결정: H1~H9 전부 통과 + 회귀 매트릭스 클린 → 0.1.0 발행. 엣지 미충족 시 execution 비활성·paper 라벨로 정직 출시.**

---

## 7. specHolds=false / 과거버그 재유발 — 주의 요약
원안 그대로 구현 금지(교정안만 채택):
- **F1**(DAR-366): 달력일+2 → **거래일 차 1~2**. 실시간 부재 시 alignedPriceRow 폴백. 월요일/연휴 회귀 테스트 필수.
- **F3**(DAR-366 spec throw): rcpDt **999999 천장**, stockDailyPrice 목, SYNTHETIC=[] 가드, EXIT70은 loss override 경로.
- **F6**(DAR-366/444 조건부): **BUY-only 절대**, currentPositionValue=0, opened 매핑 금지, 모듈 import, 실 배선 테스트.
- **F9**(DAR-321/322): **BUY=45**(41 경계 위), F4·F10 선행.
- **L**(DAR-433 조건부): 일봉 폴백 **동일 tradeDate 한정**(orderBy desc 금지).
- 경미: F2 synthetic-cycle 무수정 통과 / F4 Duplicate identifier 회피 / F7 import 누락 / F8 틱증분 고지 / F11 목 확장 / F12 값 20.

---

## 8. 우선 결정 리스트 (착수 전 필수)

### ✅ 확정된 결정 (2026-06-26)
- **F9 등급 사다리**: 보수 **STRONG 50 / BUY 45 / WATCH 30** (BUY를 DAR-322 경계 41 위에). F10 머지 후 분포로 최종 확인.
- **F2 익절 방식**: **부분 스케일아웃**(REDUCE) — 목표 도달 시 일부만 익절·잔량 보유. Position 분할/잔여수량 추적 필요 → P1에서 설계, **스키마 영향 여부 검토 후 필요 시 별도 직렬 PR**.
- **F4 통지 정책**: STRONG_BUY·BUY **둘다 통지 + (corpCode,rcpNo) 공시단위 dedup**(persona fan-out 4중 푸시 방지).
- **착수 범위**: **P0 + engine3 신호레인(F4→F10→F9)부터** 구현·검증, 이후 청산엔진(P1) 등 순차.
- 기술 파라미터(권장안 적용): F1 신선도 **거래일 2** / F6 **BUY-only** / F8 **Phase1만** / F12 **표본 20**.

### Tier 1 — 구현 차단 (★) — 위에서 확정됨
1. **F1 신선도 판정**: 거래일 차 + 임계 **1~2 거래일** (권장: 거래일 2)
2. **F6 kill-switch 범위**: **BUY-only**(SELL/청산 비차단) + 모의 전용 RiskLimits로 한도 정합 + riskContext(currentPositionValue=0/openCount=0)
3. **F9 임계 사다리**: STRONG/BUY/WATCH = **50/45/30** (BUY를 보수성 경계 41 위로)
4. **F8 범위**: Phase1(호가단위)만 이번 릴리스, Phase2 백로그 분리 + 반올림 불리한 방향

### Tier 2 — 거동·정책
5. F2 전량 EXIT(권장) vs 부분익절 / TP 20 유지 / 모멘텀 보너스 존속
6. F12 표본 하한 20(권장) vs 30
7. F4 통지 STRONG만 vs 둘다 / persona fan-out dedup / 첫 cron 스파이크
8. F7 수수료 출처 재구성(권장) vs 컬럼 / L979 분리
9. F3 공시 윈도우·극성 / 파생필드 phase / low20 동시수정
10. F11 주간 윈도우 월요일 KST주(권장) / 미실현 포함

### Tier 3 — 정리·후속
11. F10 GROUP_FACTOR / fundamental.growth 분리 / insider 독립
12. F5 @Optional(권장) vs required / CronRunLog 기록
13. L 가격결측 마커 / volume-liquidity veto 승격 / catch-up 위치 / 보류 5건 백로그
14. 공통: LOW_SAMPLE 상수 SSOT 통합 별도 이슈
