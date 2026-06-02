> 상위 문서: [역할 인덱스](./README.md) · [실행 로드맵](../01-execution-roadmap.md)

# 백엔드(BE) 역할 문서

> 최종 수정일: 2026-06-02

---

## 1. 역할 정의 & 책임 범위

### 소유 영역

BE 파트는 **NestJS 모놀리스 서버 전체**를 소유한다. 구체적으로:

- **API 레이어**: 모든 HTTP 엔드포인트(컨트롤러·DTO·응답 스키마)
- **서비스 레이어**: 5개 엔진의 비즈니스 로직 서비스 클래스
- **스케줄러·워커**: BullMQ 워커 분리 및 Cron 스케줄러 (`@nestjs/bullmq`, `@nestjs/schedule`)
- **DB 레이어**: Prisma 모델 정의·마이그레이션·시드 스크립트 (`backend/prisma/`)
- **외부 연동**: DART OpenAPI, KRX 데이터마켓플레이스(1차), 증권사 OpenAPI(KIS, 보완·체결)
- **Risk Engine**: AI 금지영역을 코드로 강제하는 `RiskCheckService` — 이 서비스는 `AiAnalystModule`에 의존성을 갖지 않고 독립 실행되어야 한다.

### 경계 (다른 파트와의 구분)

| 파트 | BE가 넘기는 것 | BE가 받는 것 |
|------|--------------|------------|
| **FE** | REST API JSON 스펙, 푸시 알림 페이로드, Swagger 문서 | 화면 요구사항, API 응답 필드 추가 요청 |
| **DQ** | DB 스키마·인덱스 구조, 집계 쿼리 인터페이스 | Buy/Exit Score 공식(의사코드), 지표 정의, 이벤트별 수치 명세 |
| **AI** | AI 호출 래퍼(`LlmWrapperService`), `AIUsageLog` 저장 인터페이스 | 프롬프트 템플릿, 출력 JSON 스키마, L0~L3 게이트 조건 |
| **화면/시나리오** | API 스펙 문서 | 화면 정의서(신호 카드·승인 플로우 등) |
| **QA** | 테스트 환경·seed·API 문서 | 회귀 체크포인트 결과, 게이트 go/no-go |
| **인프라** | 컨테이너 이미지(`Dockerfile`), 환경 변수 목록 | Redis·RDS·ECS 엔드포인트, CI/CD 파이프라인 |

---

## 2. 마일스톤별 업무 (M0~M12)

### M0 — 기준선 & 수집 안정화 【주담당 R】

**목표**: 신뢰할 수 있는 공시 수집 파이프라인 확립

- [ ] `DisclosureCollectionLog` Prisma 모델 추가 및 마이그레이션 실행
  - 필드: `id`, `startedAt`, `endedAt`, `bgnDe`, `endDe`, `fetchedCount`, `newCount`, `skippedCount`, `failedCount`, `status("RUNNING"|"SUCCESS"|"PARTIAL"|"FAILED")`, `errorMessage`, `triggeredBy`
- [ ] 공시 수집 Cron(`scheduler.service.ts`)에 CollectionLog 생성·완료·실패 기록 로직 추가
- [ ] 지수 백오프 재시도(최대 3회) 및 중복 실행 Lock 검증
- [ ] 관심종목(`WatchList`) 기준 필터링 강화 — 관심 외 기업 공시는 수집하되 알림에서만 제외하는 현행 방식 유지 또는 정책 확정
- [ ] 공시 7분류 → 5종 투자 이벤트 1차 게이트 분류 로직 추가 (`disclosureType` → `isInvestmentRelevant: boolean`)
- [ ] `GET /scheduler/collection-logs` 엔드포인트 — 수집 이력 조회(최근 50건, 상태 필터)
- [ ] `POST /scheduler/collect` 기존 API 호환성 유지 확인
- [ ] 기존 카카오 로그인·관심목록·알림·푸시·딥링크가 스키마 변경 후에도 동작하는지 회귀 확인

> 회귀 체크(현행 develop 자산): 기존 마이그레이션 5개 모두 `migrate deploy` 재현 가능한지, rcpNo/corpCode FK 고아 레코드 0인지 확인

---

### M1 — 공시 원문 파싱 【주담당 R】

**목표**: rcpNo 기준 원문 다운로드·구조화 (`DisclosureDocument`)

- [ ] `ParseStatus` enum 및 `DisclosureDocument` Prisma 모델 추가 마이그레이션
  - 필드: `rcpNo @id`, `rawFilePath`, `rawHtml @db.Text`, `rawText @db.Text`, `parsedJson`, `charCount`, `parseStatus`, `parseError`, `isAmendment`, `originalRcpNo`, `fetchedAt`, `parsedAt`
- [ ] `Disclosure` 모델에 `documents` 역참조 relation 추가 마이그레이션
- [ ] `engine1-disclosure/parsing/parsing.service.ts` 구현
  - `fetchRawDocument(rcpNo: string): Promise<string>` — DART 뷰어 HTML 다운로드
  - `parseDocument(rcpNo: string): Promise<DisclosureDocument>` — HTML→rawText 추출, 표→parsedJson 변환
- [ ] BullMQ 큐 `disclosure-parse` 등록 및 Parse Worker 구현
  - 공시 수집 직후 `disclosure.new` 이벤트 발행 → Parser Worker 소비
- [ ] 정정공시 판단 로직: `isAmendment`, `originalRcpNo` 추출
- [ ] 파싱 실패 시 `parseStatus: FAILED`, 재처리 큐(DLQ) 등록
- [ ] `GET /disclosures/:rcpNo/document` — 원문 파싱 결과 조회 엔드포인트

> ↩︎ M0 회귀: 신규 공시 수집 직후 `disclosure-parse` 큐에 누락 없이 enqueue되는지 확인, CollectionLog 건수 vs DisclosureDocument 건수 정합 모니터링

---

### M2 — 이벤트·수치 추출 【주담당 R】

**목표**: 5종 이벤트 분류 + 핵심 수치 JSON (`DisclosureEvent`)

- [ ] `DisclosureEventType`, `EventPolarity` enum 추가 마이그레이션
- [ ] `DisclosureEvent` Prisma 모델 추가 마이그레이션
  - 필드: `id`, `rcpNo(FK)`, `corpCode(FK, 역정규화)`, `eventType`, `polarity`, `keyMetrics Json`, `confidence Float`, `extractedBy("RULE"|"AI_ASSISTED")`, `eventDate`, `createdAt`
  - 인덱스: `(rcpNo)`, `(corpCode)`, `(eventType)`, `(polarity)`, `(createdAt)`
- [ ] `engine1-disclosure/event-extraction/event-extraction.service.ts` 구현
  - `classifyEventType(reportName, parsedJson): DisclosureEventType` — `report_nm` 정규식 + 본문 키워드 룰
  - `extractEvents(rcpNo, parsedJson): Promise<DisclosureEvent[]>` — 5종 이벤트별 수치 파서
  - 공급계약: `contractAmount`, `recentSales`, `salesRatio`, `counterparty`, `contractStartDate`, `contractEndDate`, `isAmendment`
  - 유상증자: `issueType`, `fundingAmount`, `purpose`, `newShares`, `existingShares`, `dilutionRate`, `discountRate`
  - 자사주/배당/CB·BW 이벤트별 keyMetrics 스키마 정의
- [ ] BullMQ 큐 `event-extract` 등록 및 Event Extraction Worker 구현
- [ ] `GET /disclosures/:rcpNo/events` 엔드포인트
- [ ] `Company` 모델에 `disclosureEvents` 역참조 relation 추가

> ↩︎ M1 회귀: 표 파싱 누락이 수치 추출 실패로 전파되는 비율 측정, 임계치(10%) 초과 시 M1 파서 보강 후 재진입

---

### M3 — AI Analyst + 비용계측 토대 【주담당 R】

**목표**: 4개 AI Task 래퍼 + `AIUsageLog`·L0~L2 게이트

- [ ] `AITaskType`, `AILevel` enum 추가 마이그레이션
- [ ] `InvestorPersona`, `DisclosureAnalysis`, `PersonaAnalysis`, `AIUsageLog` Prisma 모델 추가 마이그레이션
- [ ] `InvestorPersona` 시드 4종 (`prisma/seed.ts`에 추가): `VALUE`, `GROWTH`, `MOMENTUM`, `EVENT_DRIVEN`
- [ ] `engine2-ai-analyst/` 폴더 구조 생성 및 `AiAnalystModule` 등록
  - `AiCostGateService.evaluateGate(event)`: L0~L3 판정 로직 (관리종목·거래대금·eventType·buyScore·isHolding·polarity 조건)
  - `LlmWrapperService.call(prompt, schema, level)`: 외부 LLM API 호출 + 응답 JSON 파싱 + 실패 시 fallback 처리
  - `AiUsageLogService.logUsage(params)`: 매 LLM 호출마다 `AIUsageLog` 저장 (inputTokens, outputTokens, estimatedCost, latencyMs, success)
  - `AiUsageLogService.getCostMetrics(from, to)`: 기간별 비용 집계(공시당·신호당 비용)
- [ ] 4개 AI Task 구현 (모두 rcpNo+taskType 멱등 캐시 — 동일 rcpNo에 동일 task 재호출 방지):
  - `SummaryTask.run(rcpNo)`: `DISCLOSURE_SUMMARY` — 요약·긍정·부정 요인·polarity
  - `EventClassificationTask.run(rcpNo)`: `EVENT_CLASSIFICATION` — 이벤트 타입 보정
  - `PersonaInterpretationTask.run(rcpNo, personas)`: `PERSONA_INTERPRETATION` — 4종 해석
  - `PositionThesisTask.run(rcpNo, signalId)`: `POSITION_THESIS` — Thesis AI 초안
- [ ] BullMQ 큐 `ai-analyze` 등록, AI Analyst Worker 구현 (LLM 응답 지연 대비 timeout 60초·retry 3회)
- [ ] AI 입력 토큰 최대 2,000 tokens 제한 강제 (`charCount` 기반 슬라이싱)
- [ ] `GET /disclosures/:rcpNo/analysis` 엔드포인트
- [ ] `GET /admin/ai/cost-metrics?from=&to=` 엔드포인트

> ↩︎ M2 회귀: AI 이벤트 타입 보정 결과 vs M2 Rule 분류 불일치율 추적 로그 추가, L0(미사용) 비율 ≥ 70% 유지 확인

---

### M4 — 시세·시장 데이터 (KRX) 【주담당 R】

**목표**: 일봉·지표·종목상태 토대

- [ ] `StockDailyPrice`, `StockMinutePrice`, `TechnicalIndicator` Prisma 모델 추가 마이그레이션
  - `StockDailyPrice`: `(corpCode, tradeDate) @unique`, `source @default("KRX")`
  - `StockMinutePrice`: BIGINT PK + `(corpCode, tradeAt)` 인덱스, 파티셔닝 DDL 스크립트 별도(`backend/prisma/sql/partition_minute_prices.sql`)
  - `TechnicalIndicator`: `(corpCode, tradeDate) @unique`, MA5/20/60/120, RSI14, MACD, Bollinger, ATR14, VWAP, volumeRatio20, isNewHigh52w, isNewLow52w, priceVsMa20
- [ ] `engine3-quant-market/market-data/` 구현
  - `MarketDataService.fetchDailyPrice(stockCode, from, to)`: KRX 데이터마켓플레이스 API 호출
  - `MarketDataService.fetchCurrentPrice(stockCode)`: 증권사 KIS OpenAPI (실시간 보완)
  - `MarketDataScheduler`: 장중 1분봉 수집(Cron), 장마감 후 일봉 수집(Cron)
- [ ] `engine3-quant-market/indicators/technical-indicator.service.ts` 구현
  - `calculateIndicators(corpCode, baseDate)`: 일봉 데이터 기반 지표 계산 → `TechnicalIndicator` upsert
  - BullMQ 큐 `indicator-calculate` — 일봉 업데이트 트리거 후 비동기 계산
- [ ] `Company.stockCode` null 종목 처리: stockCode null이면 Engine3 수집 건너뜀, 비상장 공시 L0 처리 플래그
- [ ] `GET /market/prices/:corpCode?from=&to=` — 일봉 조회 엔드포인트
- [ ] `GET /market/indicators/:corpCode?date=` — 최신 기술지표 조회 엔드포인트
- [ ] `Company.market` 컬럼 정확도 보완: KRX 데이터마켓플레이스 상장종목 데이터로 seed 업데이트 배치 추가

> ↩︎ M0 회귀: `Company.stockCode`/`market` 오매핑 비율 측정, 공시 `rcpDt` 거래일 캘린더 정합(휴장일 보정) 로직 추가

---

### M5 — Event Study 【협업 C】

해당 없음(DQ 주담당). BE는 아래를 지원:

- [ ] `EventStudyResult` Prisma 모델 추가 마이그레이션 (DQ 설계 확정 후)
  - 필드: `eventType`, `subCategory`, `corpCode?`, `sampleSize`, `arD1Mean~arD20Mean`, `winRateD5`, `crashRateD5`, `avgMaxDrawdown`, `volumeRatioD1`, `statsJson`, `computedAt`
- [ ] `GET /event-study?eventType=&subCategory=` — 통계 조회 API 구현
- [ ] DQ가 계산한 집계 결과를 `EventStudyResult`에 upsert하는 배치 API 제공

---

### M6 — 매수 Signal Engine 【주담당 R】

**목표**: Buy Score 계산 및 `TradingSignal` 저장

- [ ] `SignalGrade` enum 및 `TradingSignal` Prisma 모델 추가 마이그레이션
  - 필드: `corpCode(FK)`, `eventId?`, `rcpNo?`, `personaCode?`, `signalGrade`, `buyScore`, `scoreBreakdown Json`, `entryConditions Json`, `riskFactors Json`, `suggestedEntry?`, `suggestedStop?`, `suggestedTarget?`, `isBacktest`, `expiresAt?`, `createdAt`
  - AI 금지 주석: 이 테이블의 `signalGrade`·`buyScore`는 참고용. 최종 주문 승인·수량·손익 하드룰은 Risk Engine 전담.
- [ ] `engine3-quant-market/buy-signal/buy-signal.service.ts` 구현
  - `computeBuyScore(params: BuyScoreParams): Promise<TradingSignal>`
  - 구성 요소별 점수 함수: `disclosureEventScore()`, `quantScore()`, `personaFitScore()`, `eventStudyScore()`, `chartScore()`, `volumeScore()`, `marketSentimentScore()`, `riskPenalty()`
  - 가중치를 config(`strategy.config.ts`)에 분리 — 코드 수정 없이 조정 가능
  - 등급 매핑: 80↑ `STRONG_BUY`, 60~79 `BUY`, 30~59 `WATCH`, -29~29 `NEUTRAL`, -30↓ `AVOID`
- [ ] BullMQ 큐 `signal-generate` 등록, Signal Generation Worker 구현
  - `analysis.done` 이벤트 소비 → Buy Score 계산 → `TradingSignal` 저장 → `signal.ready` 발행
- [ ] `GET /signals?corpCode=&grade=&from=&to=` — 신호 목록 조회
- [ ] `GET /signals/:id` — 신호 상세 (scoreBreakdown 포함)

> ↩︎ M3·M4·M5 회귀: Event Study 통계가 scoreBreakdown에 실제 반영되는지, 지표 계산 지연(최신 날짜 기준 일봉)으로 오래된 지표를 참조하지 않는지 확인

---

### M7 — Position Thesis 【주담당 R】

**목표**: 진입 논리·훼손 조건 저장 (`PositionThesis`)

- [ ] `TradeMode`, `PositionStatus` enum 및 `Portfolio`, `Position`, `PositionThesis` Prisma 모델 추가 마이그레이션
  - `PositionThesis`: `stopLossHardPct`, `maxWeightPct` 필드에 서비스 레이어 Role 검사 강제 (AI 수정 금지 주석 + `ThesisService` 내 hardStop 업데이트 권한 체크)
  - `Position.@@unique([portfolioId, corpCode, status])` — 동일 포트폴리오 내 중복 오픈 포지션 방지
- [ ] `engine4-portfolio-exit/thesis/position-thesis.service.ts` 구현
  - `createThesis(positionId, signalId, rcpNo, draft): Promise<PositionThesis>` — AI Thesis 초안 수신 후 저장
  - `invalidateThesis(thesisId, reason)` — 훼손 조건 발동 시 `isActive: false`로 전환
  - `updateHardStop(thesisId, newPct, updatedBy)`: `updatedBy === 'AI_SYSTEM'` 이면 예외 발생 (AI 금지 강제)
- [ ] `engine4-portfolio-exit/portfolio/portfolio.service.ts` + `position.service.ts` 기본 구현
  - `createPortfolio(userId, params)`, `getPortfolio(userId)`
  - `openPosition(portfolioId, params)`, `closePosition(positionId, exitReason)`
- [ ] BUY 신호 생성 시 `PositionThesis` 자동 생성 연결 — TradingSignal 1:1 Thesis 보장
- [ ] `POST /portfolios/:id/positions` — 포지션 개설 엔드포인트
- [ ] `GET /positions/:id/thesis` — Thesis 조회 엔드포인트

> ↩︎ M6 회귀: BUY 신호와 Thesis 자동연결 정합, `invalidConditions` 항목이 기계 평가 가능한 형태(추상 문장 금지)인지 코드 검증

---

### M8 — Portfolio & Exit Engine 【주담당 R】

**목표**: Exit Score·`ExitSignal`·5액션·하루 3회 점검

- [ ] `ExitAction` enum 및 `PositionDailySnapshot`, `ExitSignal`, `PortfolioRiskSnapshot` Prisma 모델 추가 마이그레이션
  - `ExitSignal`: `suggestedQty` 필드는 Risk Engine 산출 — AI 수정 금지 주석, 서비스 레이어 강제
  - `PortfolioRiskSnapshot`: `maxDrawdownLimit`·`dailyLossLimit`은 하드룰, AI 참조만 허용·변경 금지
- [ ] `engine4-portfolio-exit/exit-signal/exit-signal.service.ts` 구현
  - `computeExitScore(positionId): Promise<ExitSignal>` — 6종 매도 트리거 점수화
    - `lossRisk()`, `thesisInvalidation()`, `chartDamage()`, `disclosureRisk()`, `overWeight()`, `timeDecay()`, `positiveM omentumBonus()`
  - 액션 매핑: 90↑ `BLOCK_REBUY`, 70~89 `EXIT`, 50~69 `REDUCE`, 30~49 `WATCH`, else `HOLD`
  - `suggestedQty` 계산은 Risk Engine 위임 (AI 개입 금지)
- [ ] `engine4-portfolio-exit/tracking/portfolio-tracking.scheduler.ts` — 하루 3회 Cron 등록
  - `@Cron('30 8 * * 1-5')` 장 시작 전 08:30
  - `@Cron('0 11 * * 1-5')` 장중 11:00
  - `@Cron('0 16 * * 1-5')` 장 마감 후 16:00
  - 각 Cron: 보유 포지션 전체 Exit Score 일괄 재계산 → `PositionDailySnapshot` upsert → `ExitSignal` 저장 → `portfolio-check` 큐 발행 → FE 푸시 알림(EXIT 이상 시)
- [ ] `PortfolioRiskSnapshot` 일별 스냅샷 저장 (총 평가액·일간 손익·MDD·집중도 리스크)
- [ ] BullMQ 큐 `exit-evaluate` 등록, Exit Worker 구현 (시세 업데이트·정정공시 악화 트리거)
- [ ] `GET /portfolios/:id/risk-snapshot` — 리스크 스냅샷 조회

> ↩︎ M7 회귀: `PositionThesis.invalidConditions`가 Exit 점검 시 실제로 평가되는지 통합 테스트, thesis 훼손 → `EXIT` 액션 end-to-end 동작 확인

---

### M9 — 백테스트 【협업 C】

해당 없음(DQ 주담당). BE는 아래를 지원:

- [ ] `BacktestRun`, `BacktestTrade` Prisma 모델 추가 마이그레이션
- [ ] `POST /backtests` — 백테스트 실행 요청 API (파라미터: startDate, endDate, eventTypes, personaCodes, strategyParams)
- [ ] `GET /backtests/:id` — 실행 결과 조회 (status + resultJson)
- [ ] `GET /backtests/:id/trades` — 개별 거래 목록 조회
- [ ] 백테스트 엔진 자체는 DQ 담당; BE는 API·DB 레이어 및 lookahead bias 방지용 시점 파라미터(backtest 전용 시세 조회 메서드) 제공

---

### M10 — 모의투자 + 비용 거버넌스 완성 ★ MVP 졸업 게이트 【주담당 R】

**목표**: 실데이터 모의운용 + 실비용 측정

- [ ] `PaperTrade` Prisma 모델 추가 마이그레이션 + `Portfolio.mode = PAPER` 자동 생성 배치
- [ ] `engine5-trading-risk/paper-trade/paper-trade.service.ts` 구현
  - `createPaperOrder(portfolioId, signal)`: 시장가 시뮬(시가/종가 중 선택 + 슬리피지 0.1% 적용)
  - `settlePaperTrade(paperTradeId, currentPrice)`: 체결 가격·수수료·세금·순손익 계산, `aiCostUsd` 연결
  - 부분체결 시뮬 (거래량 < 주문수량 시 비율 체결)
- [ ] L0~L3 비용 게이트 완성 — L3 조건까지 코드 구현, 일별 AI 호출 한도 하드캡 적용
- [ ] AI 비용 대시보드 API: `GET /admin/ai/cost-metrics` — Cost per Disclosure/Signal/Trade, AI비용/모의순익 비율
- [ ] `GET /portfolios/:id/paper-trades` — 모의 거래 목록 조회
- [ ] `GET /portfolios/:id/performance` — 누적 수익률·AI비용·신호 적중률 집계
- [ ] 전체 파이프라인 end-to-end 통합 테스트: 수집(M0)→파싱(M1)→이벤트(M2)→AI(M3)→시세(M4)→통계(M5)→신호(M6)→Thesis(M7)→Exit(M8) 실시간 연결 무결성 확인

> ↩︎ 전 구간 회귀: M3 추정 AI 비용 vs 실측 비용 일치 검증, 백테스트 가정(슬리피지) vs 모의 실측 괴리 측정

---

### M11 — 반자동매매 【주담당 R】

**목표**: 사용자 승인 주문 + 증권사 API + Risk 사전체크

- [ ] `OrderSide`, `OrderStatus` enum 및 `OrderRequest`, `OrderExecution`, `TradingAuditLog` Prisma 모델 추가 마이그레이션
  - `OrderRequest`: `requestedShares`, `limitPrice` — AI 수정 금지 주석, Risk Engine 산출값만
  - `TradingAuditLog`: INSERT-ONLY 정책 — DB-level Trigger `BEFORE UPDATE/DELETE RAISE EXCEPTION` 또는 서비스 레이어 강제
- [ ] `engine5-trading-risk/risk-check/risk-check.service.ts` 완성 (AI 의존성 0 — 독립 실행 아키텍처 테스트 필수)
  - `checkPreOrderRisk(params): RiskCheckResult` — 6항목 하드룰 검사:
    1. 단일종목 비중 한도 (≤ 10%)
    2. 1일 손실한도 (≤ -2%)
    3. 1회 주문금액 한도 (≤ 포트폴리오 3%)
    4. 연속손실 횟수 N회 → 자동중단
    5. Kill Switch 상태 (`killSwitchEnabled = true` 이면 전체 주문 차단)
    6. API 오류 상태 (마지막 증권사 API 호출 실패 시 신규 주문 중단)
- [ ] `engine5-trading-risk/order/order.service.ts` 구현
  - `proposeOrder(signalId, positionId)`: Risk 사전체크 통과 시에만 `OrderRequest` 생성 (status: `PENDING_APPROVAL`)
  - `approveOrder(requestId, userId)`: 사용자 승인 → 증권사 API 주문 전송 → `OrderExecution` 저장 → `TradingAuditLog` 기록
  - `rejectOrder(requestId, userId)`: 거절 → TradingAuditLog 기록
  - 멱등 주문키 (`idempotencyKey = portfolioId + corpCode + timestamp`) — 중복 주문 방지
- [ ] 증권사 KIS OpenAPI 연동: 인증(OAuth 2.0) + 주문 API + 체결조회 API
- [ ] `POST /orders/propose` — 주문안 생성 엔드포인트
- [ ] `POST /orders/:id/approve` — 주문 승인 엔드포인트
- [ ] `POST /orders/:id/reject` — 주문 거절 엔드포인트
- [ ] `GET /orders/:id/audit-log` — 감사 로그 조회
- [ ] AI는 주문 승인 불가 확인 — `approveOrder` 에서 `actorType === 'AI_SYSTEM'` 이면 예외 발생

> ↩︎ M10 회귀: 모의 검증 신호·Exit 로직이 실주문 경로에서 동일 동작, Risk Engine이 AI 긍정 신호 거부(veto) 동작 확인

---

### M12 — 제한적 자동매매 【주담당 R】

**목표**: 검증 전략 한정 자동화 + Risk veto·Kill Switch 하드코딩

- [ ] 이벤트 화이트리스트(6종) / 블랙리스트(9종) 상수 파일 (`auto-trade-whitelist.constant.ts`)
  - 화이트리스트: `SHARE_BUYBACK`, `SUPPLY_CONTRACT`, `DIVIDEND_INCREASE`, `EARNINGS_SURPRISE`, `SHARE_CANCELLATION`, (검증된 1종 추가)
  - 블랙리스트: `PAID_IN_CAPITAL_INCREASE`, `CB_ISSUANCE`, `BW_ISSUANCE`, `AUDIT_OPINION_RISK`, `TRADING_SUSPENSION`, `DELISTING_RISK`, `LAWSUIT`, `MAJOR_SHAREHOLDER_CHANGE`, `THIRD_PARTY_ALLOTMENT`
- [ ] `RiskCheckService` 하드 리스크 룰 완성:
  - `MAX_SINGLE_ORDER_PCT = 0.03` (포트폴리오의 3%)
  - `MAX_SINGLE_STOCK_PCT = 0.10` (10%)
  - `MAX_DAILY_LOSS_PCT = -0.02` (-2%)
  - `MAX_WEEKLY_LOSS_PCT = -0.05` (-5%)
  - `MAX_CONSECUTIVE_LOSS_COUNT = 3` (3회 연속 손실 시 자동중단)
  - 시장 급락 감지 (KOSPI -2% 이하 시 신규 매수 중단)
  - Kill Switch API: `POST /admin/kill-switch/activate` + `POST /admin/kill-switch/deactivate`
- [ ] `AUTO` 모드 `OrderRequest` 자동 처리: `approvedBy = "AUTO"`, Risk 통과 시에만 즉시 전송
- [ ] 자동주문 발생 시 FE 즉시 푸시 알림 (TradingAuditLog 기반)
- [ ] Risk Engine veto 테스트: AI가 STRONG_BUY 신호를 내더라도 하드룰 위반 시 주문 생성 자체가 차단됨을 통합 테스트로 검증

> ↩︎ M11 회귀: 반자동에서 안정적이었던 전략만 자동화 후보 상태 확인, 해당 이벤트가 M9·M10 졸업 조건(백테스트 3구간 통과·30일+ 모의 누적수익 > 0) 충족 여부 DB 조회 쿼리 추가

---

## 3. 다른 역할과의 인터페이스 & 핸드오프

### BE → FE

| 산출물 | 형식 | 전달 시점 |
|--------|------|----------|
| REST API JSON 응답 스펙 | Swagger `/api/docs` | 각 마일스톤 완료 시 |
| 푸시 알림 페이로드 스키마 | 문서/타입 정의 | M8 Exit 알림 추가 시 |
| `TradingSignal` / `ExitSignal` 조회 API | GET 엔드포인트 | M6, M8 |
| `OrderRequest` 승인/거절 API | POST 엔드포인트 | M11 |

### BE → DQ

| 산출물 | 형식 | 전달 시점 |
|--------|------|----------|
| `StockDailyPrice`, `TechnicalIndicator` DB 스키마 | Prisma 모델 확정 | M4 착수 전 |
| 백테스트 실행 API (`POST /backtests`) | API 스펙 | M9 착수 전 |
| `EventStudyResult` upsert API | 내부 서비스 메서드 | M5 착수 전 |

### BE → AI

| 산출물 | 형식 | 전달 시점 |
|--------|------|----------|
| `LlmWrapperService` 인터페이스 | TypeScript 타입 | M3 착수 전 |
| `AIUsageLog` 저장 인터페이스 | `AiUsageLogService.logUsage()` 시그니처 | M3 |
| AI 비용 게이트 `evaluateGate()` 결과 타입 | `AILevel` enum | M3 |

### BE → 인프라

| 산출물 | 형식 | 전달 시점 |
|--------|------|----------|
| 환경 변수 목록 업데이트 | `.env.example` | 각 외부 API 연동 시 |
| BullMQ Redis 의존성 | `docker-compose.dev.yml` 업데이트 | M1 착수 전 |
| `Dockerfile` 업데이트 (신규 빌드 의존성) | Docker | 각 단계 |
| ECS 서비스 분리 요구사항 | 문서 | M4~M5 |

### 회귀 체크포인트에서 BE 재확인 항목

| 마일스톤 | BE 재확인 항목 |
|----------|--------------|
| M0 종료 | 기존 5개 마이그레이션 `migrate deploy` 재현 가능, rcpNo/corpCode FK 고아 레코드 0 |
| M1 종료 | CollectionLog vs DisclosureDocument 건수 정합, 파싱 실패율 < 10% |
| M2 종료 | 이벤트 분류 정확도 ≥ 90%(100건 수동 검증), 수치 추출 정확도 ≥ 85% |
| M3 종료 | AI 분석 10건+ JSON 정상, 공시 1건당 평균 비용 < $0.005, L0 비율 ≥ 70% |
| M4 종료 | 관심 50종목 일봉 결측률 < 2%, `Company.stockCode` null 처리 완전 |
| M8 종료 | 50포지션 Exit Score 일괄 점검 ≤ 60초, thesis 훼손 → EXIT 액션 |
| M10 종료 | 전 파이프라인 end-to-end 연결 무결성, AI비용/모의순익 ≤ 20% 실측 |
| M11 종료 | Risk Engine이 AI 긍정 신호 거부 가능, 모든 주문 audit 기록 |
| M12 종료 | AI 금지영역 침범 0 (TradingAuditLog 감사), Kill Switch 코드 동작 |

---

## 4. 산출물 목록

### DB/마이그레이션

| 산출물 | 마일스톤 |
|--------|---------|
| `DisclosureCollectionLog` 모델·마이그레이션 | M0 |
| `DisclosureDocument`, `ParseStatus` enum | M1 |
| `DisclosureEvent`, `DisclosureEventType`, `EventPolarity` enum | M2 |
| `InvestorPersona`, `DisclosureAnalysis`, `PersonaAnalysis`, `AIUsageLog`, `AITaskType`, `AILevel` enum | M3 |
| `StockDailyPrice`, `StockMinutePrice`, `TechnicalIndicator` + `partition_minute_prices.sql` | M4 |
| `EventStudyResult` | M5(지원) |
| `TradingSignal`, `SignalGrade` enum | M6 |
| `Portfolio`, `Position`, `PositionThesis`, `TradeMode`, `PositionStatus` enum | M7 |
| `PositionDailySnapshot`, `ExitSignal`, `PortfolioRiskSnapshot`, `ExitAction` enum | M8 |
| `BacktestRun`, `BacktestTrade` | M9(지원) |
| `PaperTrade` | M10 |
| `OrderRequest`, `OrderExecution`, `TradingAuditLog`, `OrderSide`, `OrderStatus` enum | M11 |

### NestJS 서비스·스케줄러

| 파일 | 마일스톤 |
|------|---------|
| `engine1-disclosure/collection/collection.service.ts` | M0 |
| `engine1-disclosure/parsing/parsing.service.ts` | M1 |
| `engine1-disclosure/event-extraction/event-extraction.service.ts` | M2 |
| `engine2-ai-analyst/cost-gate/ai-cost-gate.service.ts` | M3 |
| `engine2-ai-analyst/usage-log/ai-usage-log.service.ts` | M3 |
| `engine2-ai-analyst/tasks/*.task.ts` (4개) | M3 |
| `engine3-quant-market/market-data/market-data.service.ts` | M4 |
| `engine3-quant-market/indicators/technical-indicator.service.ts` | M4 |
| `engine3-quant-market/buy-signal/buy-signal.service.ts` | M6 |
| `engine4-portfolio-exit/thesis/position-thesis.service.ts` | M7 |
| `engine4-portfolio-exit/portfolio/portfolio.service.ts` | M7 |
| `engine4-portfolio-exit/position/position.service.ts` | M7 |
| `engine4-portfolio-exit/exit-signal/exit-signal.service.ts` | M8 |
| `engine4-portfolio-exit/tracking/portfolio-tracking.scheduler.ts` | M8 |
| `engine5-trading-risk/risk-check/risk-check.service.ts` | M11 완성(M8~M10 뼈대) |
| `engine5-trading-risk/paper-trade/paper-trade.service.ts` | M10 |
| `engine5-trading-risk/order/order.service.ts` | M11 |
| `engine5-trading-risk/execution/execution.service.ts` | M11 |

### API 엔드포인트

| 엔드포인트 | 마일스톤 |
|-----------|---------|
| `GET /scheduler/collection-logs` | M0 |
| `GET /disclosures/:rcpNo/document` | M1 |
| `GET /disclosures/:rcpNo/events` | M2 |
| `GET /disclosures/:rcpNo/analysis` | M3 |
| `GET /admin/ai/cost-metrics` | M3, M10 완성 |
| `GET /market/prices/:corpCode` | M4 |
| `GET /market/indicators/:corpCode` | M4 |
| `GET /event-study` | M5 지원 |
| `GET /signals` / `GET /signals/:id` | M6 |
| `POST /portfolios/:id/positions` | M7 |
| `GET /positions/:id/thesis` | M7 |
| `GET /portfolios/:id/risk-snapshot` | M8 |
| `POST /backtests` / `GET /backtests/:id` | M9 지원 |
| `GET /portfolios/:id/paper-trades` | M10 |
| `GET /portfolios/:id/performance` | M10 |
| `POST /orders/propose` / `POST /orders/:id/approve` / `POST /orders/:id/reject` | M11 |
| `POST /admin/kill-switch/activate` · `/deactivate` | M12 |

### 설정·상수 파일

| 파일 | 내용 |
|------|------|
| `src/common/queues/queue.constants.ts` | BullMQ 큐 이름 8개 상수 |
| `src/common/config/strategy.config.ts` | Buy Score 가중치 config |
| `src/engine5-trading-risk/constants/auto-trade-whitelist.constant.ts` | 이벤트 화이트리스트/블랙리스트 |
| `src/engine5-trading-risk/constants/risk-rules.constant.ts` | 하드 리스크 룰 수치 |

---

## 5. 역할 특화 표준·체크리스트

### 5-1. Prisma 마이그레이션 규율

- [ ] 신규 모델은 반드시 `npx prisma migrate dev --name <설명>` 으로 마이그레이션 커밋 생성
- [ ] `npx prisma validate` 통과 필수 — CI 파이프라인 단계로 추가
- [ ] 기존 자연키(`Disclosure.rcpNo`, `Company.corpCode`) FK 정합 — 고아 레코드 허용 금지
- [ ] `DisclosureCollectionLog`·`AIUsageLog` 같은 로그성 테이블은 DELETE 금지 규약 (`TradingAuditLog` INSERT-ONLY 강제)
- [ ] 대용량 테이블(`StockMinutePrice`) 파티셔닝 DDL은 Prisma migrate 이후 별도 SQL 스크립트 수동 적용

### 5-2. AI 금지영역 코드 강제 규약

BE 파트가 코드로 강제해야 하는 AI 금지영역:

| 금지 항목 | 강제 방법 |
|----------|----------|
| 최종 주문 승인 | `approveOrder()` — `actorType === 'AI_SYSTEM'` 시 예외, `RiskCheckService`가 AI 모듈 미의존 구조 유지 |
| 손절·익절 하드 룰 수정 | `ThesisService.updateHardStop()` — `updatedBy === 'AI_SYSTEM'` 시 `ForbiddenException` |
| 포트폴리오 한도 변경 | `PortfolioService` — limit 변경 메서드에서 actorType 검사 |
| 주문 수량 결정 | `OrderRequest.requestedShares` — Risk Engine 계산값만 허용, AI 서비스에서 직접 설정 불가 |
| 리스크 룰 우회 | `RiskCheckService` — AI Analyst 모듈에 의존성 없이 독립 실행, DI 컨테이너에서 분리 |

### 5-3. BullMQ 큐 운영 규약

- Dead Letter Queue(DLQ) 설정: 재시도 3회 실패 시 `*-failed` 큐로 이동 후 알림
- `removeOnComplete: false` — 완료 메시지 48시간 보존 (디버깅용)
- 큐 이름은 `queue.constants.ts` 상수만 사용 (하드코딩 금지)
- LLM API 호출 큐(`ai-analyze`)는 concurrency 5 이하 (비용 제어)

### 5-4. 외부 API 연동 표준

| API | 인증 방식 | 실패 처리 |
|-----|----------|---------|
| DART OpenAPI | API Key (환경변수) | 지수 백오프 재시도 3회 + CollectionLog FAILED 기록 |
| KRX 데이터마켓플레이스 | API Key | 수집 실패 시 신호 생성 보류, 오래된 시세(2거래일 이상) 기반 신호 금지 |
| 증권사 KIS OpenAPI | OAuth 2.0 토큰 | 오류 시 Kill Switch 트리거 + TradingAuditLog 기록 |
| 외부 LLM (OpenAI/Claude) | API Key | timeout 60초, retry 3회, 실패 시 `AIUsageLog.success: false` |

### 5-5. 마일스톤 진입 게이트 (BE 자체 검증)

| 마일스톤 | 진입 허가 조건 |
|----------|-------------|
| M1 진입 | CollectionLog 수집 성공률 ≥ 95%, 중복 저장 0 |
| M3 진입 | 5종 공시 표본 100건 파싱 성공률 ≥ 90%, `isAmendment` 정확 판정 |
| M6 진입 | AI 분석 JSON 파싱 실패율 < 5%, 공시 1건당 AI 비용 < $0.005 |
| M11 진입 | M10 MVP 졸업 게이트 전부 충족 (30일+ 모의운용 수치 기준) |
| M12 진입 | M11 소액 실주문 멱등·정확 체결, 모든 주문 audit 기록, Risk veto 동작 확인 |
