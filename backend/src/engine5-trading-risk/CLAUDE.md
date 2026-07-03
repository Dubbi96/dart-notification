# Engine 5 — Trading Risk (모의투자 + Risk 엔진)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/phase-12-paper-trading.md` · Phase: M10~M12 (M10 모의운용 진행 중, 재개 정본: `docs/roadmap/cc-resume-plan-2026-07-02.md`)
> 이 폴더는 **Trading Risk 도메인**(Bounded Context)이다. 격리 컨텍스트로 작업한다.

## ⚠️ AI 금지영역 (절대 불가침 — risk-guard 훅이 강제)

**Engine5는 AI/LLM(engine2)에 의존성을 가질 수 없다.** 독립 실행 필수.

금지 목록 (AI 개입 절대 0):
- 최종 주문 승인 / 주문 수량 결정
- 손절·익절 하드룰
- 포트폴리오 한도 (maxWeight, maxSinglePositionPct)
- Risk 우회 / Risk 점수 계산
- 체결 시뮬레이터 로직

모든 로직은 **순수 Rule(수식/파라미터 기반)**으로 구현한다.

## 책임 (모듈 지도)

| 하위 영역 | 위치 | 책임 |
|---|---|---|
| 도메인 타입 | `domain/` | PaperTrade 타입, 체결 파라미터, 포트폴리오 상태 |
| 체결 시뮬레이터 | `domain/fill-simulator.ts` | 슬리피지(기본 + 시장충격 √참여율 모델)·부분체결·수수료·세금·틱 라운딩 순수 Rule |
| 가상 포트폴리오 | `domain/paper-portfolio.ts` | 보유·평가손익·현금·비중 추적 |
| 비용 지표 | `domain/cost-metrics.ts` | CostPerDisclosure/Signal/Trade, AI비용/순익 비율 |
| **Risk 하드룰** | `domain/risk-check.service.ts` | 1회 매수·단일 종목·일간/주간 손실·중복/과매매 판정 (순수 Rule) |
| **Risk veto 타입** | `domain/risk-check.types.ts` | RiskCheckInput/Result/Violation, RiskLimits, 이벤트 타입 |
| **Kill Switch** | `domain/kill-switch.ts` | 자동 중단 조건(연속손실·시장급락·API오류) + 수동 Kill Switch — **DB 영속**(`repositories/prisma-kill-switch-state.repository.ts`, 재시작 후 발동 상태 복원, DAR-350) |
| **이벤트 게이트** | `domain/event-list.ts` | 화이트리스트(6종)/블랙리스트(9종) M12 자동매매 게이트용 |
| **시스템 모의운용** | `paper-simulation/` | 일일 사이클(평일 19:30 KST: 매수 예약→시가평가→Exit 판정, 체결은 익일 시가 — 장외 체결 의미론)·장중 5분 모니터(개장 체결기 + forward 트랙 전 포트폴리오 실시간 청산)·실가 가격소스(`simulation-price-source`)·자산곡선·트레이드 스코어카드·졸업지표 적재. `paper-simulation.service.ts`가 오케스트레이터 |
| — 철학 스타일 분기 | `paper-simulation/philosophy-style*` | BUFFETT/LYNCH/GREENBLATT/DRUCKENMILLER 4개 거장 스타일별 분기 모의운용(philosophy-fit ≥50 적격 진입, 누적수익 랭킹, LOW_SAMPLE 정직 표기) |
| — 페르소나 | `paper-simulation/persona/` | 시장국면(market-regime) 판정 + 페르소나 추천·트레이딩 API |
| — **분봉 단타** | `paper-simulation/intraday-scalp/` | 당일 진입·당일 청산 실시간 페이퍼 트랙(장중 10분 간격 진입스캔, 15:20 강제청산). 신호 정의는 engine3 `intraday-scalp-signal` 순수 함수 호출, 체결·리스크·청산·영속은 engine5 독립 강제. 분봉은 forward-only(KIS 당일치만) → 백테스트 불가, 실시간 모의로만 누적 |
| — **백테스트 vs forward 괴리** | `paper-simulation/backtest-forward-divergence*` | 리플레이 트랙(BacktestRun.strategyKey)과 forward 트랙(styleTag='strategy:<key>')을 strategyKey 로 조인한 괴리(수익률·승률·거래빈도·보유기간) read-only 리포트 + 일일 스냅샷(`BacktestForwardDivergenceSnapshot`, 멱등키 strategyKey+snapshotDate). ForwardTracksScheduler 가 forward 크론(19:45) 직후 적재. 승률=trade-scorecard 통일 정의·gap=engine3 calibration 의미론 계승. 표본 부족 LOW_SAMPLE 정직. ★측정·적재 전용(매매 무접촉·AI 0). DAR-479 |
| 졸업 측정 | `simulation/` | M10 졸업 게이트·지표 계산기(graduation-gates/metrics), signal-funnel, position-sizing, SimulationOrchestrator + `GET /api/graduation/*` (DAR-67/109) |
| 수동 모의매매 API | `paper-trading/` | PaperTradingController/Service — 사용자 수동 모의 주문 진입점 |
| 서비스 | `services/` | PaperTradeService · **OrderRiskService**(Risk veto + Audit Log) · AuditLogQuery(감사로그 조회 API) · **AutoTradingStatus**(자동매매 실행상태 read-only 투명성: 킬스위치·리스크게이트·최근 주문 집계, DAR-361) |
| 리포지토리 | `repositories/` | IPaperTradeRepository·IAuditLogRepository·KillSwitchState — **Prisma 어댑터(운영 배선, DAR-36)** + 인메모리(테스트·폴백) |
| 테스트 | `*.spec.ts` | fixture 기반 단위 테스트 (통합 스펙 `*.integration-spec.ts`는 실 DB 필요) |

> **다중전략 5트랙 경계**: 일봉 4종 전략 트랙(이벤트엣지·단기모멘텀·보수가치·공격분산)의 프리셋·리플레이·비교 API는 **engine3** `backtest/strategies/`(strategy-presets·strategy-track) 소관이고, 5번째 실시간 트랙(분봉 단타)이 이 엔진의 `intraday-scalp/`다. 철학 스타일 4종 분기는 별도 축(시스템 모의 위 오버레이).

## 로드맵 (M10~M12)

| 마일스톤 | 목표 | 상태 |
|---|---|---|
| **M10-A (DAR-16)** | PaperTrade Prisma 모델 + 체결 시뮬 + 가상 포트폴리오 + 비용지표 + fixture | ✅ |
| **M10-B** | 실데이터(KIS 실시간·KRX 일봉) 30일 캘린더 모의운용 | 🚧 OCI prod에서 진행 중 — 다중전략 트랙 기동(6/21~22) 기준 **≈7/21 도달** 후 졸업 게이트(G1~G7) 측정 |
| **M11-A (DAR-18)** | Risk 하드룰·veto·Kill Switch·이벤트 게이트 + Prisma OrderRequest/Execution/AuditLog | ✅ |
| **M11 잔여** | **실주문 루프(OrderRequest) 미연동** — 스키마·Risk 게이트는 완비됐으나 OrderRequest를 생성·소비하는 주문 루프 실사용 0. 모든 모의 경로는 `simulateFill`만 사용(실주문 API 호출 0). M10 졸업 + 전략 엣지 확인이 진입 게이트 | ⬜ |
| **M12** | 실주문 연결 (증권사 API) + 이벤트 게이트 발효 | ⬜ |

## Risk 하드룰 파라미터 (DEFAULT_RISK_LIMITS)

| 규칙 | 기본값 | 설명 |
|---|---|---|
| singleBuyMaxPct | 0.03 (3%) | 1회 매수 최대 비율 |
| singlePositionMaxPct | 0.10 (10%) | 단일 종목 최대 비중 |
| dailyLossMaxPct | -0.02 (-2%) | 일간 손실 한도 |
| weeklyLossMaxPct | -0.05 (-5%) | 주간 손실 한도 |
| maxOpenOrders | 5 | 최대 미체결 주문 수 |
| maxDailyTrades | 10 | 일간 최대 거래 횟수 |

> **side-gate (GAP-11)**: 일간/주간 손실 한도는 **BUY(신규 진입) 전용** — SELL(청산·위험 축소)은
> 손실 한도에 차단되지 않는다(자기잠금 방지, `services/order-risk.service.ts`).
> 잔여 하드룰(중복주문·과매매)은 SELL에도 그대로 적용된다. 순수 Rule — AI 개입 0.

## Kill Switch 자동 발동 조건 (DEFAULT_AUTO_KILL_CONDITIONS)

- 연속 손실 ≥ 5회
- 시장 급락 ≤ -5% (조건에 marketDropPct 설정 시 활성화)
- API 오류 누적 ≥ 3회
- **모드 (GAP-11)**: 기본 `REDUCE_ONLY` — 발동 중 BUY(신규 진입) 차단·SELL(청산·위험 축소) 허용.
  스키마 동결로 DB 컬럼 대신 코드 상수 정책(`domain/risk-check.types.ts` `DEFAULT_KILL_SWITCH_MODE`).
  전면 중단이 필요하면 `FULL_HALT` 로 상수 교체. REDUCE_ONLY 통과 SELL 은 audit meta 에
  `killSwitchSellAllowed` 증적을 남긴다.

## 체결 시뮬레이터 파라미터

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| commissionRate | 0.00015 (0.015%) | 매수·매도 공통 증권사 수수료 |
| sellTaxRate | 0.0018 (0.18%) | 매도 시 증권거래세 (2024년 기준) |
| slippagePct | 0.0005 (0.05%) | 기본 슬리피지 (시장충격 모델) |
| partialFillThreshold | 0.1 | 유동성 부족 시 부분체결 임계값 |

## 진입 규칙 (백테스트 일관성)

- **다음거래일 시가 진입**: 공시 당일 체결 금지(lookahead bias 방지)
- 장마감(15:30) 후 공시: +2 거래일 시가 진입
- ★**장외 체결 의미론(live-readiness W1, 2026-07)**: 시스템 모의 19:30 사이클은 **주문 결정만** 한다 —
  매수는 PENDING 예약(PaperTrade, entryDate=다음 거래일·styleTag='paper-simulation'), 청산은 판정·기록
  (`ExitSignal.scoreDetail.deferredFill`)만. 체결은 장중 모니터 첫 유효 틱(실시간 quote 의 open) 또는
  19:30 폴백(당일 REAL 일봉 open)이 **당일 시가**로 수행. 미체결 예약은 이월(3거래일 초과 시 CANCELLED).
  장중 실효 손절은 장중 모니터 즉시 체결 유지. 상세: `docs/workflow.md §6.10`.

## 모의운용 후보·사이징·섹터 (paper-simulation, 순수 Rule·AI 0)

> 구현: `paper-simulation/simulation-entry.ts`(순수 함수) + `paper-simulation.service.ts:openNewPositions`.
> ★ 모든 값은 "가상원금의 종목별 배분 비율"일 뿐 Risk 하드룰(단일종목·섹터 한도)을 대체/우회하지 않는다.

- **후보 pool (DAR-51→DAR-362)**: `signal ≥ SIM_MIN_ENTRY_GRADE(기본 WATCH)`.
  - 1순위 `entryReady=true` 후보(품질 우선)로 가용 슬롯을 채운다.
  - 슬롯이 남으면 `entryReady=false`라도 `buyScore ≥ ENTRY_FALLBACK_MIN_BUY_SCORE(50)` 인
    상위 후보로 보강(BUY/STRONG 희소 시 pool 협소 완화). **무차별 확대 아님 — 품질 하한 유지.**
  - 종목당 1건 디듑(`dedupeCandidatesByCorpCode`) 후 `available` 절단.
- **차등 사이징 (DAR-362)**: 진입예산 = `baseBudget × 등급계수 × buyScore가중`.
  - `baseBudget = 가상원금 × maxSinglePositionPct`(Risk 하드룰 envelope).
  - `등급계수`(STRONG 1.0 / BUY 0.75 / WATCH 0.4) + `buyScore가중`(buyScoreSizingMultiplier:
    HIGH 80↑→1.0, LOW 20↓→FLOOR 0.5, 사이 선형). **고확신 더·저확신 덜**.
  - 결합계수 ∈ (0, 등급계수] ≤ 1.0 → 종목당 예산은 **항상 baseBudget 이내**(하드룰 보존).
  - 데이터가 거의 전부 WATCH(단일 등급)라 등급계수만으로는 사실상 균일해지던 문제를 buyScore로 교정.
- **섹터 분산 가드 (DAR-362)**: 진입 시 동일 섹터 비중 상한 `maxSectorPct`(기본 30%) enforce.
  - 섹터 식별: `CompanyOverview.industryCode`(스키마 변경 0). 기보유+후보 corpCode 1회 조회.
  - 섹터별 잔여 허용예산 `sectorHeadroomBudget`로 후보 예산을 절감(상한 초과 진입 차단).
  - **industryCode 미상(null)은 가드 면제** — 데이터 없는 상한 강제는 거짓 보수(전종목 차단). 적재율
    낮으면 사실상 no-op(데이터 의존). 적재 후 자동 발효.

## 절대 규칙

- Engine2(AI) import 금지
- **실주문 경로 0** — 모든 체결은 `simulateFill`(순수 시뮬). 증권사 주문 API 호출·OrderRequest 실사용은 M11 실주문 루프 연동 전까지 금지
- 상대경로 import만 사용
- 모든 Rule 계산은 순수 함수 (side-effect 없음)
- **전략 룰·파라미터 변경 절차**: Risk 하드룰·킬스위치·손절·익절·한도 등 모든 값 변경은 룰북 정본 `docs/trading/strategy-rulebook.md §8 변경 절차`(문서 개정→재검증→사람 승인)를 따른다. M10 측정 트랙의 ENFORCE 플립은 졸업 측정 완료 전 금지(§8.5).

---
*최종 수정: 2026-07-03*
