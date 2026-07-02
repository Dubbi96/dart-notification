# Engine 3 — Quant Market (시세·기술지표·이벤트스터디·매수신호)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/cc-engine-architecture.md §3·§4-5` · Phase: `phase-05`(M4~M6) + M9
> 이 폴더는 **Quant & Market 도메인**(Bounded Context)이다. 격리 컨텍스트로 작업한다. · 최종 수정: 2026-07-02

## 책임 (실제 모듈 트리 기준)

| 하위 영역 | 모듈 | 책임 |
|---|---|---|
| 시세 수집 | `market-data/` | **KIS 실시간**(현재가 폴러 `kis-realtime.poller`·분봉 수집 `stock-minute-price.collector`·쿼트 캐시 `realtime-quote.cache`) + **KRX 일봉·지수** cron(`krx-market-data.scheduler`) + DART 종목상태 + 새너티 체크(일봉/지수) → `StockDailyPrice`·`StockMinutePrice`·`MarketIndex` |
| 기술지표 계산 | `indicators/` | MA(5/20/60)/RSI/MACD/볼린저/ATR/VWAP 계산·배치·백필 → `TechnicalIndicator` |
| 이벤트 스터디 | `event-study/` | 공시 후 가격반응(D0 산정·비정상수익률·통계 유의성) 집계 cron + 쿼리 API → `EventStudyResult` |
| 매수신호 점수 | `buy-signal/` | 버킷별 scorer(공시이벤트·펀더멘털·핵심지표·내부자·과거이벤트·차트·수급유동성·시장섹터·페르소나적합·리스크페널티) + 버킷 재정규화 + 진입조건 평가 + suppression-reason — **순수 Rule** |
| 신호 생성 | `signal-generation/` | 신호 생성 cron·백필·재생성·persona-view rule → `TradingSignal` |
| 신호 조회 | `signals/` | 신호 조회 API(컨트롤러·서비스) |
| 백테스트 | `backtest/` | 러너·리플레이(에쿼티커브)·평가코퍼스·신호정확도·캘리브레이션·전략 프리셋(다중트랙 4종 `strategies/`)·시장캘린더/가격 제약 → `BacktestRun` |
| 분봉 단타 | `intraday-scalp/` | 분봉 기반 단타 **신호 산출**(5번째 트랙) — 체결·15:20 강제청산은 Engine5 `paper-simulation/intraday-scalp/` 담당 |

## 데이터 소스 (구현 완료)

1. **KIS OpenAPI** — 실시간 현재가·분봉 (라이브 검증 완료)
2. **KRX 데이터마켓플레이스** — 일봉·지수·종목상태 cron

포트/어댑터 구조: 운영은 Prisma 어댑터(`event-study/adapters/prisma-*`, `backtest/ports/prisma-price-data.adapter`), 인메모리 어댑터는 테스트 전용. **분봉(`StockMinutePrice`)은 TimescaleDB 하이퍼테이블**(마이그레이션 `20260620000000_dar381_minute_prices_timescaledb`) — 분봉은 forward-only(KIS 당일치만 제공).

## 현재 상태 (M4~M6·M9 완료 — 99 src / 59 spec)

| 마일스톤 | 목표 | 상태 |
|---|---|---|
| M4~M5 | 시세 수집(KIS 실시간+KRX 일봉)·Prisma 모델·cron | ✅ 완료 |
| M6 | 기술지표 + BuyScore 공식 + 신호 생성 연동 | ✅ 완료 |
| M9 | Event Study·백테스트·다중전략 트랙·단타 | ✅ 완료 |
| M10 | 모의운용 30일(캘린더시간) 데이터 공급 중 | 🚧 진행 |

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
