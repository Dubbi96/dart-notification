# Engine 4 — Portfolio Exit (Position Thesis + Exit 엔진)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/phase-07-position-thesis.md`, `phase-08-portfolio-exit.md` · Phase: M7~M8
> 이 폴더는 **Portfolio Exit 도메인**(Bounded Context)이다. 격리 컨텍스트로 작업한다.

## 책임

| 하위 영역 | 위치 | 책임 |
|---|---|---|
| 도메인 타입 | `domain/` | InvalidCondition 구조화 타입, ThesisStatus, PositionThesisRecord, ExitEngine 타입 |
| Exit Score 계산기 | `domain/exit-score.calculator.ts` | 6트리거 × 5액션 순수 Rule 계산 (AI 금지) |
| 리포지토리 | `repositories/` | IPositionThesisRepository, IExitSignalRepository 인터페이스 + 인메모리 어댑터 |
| Thesis 서비스 | `services/` | BUY 신호 → Thesis 자동 생성, 생명주기 전이 |
| Exit 엔진 서비스 | `services/exit-engine.service.ts` | 포지션별 Exit Score 계산 → ExitSignal 저장 |
| Exit 스케줄러 | `services/exit-check-scheduler.interface.ts` | 하루 3회 점검 스케줄 (09:00/13:00/16:30) |

## 로드맵 (M7~M8)

| 마일스톤 | 목표 | 상태 |
|---|---|---|
| **M7 (DAR-11)** | PositionThesis Prisma 모델 + 자동 생성 서비스 + fixture 테스트 | ✅ 완료 |
| **M8 (DAR-12)** | Exit Score 계산, 6트리거, 5액션, thesis훼손→EXIT, ExitSignal 저장 | ✅ 완료 |

## Exit Score 구조 (M8 — AI 금지영역)

| 컴포넌트 | 점수 | 트리거 |
|---|---|---|
| lossRiskScore | 0~20 | STOP_LOSS |
| thesisBreakScore | 0~20 | THESIS_INVALIDATED |
| chartBreakScore | 0~20 | CHART_BREAKDOWN |
| disclosureRiskScore | 0~20 | THESIS_INVALIDATED |
| overweightScore | 0~10 | REBALANCING |
| timeExceededScore | 0~10 | TIME_LIMIT |
| positiveMomentumBonus | 0~20 | (감산) |

### 5 액션 판정 기준

| 범위 | 액션 |
|---|---|
| 0~29 | HOLD |
| 30~49 | WATCH |
| 50~69 | REDUCE |
| 70~89 | EXIT |
| 90~100 | BLOCK_REBUY |

## AI 금지영역 (절대 불가침)

- PositionThesis 생성·평가는 **순수 Rule 기반**. AI/LLM 개입 절대 금지.
- **Exit Score·트리거·5액션**: 순수 Rule 함수로만 계산. AI 개입 0.
- `exitRules`·`maxWeight` (포트폴리오 비중·청산 룰) AI 변경 불가. Engine5 Risk가 최종 강제.
- 최종 주문 승인·주문 수량·손절가 결정: 이 엔진 범위 외 (Phase 13).
- AI 개입 여부가 의심스러울 때: **금지로 판단**하고 Rule 로직으로 구현.

## 절대 규칙

- **1 TradingSignal → 1 PositionThesis**: BUY 등급(STRONG_BUY_CANDIDATE/BUY_CANDIDATE) 신호당 Thesis 빠짐없이 1:1 자동 생성. 중복 생성 방지(tradingSignalId UNIQUE).
- **invalidConditions 기계 평가 가능 형태 강제**: 추상 자연어 금지. `InvalidConditionType` enum 값만 사용.
- **생명주기 단방향**: ACTIVE → INVALIDATED → CLOSED (역방향 전이 금지).
- **상대경로 import**: 런타임 `@/` alias 미등록 → 상대경로만.
- **ExitSignal aiUsed=false**: 자동 저장 시 AI 개입 없음 필드로 보장.

## invalidConditions 허용 타입

| type | 평가 소스 | 필드 |
|------|-----------|------|
| `PRICE_BELOW` | M4 시세 | `value` (원) |
| `PRICE_ABOVE` | M4 시세 | `value` (원) |
| `AMENDMENT_NEGATIVE` | M2 정정공시 | (없음) |
| `THESIS_METRIC_BREACH` | M4 지표/M5 통계 | `metric`, `threshold` |
| `VOLUME_COLLAPSE` | M4 거래량 | `threshold` (비율 0~1) |
| `EVENT_STUDY_UNDERPERFORM` | M5 EventStudy | `horizon`, `threshold` (%) |
| `STOP_LOSS_PCT` | M4 시세 | `value` (% 손실) |
| `MAX_HOLD_DAYS` | 경과일 | `value` (일) |

## DoD (M8 기준)

- `npx tsc --noEmit` 0 · `npm test` 그린(회귀 0)
- Exit Score 계산기 (6트리거 × 5액션) 구현 완료
- ExitSignal 인메모리 저장소 구현
- 하루 3회 점검 스케줄 인터페이스 정의
- Prisma 모델: Portfolio, Position, PositionDailySnapshot, ExitSignal, PortfolioRiskSnapshot
- 마이그레이션 파일 생성 (20260604170000_m8_portfolio_exit)
- exit-engine.spec.ts fixture 테스트 통과 (40개 이상)
- AI 금지영역 미침범
