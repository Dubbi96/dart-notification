# Engine 3 — Quant Market (시세·기술지표·이벤트스터디·매수신호)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/cc-engine-architecture.md §3·§4-5` · Phase: `phase-05`(M4~M6)
> 이 폴더는 **Quant & Market 도메인**(Bounded Context)이다. 격리 컨텍스트로 작업한다.

## 책임

| 하위 영역 | 모듈 | 책임 |
|---|---|---|
| 시세 수집 | `market-data/` | 일봉·현재가 fetch (`StockDailyPrice`, `StockMinutePrice`) — KRX 1차 소스 |
| 기술지표 계산 | `indicators/` | MA/RSI/MACD/볼린저/ATR/VWAP → `TechnicalIndicator` |
| 이벤트 스터디 | `event-study/` | 공시 후 D+1~D+10 가격반응 집계 → `EventStudyResult` |
| 매수신호 | `buy-signal/` | `computeBuyScore` 점수 공식(Rule 기반) → `TradingSignal` |

## 데이터 소스 우선순위

1. **KRX 데이터마켓플레이스** — 일봉·지수·종목상태 (Phase 5 1차)
2. 증권사 OpenAPI(KIS 등) — 실시간 현재가·분봉 보완 (Phase 6 후반 이후)

**라이브 호출·마이그레이션은 현재 스캐폴딩 단계에서 제외.** 포트 인터페이스만 정의하고 인메모리 어댑터로 대체.

## 로드맵 (M4~M6)

| 마일스톤 | 목표 |
|---|---|
| **M4 (현재)** | 폴더 구조 + 서비스 스켈레톤 + 모듈 + AppModule 등록 |
| **M5** | KRX 어댑터 구현 + `StockDailyPrice` Prisma 모델 + 일봉 Cron 스케줄러 |
| **M6** | 기술지표 계산 + BuyScore 공식 완성 + BullMQ 컨슈머 연동 |

## AI 정책

| 기능 | 등급 | 비고 |
|---|---|---|
| Buy Score 계산 | **금지(L0)** | 점수 공식은 순수 Rule. AI 개입 절대 금지 |
| 유사 공시 검색 | **보조(L1)** | 벡터 임베딩 or Rule |
| 차트 상태 설명 | **보조(L1)** | 텍스트 생성만 허용 |

## 절대 규칙

- **AI 금지영역 불가침**: 매수 점수 계산·주문 수량·하드룰에 AI 개입 절대 금지.
- 시세·지표 데이터는 Engine 5(주문 체결)에 제공하되, 주문 승인 로직은 Engine 5가 독립 강제.
- 이 엔진이 소유하는 자연키: `stockCode` + `baseDate`.

## DoD

`npx tsc --noEmit` 0 · `npm test` 그린(회귀 0) · DDD 경계 준수 · AI 금지영역 미침범.
