# Engine 5 — Trading Risk (모의투자 엔진)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/phase-12-paper-trading.md` · Phase: M10~M12
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

## 책임

| 하위 영역 | 위치 | 책임 |
|---|---|---|
| 도메인 타입 | `domain/` | PaperTrade 타입, 체결 파라미터, 포트폴리오 상태 |
| 체결 시뮬레이터 | `domain/fill-simulator.ts` | 슬리피지·부분체결·수수료·세금 순수 Rule |
| 가상 포트폴리오 | `domain/paper-portfolio.ts` | 보유·평가손익·현금·비중 추적 |
| 비용 지표 | `domain/cost-metrics.ts` | CostPerDisclosure/Signal/Trade, AI비용/순익 비율 |
| **Risk 하드룰** | `domain/risk-check.service.ts` | 1회 매수·단일 종목·일간/주간 손실·중복/과매매 판정 (순수 Rule) |
| **Risk veto 타입** | `domain/risk-check.types.ts` | RiskCheckInput/Result/Violation, RiskLimits, 이벤트 타입 |
| **Kill Switch** | `domain/kill-switch.ts` | 자동 중단 조건(연속손실·시장급락·API오류) + 수동 Kill Switch |
| **이벤트 게이트** | `domain/event-list.ts` | 화이트리스트(6종)/블랙리스트(9종) M12 자동매매 게이트용 |
| 리포지토리 | `repositories/` | IPaperTradeRepository + IAuditLogRepository + 인메모리 어댑터 |
| 서비스 | `services/` | PaperTradeService + **OrderRiskService**(Risk veto + Audit Log) |
| 테스트 | `*.spec.ts` | fixture 기반 단위 테스트 |

## 로드맵 (M10~M12)

| 마일스톤 | 목표 | 상태 |
|---|---|---|
| **M10-A (DAR-16)** | PaperTrade Prisma 모델 + 체결 시뮬 + 가상 포트폴리오 + 비용지표 + fixture | ✅ |
| **M10-B** | 실데이터 30일 모의운용 (KRX 키 승인 후) | ⬜ |
| **M11-A (DAR-18)** | Risk 하드룰·veto·Kill Switch·이벤트 게이트 + Prisma OrderRequest/Execution/AuditLog | ✅ |
| **M12** | 실주문 연결 (KRX/증권사 API) | ⬜ |

## Risk 하드룰 파라미터 (DEFAULT_RISK_LIMITS)

| 규칙 | 기본값 | 설명 |
|---|---|---|
| singleBuyMaxPct | 0.03 (3%) | 1회 매수 최대 비율 |
| singlePositionMaxPct | 0.10 (10%) | 단일 종목 최대 비중 |
| dailyLossMaxPct | -0.02 (-2%) | 일간 손실 한도 |
| weeklyLossMaxPct | -0.05 (-5%) | 주간 손실 한도 |
| maxOpenOrders | 5 | 최대 미체결 주문 수 |
| maxDailyTrades | 10 | 일간 최대 거래 횟수 |

## Kill Switch 자동 발동 조건 (DEFAULT_AUTO_KILL_CONDITIONS)

- 연속 손실 ≥ 5회
- 시장 급락 ≤ -5% (조건에 marketDropPct 설정 시 활성화)
- API 오류 누적 ≥ 3회

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

## 절대 규칙

- Engine2(AI) import 금지
- 상대경로 import만 사용
- 모든 Rule 계산은 순수 함수 (side-effect 없음)
