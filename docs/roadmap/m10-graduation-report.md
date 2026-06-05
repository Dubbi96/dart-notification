# M10 MVP 졸업 게이트 — 준비도 리포트 (DAR-39)

> ⚠️ **검증·리포트 성격** — 신규 실주문·스키마변경 없음. M11 진입 아님.
> 정본 기준: `docs/roadmap/01-execution-roadmap.md` §M10 · `docs/roadmap/cc-mvp-definition.md` §9.
> ★ 본 리포트는 `backend/src/e2e/integration-regression.ts` 실행 결과로 자동 생성된다(실데이터·결정론적).

- 생성 시각: `2026-06-05T05:32:33.294Z`
- 생성 방법: `cd backend && npx ts-node src/e2e/integration-regression.ts`
- E2E 결과: ✅ 통과 17 / ❌ 실패 0
- 졸업 기준 집계: **✅ 통과 10 · 🟡 부분 3 · ⏸ 보류 4** (총 17)

## 1. 실데이터 DB 현황 (데모 DB 읽기 — 무변경)

| 항목 | 값 |
|------|----|
| Disclosure(공시) | 1194 |
| DisclosureDocument(파싱완료) | 30 |
| DisclosureEvent(이벤트) | 30 |
| StockDailyPrice(일봉) | 2767 |
| TradingSignal(매수신호) | 0 |
| PaperTrade(모의체결) | 0 |
| ExitSignal(청산신호) | 0 |
| AIUsageLog(AI사용) | 0 |
| 수집 성공률 | 99.1% (115/116) |

> ★ 주가(StockDailyPrice) 등 기존 데모데이터는 본 검증으로 변경되지 않는다. 실 영속화 단계(ExitSignal/PaperTrade)는 `withRollback`(DAR-38)으로 항상 롤백 → 잔여 row 0.

## 2. 11개 MVP 기능 동작 여부 (cc-mvp-definition §2)

| ID | 기능 | 기준 | 측정 | 판정 | 증거 |
|----|------|------|------|------|------|
| F1 | DART 공시 수집 안정화 | 수집 파이프라인 동작 | Disclosure 1194건 | ✅ 통과 | Step 0 · DisclosureCollectionLog |
| F2 | 공시 원문 다운로드·파싱 | parseStatus=DONE 존재 | 파싱완료 30건 | ✅ 통과 | Step 1 |
| F3 | 이벤트 타입·핵심 수치 추출 | eventType 분류 | 이벤트 30건 적재, 표본 추출 성공 | ✅ 통과 | Step 2 |
| F4 | AI 공시 요약·긍부정 추출 | L1~L2 정상 생성 | 코드·게이트 검증됨, SMOKE_LLM 미설정으로 실 LLM 미실행 | 🟡 부분 | Step 3 |
| F5 | AI Persona별 해석 생성 | Persona 해석 생성 | 코드·게이트 검증됨, SMOKE_LLM 미설정으로 실 LLM 미실행 | 🟡 부분 | Step 3 · PersonaInterpretationTask |
| F6 | 현재가·일봉·기술지표 수집 | StockDailyPrice 적재 | StockDailyPrice 2767건 | ✅ 통과 | Step 4 |
| F7 | Buy Score 계산→매수후보 | computeBuyScore 동작 | 표본 grade=NEUTRAL | ✅ 통과 | Step 5 |
| F8 | PositionThesis 저장 | Thesis 실 영속화 | Prisma repo 통합테스트 그린(DAR-35/38) | ✅ 통과 | prisma-position-thesis.integration-spec |
| F9 | Exit Score 계산→ExitSignal 저장 | ExitSignal 실 영속화 | save→find 왕복 일치, aiUsed=false | ✅ 통과 | Step 9 (실DB·롤백) |
| F10 | 모의투자 포트폴리오 추적 | PaperTrade 모의체결 저장 | 슬리피지·부분체결 포함 실 영속화 확인 | ✅ 통과 | Step 10 (실DB·롤백) |
| F11 | AI 비용 로그·비율 모니터링 | 집계 + 비율 측정 | 집계코드 동작·실 AIUsageLog 0건(비율 측정 불가) | 🟡 부분 | Step 11 |

## 3. go/no-go 게이트 지표 (cc-mvp-definition §9)

| ID | 지표 | 목표 | 측정 | 판정 | 증거 |
|----|------|------|------|------|------|
| G1 | 신호 적중률 ≥55% (D+5) | ≥55% | 30일+ 운용 데이터 부족 | ⏸ 보류 | 캘린더 시간 필요 — 미측정 |
| G2 | 모의 누적 수익률 >0% | >0% | 30일+ 모의운용 미충족 | ⏸ 보류 | 캘린더 시간 필요 — 미측정 |
| G3 | AI비용/모의순익 ≤20% | ≤20% | 순익=0·AIUsageLog=0 → 측정 불가 | ⏸ 보류 | Step 11 — 데이터 부족 |
| G4 | 수집 성공률 ≥95% | ≥95% | 99.1% (115/116) | ✅ 통과 | DisclosureCollectionLog |
| G5 | Exit 정확도 ≥50% (D+3) | ≥50% | 운용 데이터 부족 | ⏸ 보류 | 캘린더 시간 필요 — 미측정 |
| G6 | AI 금지영역 침범 0 | 0건 | Engine5 import 0 · 비정상actor 0 · aiUsed 0 | ✅ 통과 | Step 12 감사 |

## 4. AI 비용 — 추정 vs 실측 / 비용·순익 비율

- 최근 30일 AI 호출: **0건**, 총 실측 비용: **$0.00000**, L0(무비용) 비율: 100%
- 공시당 평균 AI 비용(원): 0.00
- AI비용/모의순익 비율: **측정 불가** — 모의순익 0(누적 운용 전) · AIUsageLog 0건

> 추정비용은 `estimateCostUsd`(토큰×단가) 기준, 실측비용은 `AIUsageLog.costUsd` 합계 기준이다. 현재 데모 DB의 AIUsageLog가 0건이라 실측·비율은 **데이터 부족으로 보류**다. SMOKE_LLM=1 실런 또는 실서비스 누적 후 재측정한다.

## 5. AI 금지영역 침범 감사 (cc-vision 핵심 원칙)

- **Engine5(trading-risk) AI/LLM/engine2 import: 0건** — 0이어야 정상. 체결·Risk 판정은 순수 Rule.
- `trading_audit_logs.actorKind` 가 허용 집합(SYSTEM/RISK_ENGINE/KILL_SWITCH/USER) 밖인 row: Step 12에서 0 확인.
- `ExitSignal.aiUsed=true` row: 0 확인 (Exit Score는 순수 Rule, AI 미개입).
- 종합 판정: **✅ 침범 0**.

## 6. 보류(HOLD) 항목 — 정직 표기 (통과 위장 금지)

아래 항목은 **캘린더 시간/누적 데이터**가 본질적으로 필요하여 현 시점 코드·단발 E2E로는 충족을 증명할 수 없다. 통과로 위장하지 않고 보류로 표기한다:

- **G1 신호 적중률 ≥55% (D+5)** (목표 ≥55%) — 30일+ 운용 데이터 부족. (캘린더 시간 필요 — 미측정)
- **G2 모의 누적 수익률 >0%** (목표 >0%) — 30일+ 모의운용 미충족. (캘린더 시간 필요 — 미측정)
- **G3 AI비용/모의순익 ≤20%** (목표 ≤20%) — 순익=0·AIUsageLog=0 → 측정 불가. (Step 11 — 데이터 부족)
- **G5 Exit 정확도 ≥50% (D+3)** (목표 ≥50%) — 운용 데이터 부족. (캘린더 시간 필요 — 미측정)

이 보류 항목들은 `cc-mvp-definition §9 go/no-go 게이트(30일 운용 후 평가)` 및 자동매매 졸업 조건(90일 운용)으로, M10 검증 단계가 아니라 **모의운용 누적 단계**에서 충족된다.

## 7. 종합 결론

- **코드/파이프라인 준비도**: 11개 MVP 기능의 실데이터 파이프라인(수집→파싱→이벤트→(AI)→BuyScore→Thesis→ExitSignal→모의체결→비용집계)이 실 영속화 경로까지 관통 확인됨.
- **AI 거버넌스**: AI 금지영역 침범 0(Engine5 순수 Rule), 비용 집계 코드 동작 확인.
- **졸업 가부**: 측정 가능 기준은 충족하나, **30일+ 모의운용·적중률·누적수익·비용비율** 등 시간 의존 기준은 보류. 따라서 **현 시점 "졸업 선언" 불가 — 모의운용 누적 단계로 진행 후 재평가**가 정직한 결론이다.
