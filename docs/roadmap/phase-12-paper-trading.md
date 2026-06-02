> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 12 — 모의투자 (Paper Trading)

> 최종 수정일: 2026-06-02 · 상태: 설계 완료 (미구현)

---

## 1. 목적 & 범위

### 목적

백테스트(Phase 10)가 "과거 데이터로 전략을 검증"한다면, 모의투자는 **실시간 환경에서 시스템 전체를 통합 검증**한다.
실공시 → 실AI분석 → 실현재가 기반 가상 주문 → 가상 체결 → 가상 포트폴리오 손익 추적까지 전체 파이프라인을 실전과 동일하게 돌리되, 실제 돈은 쓰지 않는다.

모의투자의 목표는 "수익을 내는 것"이 아니라, **반자동·자동매매(Phase 13/14)에 투입하기 전에 시스템의 약점을 발견하는 것**이다.

> 모의투자 손실은 실패가 아니다. 실전 투입 전 약점을 발굴하는 것이 목적이다.

### 검증 대상 (7대 파이프라인 + 2대 안전장치)

| # | 검증 항목 | 기대 기준 |
|---|-----------|-----------|
| 1 | 공시 수집 지연 | DART 공시 발생 → 수집 완료까지 ≤ 15분 |
| 2 | 파싱 실패율 | DisclosureDocument 파싱 성공률 ≥ 90% |
| 3 | AI 분석 비용 | AI Cost/Signal ≤ 목표 단가 (Phase 11 L2/L3 게이트 준수 여부) |
| 4 | 시그널 속도 | 공시 수집 완료 → TradingSignal 생성까지 ≤ 5분 |
| 5 | 현재가 API 지연 | 체결 시뮬레이션용 가격 취득 지연 ≤ 1분 |
| 6 | 체결 가능성 | 슬리피지·부분체결 시뮬레이션 정확도 |
| 7 | 손절·익절 작동 | PositionThesis의 stopLoss/takeProfit Rule이 제때 트리거 |
| 8 | 매도 정확도 | ExitSignal 발생 → 가상 청산 처리 정확성 |
| 9 | 리스크 관리 | 비중 한도·포트폴리오 손실 한도 초과 시 신규 주문 차단 |

### 포함 범위

- `PaperTrade` Prisma 모델 (가상 주문·체결 단위)
- `PaperPortfolio` / `PaperPosition` 모델 (가상 포트폴리오)
- `PaperFillSimulator` 서비스 (슬리피지·부분체결·유동성 시뮬레이션)
- `PaperTradeMetrics` 대시보드 (성과·검증 지표)
- 백테스트(Phase 10)와의 결과 비교 뷰
- 모의투자 전용 포트폴리오(isPaper=true)와 실전 포트폴리오 완전 분리

### 제외 범위

- 실제 증권사 API 주문 (Phase 13)
- 자동 주문 실행 (Phase 14)
- 신규 AI Task 추가 (기존 Phase 4 AI Task 재사용)
- 과거 데이터 재시뮬레이션 (Phase 10 백테스트 담당)

---

## 2. 현재 코드베이스 연결점

| 항목 | 현재 상태 | Phase 12 연결 |
|------|-----------|---------------|
| `Disclosure` (rcpNo PK) | `backend/prisma/schema.prisma` | `PaperTrade.triggerRcpNo` FK |
| `Company` (corpCode PK) | 동일 파일 | `PaperPosition.corpCode` FK |
| `User` | 동일 파일 | `PaperPortfolio.userId` FK |
| `Portfolio` (isPaper=true, Phase 7) | 미구현 | 모의 포트폴리오 컨테이너로 재사용 |
| `Position` / `PositionThesis` (Phase 7) | 미구현 | 모의 포지션의 Thesis 연결 |
| `TradingSignal` (Phase 6) | 미구현 | 가상 주문 트리거 |
| `ExitSignal` (Phase 8) | 미구현 | 가상 청산 트리거 |
| `BacktestRun` / `BacktestTrade` (Phase 10) | 미구현 | 백테스트 결과와 비교 |
| `AIUsageLog` (Phase 11) | 미구현 | 모의투자 AI 비용 기록 |
| 공시 수집 스케줄러 | `backend/src/scheduler/` | 실시간 공시 → 시그널 파이프라인 기반 |
| `StockDailyPrice` / 현재가 API (Phase 5) | 미구현 | 체결가·평가가격 기준 |

---

## 3. 선행 조건 & 의존성

| Phase | 이유 |
|-------|------|
| Phase 1 — DART 수집 안정화 | 실시간 공시 수집이 안정적이어야 모의투자 트리거 가능 |
| Phase 3 — 이벤트 수치 추출 | `DisclosureEvent` 수치 없이 Buy Score 계산 불가 |
| Phase 4 — AI Analyst Engine | AI 분석 결과(polarity, Thesis) 없이 신호 품질 검증 불가 |
| Phase 5 — 시세·차트 데이터 | 현재가 없이 체결 시뮬레이션·손익 계산 불가 |
| Phase 6 — 매수 Signal Engine | `TradingSignal`이 가상 주문의 진입점 |
| Phase 7 — Position Thesis | `PositionThesis` 없이 손절·익절·논리훼손 Rule 작동 불가 |
| Phase 8 — Portfolio Exit Engine | `ExitSignal` 없이 가상 매도 트리거 불가 |
| Phase 10 — 백테스트 엔진 | 백테스트 결과와 비교하려면 `BacktestRun` 레코드 필요 |
| Phase 11 — AI 비용 통제 | `AIUsageLog` 없이 AI 비용 추적 불가 |

---

## 4. 상세 설계

### 4-1. Prisma 모델 스케치

```prisma
// =========================================
// 모의투자 포트폴리오 (Paper Portfolio)
// Phase 7 Portfolio.isPaper=true 와 1:1 연결
// =========================================
model PaperPortfolio {
  id             String   @id @default(cuid())
  portfolioId    String   @unique  // FK → Portfolio.id (isPaper=true)
  userId         String
  name           String   @default("모의투자 포트폴리오")
  seedCapital    Float    // 초기 가상 자본 (원, 예: 10_000_000)
  cashBalance    Float    // 현재 가상 현금 잔고
  startedAt      DateTime @default(now())
  endedAt        DateTime?           // null = 진행 중
  isActive       Boolean  @default(true)

  // 리스크 한도 (하드 룰 — AI 변경 불가)
  maxPositionPct Float    @default(10.0)  // 단일 종목 최대 비중(%)
  maxDrawdownPct Float    @default(15.0)  // 최대 낙폭 한도(%) 초과 시 신규 주문 차단

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  positions PaperPosition[]
  trades    PaperTrade[]

  @@index([userId, isActive])
  @@map("paper_portfolios")
}

// =========================================
// 모의 포지션 (Paper Position)
// =========================================
model PaperPosition {
  id               String            @id @default(cuid())
  paperPortfolioId String
  corpCode         String            // FK → Company.corpCode
  stockCode        String            // 6자리 종목코드
  corpName         String            // 비정규화 (조회 성능)
  status           PaperPositionStatus @default(OPEN)

  // 진입 정보
  openedAt         DateTime
  avgEntryPrice    Float             // 평균 매수단가 (원)
  totalShares      Int               // 총 보유 수량
  totalCost        Float             // 총 매수 원가 (수수료 포함)

  // 청산 정보
  closedAt         DateTime?
  avgExitPrice     Float?
  realizedPnl      Float?            // 실현 손익 (원)
  realizedPnlPct   Float?            // 실현 손익률 (%)

  // Thesis 연결 (Phase 7 — 모의투자에서도 PositionThesis 사용)
  thesisId         String?           // FK → PositionThesis.id

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  paperPortfolio   PaperPortfolio @relation(fields: [paperPortfolioId], references: [id])
  company          Company        @relation(fields: [corpCode], references: [corpCode])
  trades           PaperTrade[]
  snapshots        PaperPositionSnapshot[]

  @@index([paperPortfolioId, status])
  @@index([corpCode])
  @@map("paper_positions")
}

enum PaperPositionStatus {
  OPEN
  PARTIAL   // 일부 청산
  CLOSED
}

// =========================================
// 모의 주문·체결 단위 — 핵심 모델
// =========================================
model PaperTrade {
  id               String          @id @default(cuid())
  paperPortfolioId String
  paperPositionId  String?         // 체결 후 포지션에 연결

  // 트리거 (어떤 신호로 생성됐는가)
  triggerRcpNo     String          // FK → Disclosure.rcpNo
  signalId         String?         // FK → TradingSignal.id
  exitSignalId     String?         // FK → ExitSignal.id (매도 주문 시)

  // 주문 정보
  side             PaperTradeSide  // BUY | SELL
  orderType        PaperOrderType  // MARKET | LIMIT
  requestedPrice   Float           // 주문 요청 가격 (원)
  requestedShares  Int             // 주문 수량
  requestedAt      DateTime        @default(now())

  // 체결 시뮬레이션 결과
  fillStatus       PaperFillStatus @default(PENDING)
  filledShares     Int?            // 실제 체결 수량 (부분체결 반영)
  fillPrice        Float?          // 실제 체결가 (슬리피지 반영)
  slippagePct      Float?          // 슬리피지 (%)
  liquidityScore   Float?          // 유동성 점수 (0~1, 체결 가능성)
  filledAt         DateTime?

  // 체결 후 비용
  commissionKrw    Float?          // 수수료 (원, 매수 0.015% / 매도 0.015% + 증권거래세 0.20%)
  netAmount        Float?          // 순 지불/수령 금액

  // 미체결·거부 사유
  rejectReason     String?         // 예: "비중 한도 초과", "유동성 부족", "거래정지"

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  paperPortfolio   PaperPortfolio  @relation(fields: [paperPortfolioId], references: [id])
  paperPosition    PaperPosition?  @relation(fields: [paperPositionId], references: [id])
  disclosure       Disclosure      @relation(fields: [triggerRcpNo], references: [rcpNo])

  @@index([paperPortfolioId, fillStatus])
  @@index([triggerRcpNo])
  @@index([signalId])
  @@index([requestedAt])
  @@map("paper_trades")
}

enum PaperTradeSide {
  BUY
  SELL
}

enum PaperOrderType {
  MARKET  // 시장가 (다음 거래일 시가 기준)
  LIMIT   // 지정가 (요청가 이하 시 체결)
}

enum PaperFillStatus {
  PENDING       // 주문 접수, 체결 대기
  FILLED        // 전량 체결
  PARTIAL       // 부분 체결
  REJECTED      // 체결 거부 (유동성 부족, 거래정지, 리스크 한도 초과)
  CANCELLED     // 주문 취소
}

// =========================================
// 모의 포지션 일별 스냅샷
// =========================================
model PaperPositionSnapshot {
  id               String   @id @default(cuid())
  paperPositionId  String
  snapshotDate     DateTime // 기준일 (00:00 KST)
  closePrice       Float
  quantity         Int
  marketValue      Float    // closePrice × quantity
  unrealizedPnl    Float
  unrealizedPnlPct Float
  highFromEntry    Float?   // 진입 이후 최고가 (트레일링 스탑 기준)

  paperPosition PaperPosition @relation(fields: [paperPositionId], references: [id], onDelete: Cascade)

  @@unique([paperPositionId, snapshotDate])
  @@index([paperPositionId, snapshotDate])
  @@map("paper_position_snapshots")
}

// =========================================
// 모의투자 검증 지표 일별 집계
// =========================================
model PaperTradeMetricsDaily {
  id               String   @id @default(cuid())
  paperPortfolioId String
  date             DateTime // 기준일

  // 성과 지표
  totalValue       Float    // 현금 + 평가 포지션 합계
  dailyReturnPct   Float    // 당일 수익률(%)
  cumulativeReturnPct Float // 누적 수익률(%)
  drawdownPct      Float    // 현재 낙폭(%) from peak
  cashBalance      Float

  // 파이프라인 검증 지표
  disclosureCollectedCount Int    // 당일 수집 공시 수
  signalGeneratedCount     Int    // 생성된 TradingSignal 수
  paperOrderCount          Int    // 발행된 가상 주문 수
  fillRate                 Float  // 체결률(%) = FILLED / (FILLED+REJECTED+PARTIAL)
  avgSlippagePct           Float  // 평균 슬리피지(%)
  aiCallCount              Int    // AI 호출 수
  aiCostUsd                Float  // AI 비용(USD)
  avgSignalLatencyMin      Float  // 공시 수집 → 시그널 생성 평균 지연(분)
  parseFailureCount        Int    // 파싱 실패 건수

  createdAt DateTime @default(now())

  @@unique([paperPortfolioId, date])
  @@index([paperPortfolioId, date])
  @@map("paper_trade_metrics_daily")
}
```

### 4-2. NestJS 모듈 구조

```
backend/src/
  paper-trading/
    paper-trading.module.ts
    paper-portfolio.service.ts       // 모의 포트폴리오 CRUD, 현금 잔고 관리
    paper-position.service.ts        // 모의 포지션 생성·조회·청산
    paper-trade.service.ts           // 가상 주문 접수 → 체결 시뮬레이션 → 포지션 반영
    paper-fill-simulator.service.ts  // 슬리피지·부분체결·유동성·거래정지 시뮬레이션
    paper-metrics.service.ts         // 일별 지표 집계, 백테스트 비교
    paper-trading.controller.ts      // REST API
    paper-trading.scheduler.ts       // 장마감 후 스냅샷·지표 집계 스케줄러
    dto/
      create-paper-order.dto.ts
      paper-fill-result.dto.ts
      paper-dashboard.dto.ts
    interfaces/
      fill-simulation.interface.ts
      paper-metrics.interface.ts
```

### 4-3. API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/paper-trading/portfolios` | 모의 포트폴리오 생성 (seedCapital, maxPositionPct 등) |
| `GET`  | `/paper-trading/portfolios/:id` | 모의 포트폴리오 상세 (포지션 + 현금 잔고) |
| `GET`  | `/paper-trading/portfolios/:id/dashboard` | 성과 + 검증 지표 대시보드 |
| `POST` | `/paper-trading/portfolios/:id/orders` | 가상 주문 제출 (side, requestedPrice, shares) |
| `GET`  | `/paper-trading/portfolios/:id/orders` | 가상 주문 목록 (fillStatus 필터) |
| `GET`  | `/paper-trading/portfolios/:id/positions` | 모의 포지션 목록 |
| `GET`  | `/paper-trading/positions/:id` | 모의 포지션 상세 + Thesis + 스냅샷 |
| `GET`  | `/paper-trading/portfolios/:id/metrics` | 일별 지표 시계열 |
| `GET`  | `/paper-trading/portfolios/:id/compare-backtest` | 백테스트 vs 모의투자 결과 비교 |
| `POST` | `/paper-trading/portfolios/:id/close` | 모의투자 종료 (전량 청산 + 최종 성과 저장) |

### 4-4. 체결 시뮬레이션 의사코드

```
function simulateFill(order: PaperTrade, marketData: StockMarketData): PaperFillResult

  // ── 1단계: 거래 가능 여부 체크 (비용 0) ──
  if marketData.isSuspended or marketData.isManagementIssue:
    return { fillStatus: REJECTED, rejectReason: "거래정지 또는 관리종목" }

  if order.side == BUY:
    // 비중 한도 하드 체크 (AI 금지 영역 — Rule Engine만)
    currentWeight = calcPositionWeight(portfolioId, corpCode)
    newWeight     = (order.requestedShares * order.requestedPrice) / portfolioTotalValue * 100
    if currentWeight + newWeight > portfolio.maxPositionPct:
      return { fillStatus: REJECTED, rejectReason: "단일 종목 비중 한도 초과" }

    // 낙폭 한도 체크 (AI 금지)
    if portfolio.currentDrawdown >= portfolio.maxDrawdownPct:
      return { fillStatus: REJECTED, rejectReason: "포트폴리오 낙폭 한도 초과 — 신규 매수 차단" }

    // 현금 잔고 체크
    requiredCash = order.requestedShares * order.requestedPrice * 1.00015  // 수수료 포함
    if portfolio.cashBalance < requiredCash:
      // 부분 체결: 가용 현금으로 매수 가능한 최대 수량
      affordableShares = floor(portfolio.cashBalance / (order.requestedPrice * 1.00015))
      if affordableShares == 0:
        return { fillStatus: REJECTED, rejectReason: "현금 잔고 부족" }
      order.requestedShares = affordableShares  // 부분 체결로 전환

  // ── 2단계: 슬리피지 계산 ──
  // 거래대금 기반 유동성 점수 (0~1)
  liquidityScore = min(1.0, marketData.tradingValueKrw / 1_000_000_000)  // 10억 이상 = 1.0

  // 슬리피지 비율: 유동성 낮을수록 증가
  // 공식: slippage = BASE_SLIPPAGE + (1 - liquidityScore) * MAX_EXTRA_SLIPPAGE
  BASE_SLIPPAGE     = 0.05   // % (장 시작 후 첫 주문 기준)
  MAX_EXTRA_SLIPPAGE = 0.50  // % (유동성 최저 종목)
  slippagePct = BASE_SLIPPAGE + (1.0 - liquidityScore) * MAX_EXTRA_SLIPPAGE

  if order.side == BUY:
    fillPrice = order.requestedPrice * (1 + slippagePct / 100)
    // 단, 상한가 초과 불가
    fillPrice = min(fillPrice, marketData.upperLimitPrice)
  else:  // SELL
    fillPrice = order.requestedPrice * (1 - slippagePct / 100)
    fillPrice = max(fillPrice, marketData.lowerLimitPrice)

  // ── 3단계: 부분 체결 시뮬레이션 ──
  // 주문 수량이 당일 거래량의 N% 초과 시 부분 체결
  VOLUME_THRESHOLD_PCT = 5.0  // 당일 거래량의 5% 초과 주문은 부분 체결
  maxFillable = floor(marketData.dailyVolume * VOLUME_THRESHOLD_PCT / 100)
  filledShares = min(order.requestedShares, maxFillable)

  if filledShares == 0:
    return { fillStatus: REJECTED, rejectReason: "유동성 부족 — 체결 불가" }

  fillStatus = if filledShares < order.requestedShares then PARTIAL else FILLED

  // ── 4단계: 수수료·세금 계산 ──
  if order.side == BUY:
    commission = filledShares * fillPrice * 0.00015  // 매수 수수료 0.015%
    netAmount  = -(filledShares * fillPrice + commission)  // 음수: 현금 감소
  else:
    commission    = filledShares * fillPrice * 0.00015   // 매도 수수료 0.015%
    securityTax   = filledShares * fillPrice * 0.0020    // 증권거래세 0.20%
    netAmount     = filledShares * fillPrice - commission - securityTax  // 양수: 현금 증가

  return {
    fillStatus, filledShares, fillPrice,
    slippagePct, liquidityScore,
    commissionKrw: commission,
    netAmount
  }
```

### 4-5. 가상 주문 처리 흐름 의사코드

```
// PaperTradeService.processSignal(signal: TradingSignal)
// TradingSignal 발생 시 자동으로 가상 주문 생성·체결 처리

function processSignal(signal: TradingSignal):

  // 1. 활성 모의 포트폴리오 조회
  portfolio = findActivePaperPortfolio(signal.userId)
  if not portfolio: return

  // 2. 가상 주문 레코드 생성 (PENDING)
  order = createPaperTrade({
    paperPortfolioId: portfolio.id,
    triggerRcpNo:     signal.rcpNo,
    signalId:         signal.id,
    side:             BUY,
    orderType:        MARKET,
    requestedPrice:   fetchCurrentPrice(signal.stockCode),  // 시세 API
    requestedShares:  calcOrderShares(portfolio, signal),   // 비중 기반 수량 (Rule Engine)
    requestedAt:      now()
  })

  // 3. 체결 시뮬레이션 (다음 거래일 시가 기준 또는 현재가)
  marketData = fetchMarketData(signal.stockCode)
  fillResult = simulateFill(order, marketData)

  // 4. 체결 결과 반영
  updatePaperTrade(order.id, fillResult)

  if fillResult.fillStatus in [FILLED, PARTIAL]:
    position = upsertPaperPosition(portfolio.id, signal, fillResult)
    deductCash(portfolio.id, abs(fillResult.netAmount))

    // 5. PositionThesis 생성 (Phase 7 재사용)
    thesis = positionThesisService.createFromSignal(position.id, signal.id, disclosureContext)

  // 6. AIUsageLog 기록
  logAIUsage(signal.aiCostUsd, "PAPER_SIGNAL")


// PaperTradeService.processExitSignal(exitSignal: ExitSignal)
function processExitSignal(exitSignal: ExitSignal):

  position = findOpenPaperPosition(exitSignal.positionId)
  if not position: return

  order = createPaperTrade({
    paperPortfolioId: position.paperPortfolioId,
    paperPositionId:  position.id,
    triggerRcpNo:     exitSignal.triggerRcpNo,
    exitSignalId:     exitSignal.id,
    side:             SELL,
    orderType:        MARKET,
    requestedPrice:   fetchCurrentPrice(position.stockCode),
    requestedShares:  position.totalShares,  // 전량 매도 (분할은 exitSignal.action 기반)
  })

  fillResult = simulateFill(order, fetchMarketData(position.stockCode))
  updatePaperTrade(order.id, fillResult)

  if fillResult.fillStatus in [FILLED, PARTIAL]:
    realizedPnl = fillResult.netAmount - position.totalCost
    closePaperPosition(position.id, fillResult, realizedPnl)
    addCash(position.paperPortfolioId, fillResult.netAmount)
```

### 4-6. 비중 기반 주문 수량 계산 의사코드

```
// Rule Engine — AI 금지 영역 (주문 수량 결정)
function calcOrderShares(portfolio: PaperPortfolio, signal: TradingSignal): Int

  // 신호 강도에 따른 비중 배분 (AI 금지: 수량 결정은 Rule Engine만)
  signalWeight = switch signal.signal:
    "BUY_CANDIDATE" (buyScore ≥ 80)  → portfolio.maxPositionPct * 0.8  // 예: 8%
    "BUY_CANDIDATE" (buyScore 60~79) → portfolio.maxPositionPct * 0.5  // 예: 5%
    default                           → 0  // 주문 생성 안 함

  targetValue   = portfolio.totalValue * signalWeight / 100
  currentPrice  = fetchCurrentPrice(signal.stockCode)
  shares        = floor(targetValue / currentPrice)

  // 현금 잔고 초과 방지
  maxAffordable = floor(portfolio.cashBalance * 0.95 / currentPrice)  // 5% 버퍼
  return min(shares, maxAffordable)
```

### 4-7. 손절·익절 트리거 의사코드

```
// PaperTradingScheduler — 장중·장마감 후 실행
function checkStopConditions(portfolioId: String):

  openPositions = findOpenPaperPositions(portfolioId)

  for position in openPositions:
    thesis = fetchPositionThesis(position.thesisId)
    if not thesis: continue

    currentPrice = fetchCurrentPrice(position.stockCode)
    entryPrice   = position.avgEntryPrice
    pnlPct       = (currentPrice - entryPrice) / entryPrice * 100
    highFromEntry = fetchHighFromEntry(position.id)  // PaperPositionSnapshot 기준

    // 1. 하드 손절 (AI 금지: Rule Engine만)
    if pnlPct <= thesis.stopLossHardPct:
      triggerExitSignal(position.id, reason="HARD_STOP", price=currentPrice)
      continue

    // 2. 트레일링 스탑 (AI 금지)
    trailingStop = highFromEntry * (1 + thesis.trailingStopFromHighPct / 100)
    if currentPrice <= trailingStop:
      triggerExitSignal(position.id, reason="TRAILING_STOP", price=currentPrice)
      continue

    // 3. 분할 익절 (AI 금지)
    if pnlPct >= thesis.takeProfitPartialPct:
      triggerPartialExit(position.id, sellRatio=0.5, reason="PARTIAL_TAKE_PROFIT")
      continue

    // 4. Thesis 훼손 판정 (Phase 7 evaluateViolation 재사용)
    violationResult = positionThesisService.evaluateViolation(thesis.id, { currentPrice })
    if violationResult.status == "VIOLATED":
      triggerExitSignal(position.id, reason="THESIS_VIOLATED")
```

### 4-8. 대시보드 성과 지표 집계

모의투자 성과를 백테스트 결과와 비교하는 핵심 지표:

| 지표 | 설명 | 계산 |
|------|------|------|
| 누적 수익률 | 모의투자 전체 기간 | (최종자산 - seedCapital) / seedCapital × 100 |
| 일별 수익률 시계열 | `PaperTradeMetricsDaily.dailyReturnPct` | 포트폴리오 시가총액 일별 변화 |
| MDD | 최대 낙폭 | max(drawdownPct) across 기간 |
| 승률 | 수익 포지션 비율 | CLOSED 중 realizedPnl > 0 비율 |
| 평균 수익·손실 | 수익 포지션 / 손실 포지션 평균 PnL | groupBy 계산 |
| 손익비 | 평균수익 / 평균손실 | |
| 총 거래 횟수 | FILLED + PARTIAL 주문 합계 | |
| 체결률 | 주문 대비 체결 비율 | FILLED+PARTIAL / 전체 주문 |
| 평균 슬리피지 | `PaperTradeMetricsDaily.avgSlippagePct` 평균 | |
| AI 비용/신호 | AI 총 비용 / 생성된 신호 수 | |
| 공시→시그널 지연 | 수집 완료 → TradingSignal 생성 | `avgSignalLatencyMin` 평균 |
| 파싱 실패율 | `parseFailureCount` / `disclosureCollectedCount` | 목표 ≤ 10% |

**백테스트 비교 뷰 (`/compare-backtest`):**

```json
{
  "backtest": {
    "runId": "bt_xxx",
    "period": "2024-01-01~2025-12-31",
    "cumulativeReturnPct": 18.4,
    "mdd": -9.2,
    "winRate": 58.3,
    "sharpe": 1.21
  },
  "paperTrading": {
    "portfolioId": "pp_xxx",
    "period": "2026-01-01~2026-06-01",
    "cumulativeReturnPct": 12.1,
    "mdd": -7.8,
    "winRate": 54.0,
    "sharpe": 0.97,
    "avgSlippagePct": 0.18,
    "fillRate": 91.2,
    "avgSignalLatencyMin": 3.4,
    "parseFailureRate": 4.2,
    "aiCostPerSignalUsd": 0.032
  },
  "gap": {
    "returnGapPct": -6.3,
    "comment": "슬리피지·수수료 반영 후 실전 성과 백테스트 대비 약 6.3%p 하락. 허용 범위 내."
  }
}
```

### 4-9. 백테스트와 모의투자의 차이

| 항목 | 백테스트 (Phase 10) | 모의투자 (Phase 12) |
|------|--------------------|--------------------|
| 데이터 | 과거 OHLCV, 과거 공시 | 실시간 공시, 실시간 현재가 |
| AI 분석 | 생략 또는 사전 캐시 | 실제 AI 호출 (비용 발생) |
| 체결 시뮬레이션 | 고정 슬리피지 가정 | 실시간 거래량 기반 동적 시뮬레이션 |
| 실행 흐름 | 과거 데이터 replay | 실시간 파이프라인 전체 동작 |
| 검증 목적 | 전략 통계적 유효성 | 시스템 통합·운영 안정성·AI 비용 |
| 파싱 실패 | 없음 (전처리 완료) | 실제 실패 발생 (측정 대상) |
| API 지연 | 없음 | 측정 대상 (수집 지연, 현재가 지연) |

---

## 5. 작업 분해

### DB / 마이그레이션

- [ ] `PaperPortfolio` 모델 마이그레이션 작성
- [ ] `PaperPosition` 모델, `PaperPositionStatus` enum 마이그레이션
- [ ] `PaperTrade` 모델, `PaperTradeSide` / `PaperOrderType` / `PaperFillStatus` enum 마이그레이션
- [ ] `PaperPositionSnapshot` 모델 마이그레이션
- [ ] `PaperTradeMetricsDaily` 모델 마이그레이션
- [ ] `npx prisma migrate dev --name phase12-paper-trading` 실행·검증
- [ ] 기존 `Disclosure.rcpNo` → `PaperTrade.triggerRcpNo` FK 정합성 검증
- [ ] `Company.corpCode` → `PaperPosition.corpCode` FK 정합성 검증

### 백엔드 모듈

- [ ] `PaperTradingModule` 생성
- [ ] `PaperPortfolioService` — CRUD, 현금 잔고 증감, 낙폭 계산
- [ ] `PaperPositionService` — 포지션 생성·조회·청산, 평균 단가 계산
- [ ] `PaperFillSimulatorService` — 슬리피지·부분체결·유동성·거래정지 시뮬레이션
- [ ] `PaperTradeService` — `processSignal()`, `processExitSignal()`, 주문 상태 관리
- [ ] `calcOrderShares()` — 비중 기반 수량 Rule Engine (AI 금지 명시)
- [ ] `checkStopConditions()` — 손절·익절·Thesis훼손 트리거
- [ ] `PaperMetricsService` — 일별 지표 집계, 백테스트 비교 뷰 생성
- [ ] `PaperTradingScheduler` — 장마감 후(15:40 KST) 스냅샷 + 지표 집계 cron
- [ ] `PaperTradingController` — REST API + Swagger 문서화
- [ ] `TradingSignal` 이벤트 리스너 → `processSignal()` 자동 연동
- [ ] `ExitSignal` 이벤트 리스너 → `processExitSignal()` 자동 연동
- [ ] 포트폴리오 낙폭 한도 초과 시 신규 주문 차단 로직 (하드 룰, AI 금지)
- [ ] `AIUsageLog` 기록 연동 (Phase 11)

### 모바일 대시보드 (Expo)

- [ ] 모의투자 포트폴리오 생성 화면 (seedCapital, 리스크 설정)
- [ ] 모의 포트폴리오 현황 화면 (현금 잔고, 포지션 목록, 누적 수익률)
- [ ] 모의 주문 히스토리 화면 (fillStatus 필터, 슬리피지 표시)
- [ ] 검증 지표 대시보드 화면 (수집 지연, 파싱 실패율, AI 비용, 체결률)
- [ ] 백테스트 vs 모의투자 비교 화면

### 안전 장치 (AI 금지 영역 명시)

- [ ] `calcOrderShares()` 함수에 "AI 변경 불가 — Rule Engine 전용" 주석 및 lint 가드 추가
- [ ] 손절·익절 가격 트리거 로직: AI 호출 코드와 완전히 분리된 별도 서비스에 구현
- [ ] `PaperPortfolio.maxPositionPct` / `maxDrawdownPct` 초과 시 주문 REJECTED — 서비스 레이어 예외
- [ ] `PaperTrade.rejectReason` 에 항상 거부 사유 기록 (감사 추적)
- [ ] 최종 주문 승인 로직이 이 Phase에 포함되지 않도록 코드 리뷰 게이트 명시

### 테스트

- [ ] `simulateFill()` 유닛 테스트 — 거래정지·비중초과·현금부족·부분체결·슬리피지 케이스
- [ ] `processSignal()` 통합 테스트 (시세 API mock, TradingSignal mock)
- [ ] `processExitSignal()` 통합 테스트 (ExitSignal mock)
- [ ] `checkStopConditions()` — 하드손절·트레일링스탑·분할익절 각 케이스
- [ ] `PaperMetricsService` 집계 정확성 테스트
- [ ] 백테스트 비교 뷰 데이터 정합성 테스트

### 문서

- [ ] `docs/database-schema.md` 신규 모델 5종 반영
- [ ] `docs/api-specification.md` 신규 엔드포인트 반영
- [ ] `PROJECT_STRUCTURE.md` `paper-trading/` 모듈 트리 갱신
- [ ] `NEXT_STEPS.md` Phase 12 완료 체크

---

## 6. AI 사용 정책

| 구분 | 적용 여부 | 상세 |
|------|-----------|------|
| **Phase 4 AI Task 재사용** | 그대로 사용 | 모의투자는 신규 AI Task를 추가하지 않는다. Disclosure Summary, Event Classification, Persona Interpretation, Position Thesis AI — 4개 Task를 실전과 동일하게 호출 |
| **L2 — Thesis 생성** | 필수 | `BUY_CANDIDATE` 신호에 한해 호출. 입력: DisclosureEvent 수치 + Persona + 차트 상태. 출력: `initialThesis[]` + `invalidConditions[]` |
| **L3 — Thesis 훼손 판정 보조** | 조건부 | Rule 1차 체크에서 위반 1개 이상 감지 시만 호출 |
| **AI 금지** | 절대 | 주문 수량 결정 / 손절·익절 가격 결정 / 비중 한도 결정 / 낙폭 한도 결정 / 체결 거부 판단 |

**비용 통제:**
- 모의투자 중 AI 총 비용이 `AIUsageLog`에 실시간 누적
- `PaperTradeMetricsDaily.aiCostUsd` 로 일별 추적
- AI Cost/Signal이 목표 단가(L2 기준 $0.05/건) 초과 시 경고 알림

---

## 7. 비용·성능 고려사항

| 항목 | 예상 규모 | 대응 |
|------|-----------|------|
| 실시간 현재가 API 호출 | 주문 1건당 1~2회 (체결 시뮬레이션 + 손절 체크) | 장중 캐시 TTL 30초 (StockPriceCache) 적용 |
| `PaperPositionSnapshot` 누적 | 보유 포지션 수 × 운영 일수 | 모의투자 종료 후 90일 경과 시 아카이브 정책 적용 |
| `PaperTradeMetricsDaily` | 포트폴리오당 1행/일 | 장마감 후 15:40 KST 배치 집계, 실시간 조회 없음 |
| AI 비용 — 모의투자 구간 | 일 최대 10~20건 BUY_CANDIDATE × L2 비용 | Phase 11 L1 게이트 먼저 통과해야 L2 호출 |
| 슬리피지 시뮬레이션 | 단순 공식(비용 0), 실시간 거래량 API 1회 조회 | 체결 시뮬레이션은 DB 쓰기 포함 50ms 이내 목표 |
| 비교 뷰 쿼리 | BacktestRun join + PaperTradeMetricsDaily 집계 | materialized view 또는 집계 결과 캐시 (Redis, TTL 1h) |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 설명 | 대응 |
|--------|------|------|
| **현재가 API 지연·오류** | 시세 API timeout 시 체결가 미결정 | 마지막 유효 가격(최대 5분 이내) fallback. 5분 초과 시 주문 REJECTED 처리 + 경고 로그 |
| **공시 수집 지연** | DART API 지연으로 공시 수집이 늦어져 시그널 생성 지연 | `PaperTradeMetricsDaily.avgSignalLatencyMin` 모니터링, 15분 초과 시 Slack 경고 |
| **거래정지 중 주문 접수** | TradingSignal 생성 후 체결 전 거래정지 발생 | `simulateFill()` 1단계에서 `isSuspended` 체크 → REJECTED |
| **상·하한가 도달 시 체결가 왜곡** | 슬리피지 계산으로 상한가 초과 fillPrice 발생 | `min(fillPrice, upperLimitPrice)` / `max(fillPrice, lowerLimitPrice)` 하드 클램프 |
| **동일 종목 중복 신호** | 짧은 시간 내 같은 종목에 복수 BUY 신호 | `PaperPosition` OPEN 상태 존재 시 추가 매수 신호 무시 (비중 체크로 자동 거부) |
| **PositionThesis 생성 실패** | AI 호출 오류로 Thesis 미생성 | Thesis 없는 포지션은 기본 하드 손절(-7%)·보유 기간(20영업일) Rule만 적용 |
| **seedCapital 소진** | 연속 손실로 현금 0원 도달 | 현금 잔고 < 주문 요청 금액 → REJECTED. 포트폴리오 종료 권고 알림 |
| **백테스트 없는 상태에서 비교 요청** | BacktestRun 레코드 없을 때 비교 API 호출 | 비교 뷰 응답에 `backtest: null`, `gap: null` 반환 + "백테스트 미완료" 메시지 |
| **모의·실전 포트폴리오 혼용** | `isPaper=false` 포트폴리오에 가상 주문 생성 시도 | `PaperTradeService`는 `isPaper=true` 포트폴리오만 허용. 서비스 레이어 가드 |

---

## 9. 완료 기준 (DoD)

### 필수 (Phase 13 착수 전 충족)

- [ ] `PaperPortfolio`, `PaperPosition`, `PaperTrade`, `PaperPositionSnapshot`, `PaperTradeMetricsDaily` 5개 테이블 마이그레이션 완료
- [ ] `TradingSignal` 발생 시 `PaperTrade` 자동 생성 → `simulateFill()` 실행 → 포지션 반영 흐름이 E2E 동작
- [ ] `ExitSignal` 발생 시 가상 매도 주문 → 포지션 청산 → 실현 손익 계산 흐름 동작
- [ ] 하드 손절·트레일링 스탑·분할 익절 3종 Rule이 `checkStopConditions()`에서 정확히 트리거
- [ ] 비중 한도 초과·낙폭 한도 초과·현금 부족·거래정지 시 주문 REJECTED 처리 동작
- [ ] `PaperTradeMetricsDaily` 장마감 후 자동 집계 스케줄러 정상 동작 (15:40 KST cron)
- [ ] 모의투자 대시보드 API (`/dashboard`) 가 7대 검증 지표를 모두 포함하여 반환
- [ ] 백테스트 비교 뷰 API (`/compare-backtest`) 정상 응답 (BacktestRun 존재 시)
- [ ] 주문 수량 결정·손절가 결정 코드에 "AI 금지 — Rule Engine 전용" 주석 + 코드 리뷰 확인
- [ ] `AIUsageLog`에 모의투자 구간 AI 호출 비용 실시간 기록 확인
- [ ] Swagger `/api/docs` 에 신규 엔드포인트 전체 문서화

### 권장 (Phase 14 착수 전 충족)

- [ ] 모의투자 2주 이상 연속 운영 후 검증 지표 기록 — 공시 수집 지연 ≤ 15분, 파싱 실패율 ≤ 10%, 시그널 지연 ≤ 5분, 체결률 ≥ 85%
- [ ] 백테스트 대비 모의투자 수익률 gap 분석 완료 — 허용 범위(±10%p) 이내 여부 확인
- [ ] AI 비용/신호 목표 단가 준수 여부 검증 (L2 $0.05/건 기준)
- [ ] 모바일 대시보드 화면 구현 완료 (검증 지표 + 포트폴리오 현황)
- [ ] `docs/database-schema.md`, `PROJECT_STRUCTURE.md` 갱신 완료
