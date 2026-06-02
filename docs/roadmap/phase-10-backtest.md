> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 10 — 백테스트 엔진

> 최종 수정일: 2026-06-02 · 상태: 설계 완료(미구현)

---

## 1. 목적 & 범위

### 목적

Phase 6~9에서 설계된 Buy Score / Exit Score / PositionThesis / Event Study가 **과거 데이터 위에서 실제로 수익을 냈는가**를 엄밀히 검증한다. "백테스트를 통과하지 못한 전략은 모의투자(Phase 12)로 넘어가지 않는다"는 3대 원칙 3번을 집행하는 게이트 역할이다.

### 포함

- `BacktestRun`, `BacktestTrade` Prisma 모델 설계 및 마이그레이션
- 현실 제약 시뮬레이션 엔진 (공시시각, 장중/장후 구분, 다음거래일 시가 진입, 수수료·세금·슬리피지, 거래정지·상하한가·유동성·부분체결·관리종목)
- 성과지표 계산 파이프라인 (총수익, 연환산수익, 승률, 손익비, MDD, Sharpe, 월별·이벤트·Persona별 분류, 최악 10거래)
- lookahead bias 방지 설계 원칙 및 구현 체크리스트
- 보수적 실전 투입 기준 6개 판정 로직
- NestJS `BacktestModule` 서비스/엔드포인트 시그니처
- 모바일 백테스트 결과 조회 화면 (읽기 전용)

### 제외

- 실시간 주문 연동 (Phase 13~14 담당)
- AI를 이용한 자동 전략 최적화 (과적합 위험, Phase 10 범위 밖)
- 분봉 단위 진입 시뮬레이션 (일봉 + 시가 진입으로 제한)
- 포트폴리오 최적화 (Markowitz 등 별도 확장)

---

## 2. 현재 코드베이스 연결점

| 기존 자산 | 위치 | 활용 |
|-----------|------|------|
| `Disclosure` (rcpNo PK, rcpDt, corpCode) | `prisma/schema.prisma` | 공시 시각 기준 진입 시점 결정 |
| `Company` (corpCode PK, stockCode, market) | `prisma/schema.prisma` | 종목코드 → 시세 조회, 관리종목 필터 |
| `DisclosureEvent` (Phase 3) | 추가 예정 | 이벤트 타입·수치 → 매수 후보 필터 |
| `TradingSignal` (Phase 6) | 추가 예정 | Buy Score 기록 → 백테스트 진입 조건 |
| `PositionThesis` (Phase 7) | 추가 예정 | 손절·익절·논리 훼손 기준 |
| `ExitSignal` (Phase 8) | 추가 예정 | Exit Score 기반 매도 시점 재현 |
| `EventStudyResult` (Phase 9) | 추가 예정 | D+1~D+20 반응 기대치 vs 실제 비교 |
| `StockDailyPrice` (Phase 5) | 추가 예정 | 일봉 OHLCV, 시가 진입, 고/저가 체결 판정 |
| `DisclosureCollectionLog` (Phase 1) | 추가 예정 | 수집 지연 보정 |

---

## 3. 선행 조건 & 의존성

| 의존 Phase | 필수 여부 | 이유 |
|------------|-----------|------|
| Phase 3 (DisclosureEvent) | 필수 | 이벤트 타입·수치 없이는 전략 파라미터화 불가 |
| Phase 5 (StockDailyPrice, 종목 상태) | 필수 | 일봉 OHLCV, 상한가·거래정지·관리종목 플래그 |
| Phase 6 (TradingSignal, Buy Score) | 필수 | 진입 신호 재현 |
| Phase 7 (PositionThesis 구조) | 필수 | 손절·익절·기간 기준 정의 |
| Phase 8 (Exit Score 로직) | 필수 | 매도 시점 재현 |
| Phase 9 (EventStudyResult) | 권장 | 이벤트별 기대 성과 비교 |

**데이터 요구사항:** 최소 과거 3년치 일봉 데이터 + 동 기간 공시 이력. DART 공시는 `POST /scheduler/collect` 수동 백필로 확보 가능. 과거 시세는 **KRX 데이터마켓플레이스(공기업)** 일괄 수집을 1차 기준으로 한다(Phase 5와 동일 소스 → 백테스트와 실운용 데이터 정합).

---

## 4. 상세 설계

### 4-1. Prisma 모델 스케치

```prisma
// ====================================
// 백테스트 실행 단위
// ====================================

model BacktestRun {
  id              String   @id @default(cuid())
  name            String   // 실행 이름 (예: "SUPPLY_CONTRACT_GROWTH_2023")
  description     String?

  // 전략 파라미터 (JSON)
  strategyParams  Json
  // 예시:
  // {
  //   "eventTypes": ["SUPPLY_CONTRACT", "SHARE_BUYBACK"],
  //   "personas": ["GROWTH", "MOMENTUM"],
  //   "minBuyScore": 65,
  //   "entryRule": "NEXT_OPEN",        // "SAME_DAY_CLOSE" | "NEXT_OPEN"
  //   "exitRules": {
  //     "takeProfitPct": 12,
  //     "stopLossPct": -7,
  //     "trailingStopPct": -6,
  //     "maxHoldDays": 20
  //   },
  //   "sizeRule": "EQUAL_WEIGHT",      // "EQUAL_WEIGHT" | "SCORE_WEIGHT"
  //   "maxPositions": 5,
  //   "initialCapital": 10000000
  // }

  // 테스트 기간
  startDate       DateTime
  endDate         DateTime
  universe        String   // "WATCHLIST" | "KOSPI200" | "ALL_LISTED"

  // 비용 파라미터
  commissionRate  Decimal  @db.Decimal(6, 5)  // 예: 0.00015 (0.015%)
  taxRate         Decimal  @db.Decimal(6, 5)  // 예: 0.0018  (양도세 0.18%)
  slippagePct     Decimal  @db.Decimal(6, 5)  // 예: 0.003   (0.3% 슬리피지)

  // 실행 상태
  status          BacktestStatus @default(PENDING)
  startedAt       DateTime?
  completedAt     DateTime?
  errorMessage    String?

  // 성과 요약 (완료 후 저장)
  summary         Json?
  // 예시: {
  //   "totalReturn": 23.4,        // %
  //   "annualizedReturn": 18.2,   // %
  //   "winRate": 58.3,            // %
  //   "avgWin": 9.1,              // %
  //   "avgLoss": -5.2,            // %
  //   "profitFactor": 1.75,       // avgWin*winCount / |avgLoss*lossCount|
  //   "mdd": -12.4,               // %
  //   "sharpe": 1.34,
  //   "totalTrades": 48,
  //   "monthlyReturns": {"2023-01": 3.2, "2023-02": -1.1, ...},
  //   "byEventType": {"SUPPLY_CONTRACT": {...}, "SHARE_BUYBACK": {...}},
  //   "byPersona": {"GROWTH": {...}, "MOMENTUM": {...}},
  //   "worstTrades": [...],       // 손실 기준 상위 10개 BacktestTrade.id 배열
  //   "realWorldGate": {          // 보수적 실전 기준 6개 판정
  //     "allMarketConditions": true,
  //     "netPositiveAfterCost": true,
  //     "diversified": true,
  //     "sufficientSamples": true,
  //     "mddAcceptable": true,
  //     "recentPeriodConsistent": false
  //   },
  //   "passedGate": false         // 6개 모두 통과 시 true → 모의투자 허용
  // }

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  trades          BacktestTrade[]

  @@index([status])
  @@index([startDate, endDate])
  @@map("backtest_runs")
}

enum BacktestStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}

// ====================================
// 백테스트 개별 거래 기록
// ====================================

model BacktestTrade {
  id                String   @id @default(cuid())
  backtestRunId     String

  // 공시 연결 (lookahead bias 방지: rcpDt 기준 진입만 허용)
  disclosureRcpNo   String   // FK → Disclosure.rcpNo
  corpCode          String   // FK → Company.corpCode
  stockCode         String   // 종목코드 (캐시)

  eventType         String   // DisclosureEvent.eventType
  persona           String   // 적용 Persona

  // 진입
  disclosureAt      DateTime // 공시 실제 접수 시각 (rcpDt 파싱)
  isAfterMarket     Boolean  // 공시가 장마감(15:30) 후 여부
  entryDate         DateTime // 실제 진입 거래일 (장중=당일, 장후=다음거래일)
  entryPrice        Decimal  @db.Decimal(12, 2) // 시가 진입가
  entryShares       Int      // 진입 주수
  entryValue        Decimal  @db.Decimal(16, 2) // 진입 금액

  // 매도
  exitDate          DateTime?
  exitPrice         Decimal? @db.Decimal(12, 2)
  exitShares        Int?
  exitValue         Decimal? @db.Decimal(16, 2)
  exitReason        ExitReason?

  // 비용
  commission        Decimal  @db.Decimal(12, 2) @default(0)
  tax               Decimal  @db.Decimal(12, 2) @default(0)
  slippage          Decimal  @db.Decimal(12, 2) @default(0)

  // 성과
  grossPnl          Decimal? @db.Decimal(12, 2) // 수수료·세금 전 손익
  netPnl            Decimal? @db.Decimal(12, 2) // 수수료·세금·슬리피지 반영 손익
  returnPct         Decimal? @db.Decimal(8, 4)  // 수익률 (%)
  holdDays          Int?

  // 현실 제약 플래그 (사후 분석용)
  wasLimitUp        Boolean  @default(false) // 상한가로 체결 불가
  wasLimitDown      Boolean  @default(false) // 하한가
  wasTradingSuspended Boolean @default(false) // 거래정지
  wasAdminStock     Boolean  @default(false) // 관리종목
  isPartialFill     Boolean  @default(false) // 부분체결
  fillRate          Decimal? @db.Decimal(5, 4) // 체결률 (0~1)
  lowLiquidityFlag  Boolean  @default(false) // 유동성 부족 경고

  // Buy Score 스냅샷 (진입 시점 점수 보존)
  buyScoreSnapshot  Int?
  exitScoreSnapshot Int?

  createdAt         DateTime @default(now())

  // Relations
  backtestRun       BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@index([backtestRunId])
  @@index([corpCode])
  @@index([eventType])
  @@index([persona])
  @@index([entryDate])
  @@index([returnPct])
  @@map("backtest_trades")
}

enum ExitReason {
  TAKE_PROFIT
  STOP_LOSS
  TRAILING_STOP
  THESIS_BREAK
  MAX_HOLD_DAYS
  CHART_BREAK
  LIQUIDITY_EXIT
  FORCE_EXIT
}
```

---

### 4-2. NestJS 모듈 구조

```
backend/src/
└── backtest/
    ├── backtest.module.ts
    ├── backtest.controller.ts
    ├── backtest.service.ts          // Run 생성·조회·삭제
    ├── backtest-runner.service.ts   // 실행 엔진 (비동기 큐 처리)
    ├── constraint/
    │   ├── market-calendar.service.ts   // 거래일 계산, 장중/장후 판정
    │   ├── price-constraint.service.ts  // 상하한가, 거래정지, 관리종목, 유동성
    │   └── fill-simulator.service.ts    // 부분체결 시뮬레이션
    ├── metrics/
    │   ├── performance-calculator.service.ts  // 성과지표 계산
    │   └── gate-checker.service.ts            // 실전 투입 기준 6개 판정
    └── dto/
        ├── create-backtest-run.dto.ts
        └── backtest-result.dto.ts
```

---

### 4-3. API 엔드포인트 시그니처

```typescript
// backtest.controller.ts

@Controller('backtest')
@UseGuards(JwtAuthGuard)
export class BacktestController {

  // 백테스트 실행 요청
  @Post('runs')
  createRun(@Body() dto: CreateBacktestRunDto): Promise<{ id: string; status: string }>

  // 실행 목록 조회
  @Get('runs')
  listRuns(@Query() query: { page?: number; limit?: number }): Promise<BacktestRunSummary[]>

  // 실행 상세 + 성과 요약
  @Get('runs/:id')
  getRun(@Param('id') id: string): Promise<BacktestRunDetailDto>

  // 개별 거래 목록 (정렬: returnPct ASC → 최악 먼저)
  @Get('runs/:id/trades')
  getTrades(
    @Param('id') id: string,
    @Query() query: { page?: number; limit?: number; eventType?: string; persona?: string; sort?: 'returnPct_asc' | 'returnPct_desc' }
  ): Promise<BacktestTradeDto[]>

  // 실전 투입 기준 판정 결과
  @Get('runs/:id/gate')
  getGateResult(@Param('id') id: string): Promise<RealWorldGateDto>

  // 실행 취소
  @Delete('runs/:id')
  deleteRun(@Param('id') id: string): Promise<void>
}
```

---

### 4-4. 시뮬레이션 엔진 핵심 의사코드

```typescript
// backtest-runner.service.ts (의사코드)

async function runBacktest(run: BacktestRun): Promise<void> {
  const { strategyParams, startDate, endDate } = run;

  // 1. 대상 공시 이벤트 수집 (lookahead bias 방지: rcpDt <= 현재 시뮬레이션 날짜만)
  const disclosureEvents = await getDisclosureEvents({
    eventTypes: strategyParams.eventTypes,
    dateRange: [startDate, endDate],
  });

  const portfolio = new VirtualPortfolio(strategyParams.initialCapital);
  const trades: BacktestTrade[] = [];

  for (const event of disclosureEvents) {  // 시간순 정렬
    const disclosure = event.disclosure;

    // --- [lookahead bias 차단] ---
    // TradingSignal, EventStudyResult, StockDailyPrice 조회 시
    // 반드시 disclosure.rcpDt 이전 데이터만 사용
    const signalData = await getTradingSignalAsOf(disclosure.rcpNo, disclosure.rcpDt);
    if (!signalData || signalData.buyScore < strategyParams.minBuyScore) continue;

    // 2. 공시 시각 판정 → 진입 거래일 결정
    const disclosureAt = parseRcpDt(disclosure.rcpDt); // "YYYYMMDDHHmmss"
    const isAfterMarket = disclosureAt.hour >= 15 || disclosureAt.hour < 9;
    //   장중(09:00~15:29) → 당일 종가 진입 or 익일 시가 (전략 파라미터에 따름)
    //   장마감 후(15:30~익일 09:00) → 다음 거래일 시가 진입
    const entryDate = isAfterMarket
      ? marketCalendar.nextTradingDay(disclosureAt.date)
      : (strategyParams.entryRule === 'NEXT_OPEN'
          ? marketCalendar.nextTradingDay(disclosureAt.date)
          : disclosureAt.date);  // SAME_DAY_CLOSE

    // 3. 현실 제약 체크
    const priceData = await getDailyPrice(disclosure.corpCode, entryDate);
    if (!priceData) continue;  // 시세 없음

    const constraints = await checkConstraints(disclosure.corpCode, entryDate, priceData);
    if (constraints.tradingSuspended || constraints.adminStock) {
      // 거래정지·관리종목 → 진입 건너뜀
      trades.push(buildSkippedTrade(event, entryDate, 'TRADING_SUSPENDED'));
      continue;
    }

    // 상한가 체크: entryPrice가 가격제한폭 상단이면 체결 불가 처리
    const entryPrice = priceData.openPrice;
    if (constraints.limitUp) {
      trades.push(buildSkippedTrade(event, entryDate, 'LIMIT_UP'));
      continue;
    }

    // 슬리피지 적용 (시가 기준 상향 조정)
    const adjustedEntry = entryPrice * (1 + run.slippagePct);

    // 유동성 체크: 목표 주수가 일평균 거래대금의 1% 초과 시 부분체결
    const targetValue = portfolio.cash * (1 / strategyParams.maxPositions);
    const targetShares = Math.floor(targetValue / adjustedEntry);
    const { actualShares, fillRate } = simulateFill(
      targetShares, adjustedEntry, priceData.volume, priceData.tradingValue
    );
    if (actualShares === 0) continue;

    // 4. 진입 기록
    portfolio.openPosition(event.corpCode, actualShares, adjustedEntry);
    const trade = createTrade(event, entryDate, adjustedEntry, actualShares, fillRate, constraints);
    trades.push(trade);

    // 5. 매도 시뮬레이션 (진입 다음날부터 순회)
    for (const holdDate of marketCalendar.tradingDaysAfter(entryDate, strategyParams.exitRules.maxHoldDays)) {
      const holdPriceData = await getDailyPrice(disclosure.corpCode, holdDate);
      if (!holdPriceData) break;

      const currentReturn = (holdPriceData.closePrice - adjustedEntry) / adjustedEntry * 100;
      const peakReturn = Math.max(trade.peakReturn ?? 0, currentReturn);

      let exitReason: ExitReason | null = null;

      // 손절
      if (currentReturn <= strategyParams.exitRules.stopLossPct) exitReason = 'STOP_LOSS';
      // 익절
      else if (currentReturn >= strategyParams.exitRules.takeProfitPct) exitReason = 'TAKE_PROFIT';
      // 트레일링 스탑
      else if (peakReturn - currentReturn >= Math.abs(strategyParams.exitRules.trailingStopPct)) exitReason = 'TRAILING_STOP';
      // 논리 훼손 (PositionThesis invalidConditions 재현)
      else if (await checkThesisBreak(event, holdDate)) exitReason = 'THESIS_BREAK';
      // 최대 보유기간
      else if (holdDate === marketCalendar.tradingDaysAfter(entryDate, strategyParams.exitRules.maxHoldDays).at(-1)) exitReason = 'MAX_HOLD_DAYS';
      // 차트 훼손 (5일선·20일선 이탈)
      else if (await checkChartBreak(disclosure.corpCode, holdDate)) exitReason = 'CHART_BREAK';

      if (exitReason) {
        const exitConstraints = await checkConstraints(disclosure.corpCode, holdDate, holdPriceData);
        const exitPrice = exitConstraints.limitDown
          ? holdPriceData.lowPrice  // 하한가 → 하한가로 체결
          : holdPriceData.openPrice * (1 - run.slippagePct);

        finalizeTrade(trade, holdDate, exitPrice, actualShares, exitReason, run);
        portfolio.closePosition(event.corpCode, actualShares, exitPrice);
        break;
      }

      trade.peakReturn = peakReturn;
    }
  }

  // 6. 성과 지표 계산 & 요약 저장
  const summary = await performanceCalculator.calculate(trades, portfolio, run);
  await prisma.backtestRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', summary } });
}
```

---

### 4-5. 성과지표 계산 공식

```typescript
// performance-calculator.service.ts

interface PerformanceSummary {
  // 수익률
  totalReturn: number;           // (최종자산 - 초기자산) / 초기자산 * 100
  annualizedReturn: number;      // (1 + totalReturn/100)^(365/실제일수) - 1) * 100

  // 거래 통계
  totalTrades: number;
  winRate: number;               // 수익 거래 수 / 전체 거래 수 * 100
  avgWin: number;                // 수익 거래 평균 수익률
  avgLoss: number;               // 손실 거래 평균 손실률
  profitFactor: number;          // (avgWin * winCount) / |avgLoss * lossCount|
  // profitFactor > 1.5 권장, < 1.0 은 전략 기각

  // 위험 지표
  mdd: number;                   // Max Drawdown (%)
  // MDD = max(peak - trough) / peak * 100 (equity curve 기준)
  sharpe: number;
  // Sharpe = (월별수익률 평균 - 무위험이자율) / 월별수익률 표준편차 * sqrt(12)
  // 무위험이자율: 연 3.5% → 월 0.29% 기본값

  // 분류별 성과
  monthlyReturns: Record<string, number>;  // "YYYY-MM" → 수익률(%)
  byEventType: Record<string, EventTypeMetrics>;
  byPersona: Record<string, PersonaMetrics>;

  // 최악 10거래 (손실 기준 정렬)
  worstTrades: WorstTrade[];  // BacktestTrade.id + returnPct + exitReason
}

// EventTypeMetrics 예시
interface EventTypeMetrics {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  mdd: number;
}

// MDD 계산 의사코드
function calcMDD(equityCurve: number[]): number {
  let peak = equityCurve[0];
  let mdd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const drawdown = (peak - v) / peak * 100;
    if (drawdown > mdd) mdd = drawdown;
  }
  return mdd;
}

// Sharpe 계산 의사코드
function calcSharpe(monthlyReturns: number[], riskFreeMonthly = 0.29): number {
  const avg = mean(monthlyReturns) - riskFreeMonthly;
  const std = stddev(monthlyReturns);
  return std === 0 ? 0 : (avg / std) * Math.sqrt(12);
}
```

---

### 4-6. lookahead bias 방지 설계

**lookahead bias = 미래 정보가 과거 시점 결정에 사용되는 오류.** 다음 규칙을 코드 수준에서 강제한다.

| 조회 대상 | 허용 기준 시점 | 구현 방법 |
|-----------|---------------|-----------|
| `TradingSignal` | `createdAt <= disclosure.rcpDt` | `WHERE createdAt <= :rcpDt` 강제 |
| `StockDailyPrice` | `date < entryDate` (전날까지 지표만) | `WHERE date < :entryDate` 강제 |
| `EventStudyResult` (평균 반응) | 해당 공시 제외한 과거 사례만 | 학습 집합에서 현재 `rcpNo` 제외 |
| `TechnicalIndicator` | `calculatedAt <= disclosureAt` | 저장 시 `calculatedAt` 기록 필수 |
| 재무지표 | 공시 전 마지막 결산일 | 결산일 필드로 필터 |

```typescript
// 위반 방지 헬퍼
async function getTradingSignalAsOf(rcpNo: string, asOf: Date) {
  return prisma.tradingSignal.findFirst({
    where: { disclosureRcpNo: rcpNo, createdAt: { lte: asOf } },
    orderBy: { createdAt: 'desc' },
  });
}
// getDailyPrice: date < entryDate 조건을 서비스 레이어에서 하드코딩
```

---

### 4-7. 보수적 실전 투입 기준 6개 (Gate Checker)

```typescript
// gate-checker.service.ts

interface RealWorldGate {
  allMarketConditions: boolean;
  // 상승·하락·횡보장(각 최소 6개월) 구간에서 모두 양의 수익
  // 판정: KOSPI 기준 구간 분류 후 각 구간 수익률 > 0

  netPositiveAfterCost: boolean;
  // 수수료(0.015%) + 세금(0.18%) + 슬리피지(0.3%) 반영 후에도 총 수익률 > 5%
  // (5% 미만은 실전 비용 변동에 취약)

  diversified: boolean;
  // 단일 종목 또는 단일 이벤트 타입이 전체 수익의 60% 초과 의존 금지
  // 판정: 상위 1개 종목/이벤트 기여 비율 < 60%

  sufficientSamples: boolean;
  // 이벤트 타입별 거래 표본 >= 30건, 전체 거래 >= 50건
  // (표본 부족 시 통계적 유의성 없음)

  mddAcceptable: boolean;
  // MDD <= 20% (20% 초과 시 실전 자금 관리 불가 수준)

  recentPeriodConsistent: boolean;
  // 최근 1년 수익률이 전체 기간 연환산 수익률의 50% 이상 유지
  // (최근 구간 성과 급락 = 전략 훼손 신호)
}

function checkGate(summary: PerformanceSummary, marketConditions: MarketConditionMap): RealWorldGate {
  return {
    allMarketConditions: checkAllMarketConditions(summary.monthlyReturns, marketConditions),
    netPositiveAfterCost: summary.totalReturn > 5,
    diversified: checkDiversification(summary.byEventType, summary.totalReturn),
    sufficientSamples: summary.totalTrades >= 50
      && Object.values(summary.byEventType).every(e => e.totalTrades >= 30),
    mddAcceptable: summary.mdd <= 20,
    recentPeriodConsistent: checkRecentConsistency(summary.monthlyReturns, summary.annualizedReturn),
  };
}

// passedGate = 6개 모두 true → 모의투자(Phase 12) 진행 허용
const passedGate = Object.values(gate).every(Boolean);
```

---

## 5. 작업 분해

### 5-1. 백엔드

- [ ] `BacktestRun`, `BacktestTrade` Prisma 모델 추가 및 마이그레이션 (`npx prisma migrate dev`)
- [ ] `BacktestModule`, `BacktestController`, `BacktestService` 기본 구조 생성
- [ ] `MarketCalendarService` 구현 (거래일 계산, 장중/장후 판정)
  - [ ] 한국 공휴일 데이터 소스 연동 또는 하드코딩 (2020~2030)
  - [ ] `isAfterMarket(datetime: Date): boolean` 구현 (15:30 기준)
  - [ ] `nextTradingDay(date: Date): Date` 구현
- [ ] `PriceConstraintService` 구현
  - [ ] 상한가(+30%) / 하한가(-30%) 체결 불가 판정
  - [ ] 거래정지 플래그 조회 (`StockDailyPrice.tradingSuspended`)
  - [ ] 관리종목 플래그 조회 (`Company.adminStatus` 또는 별도 필드)
- [ ] `FillSimulatorService` 구현
  - [ ] 유동성 부족 판정: 목표 거래금액 > 일 거래대금 × 1% → 부분체결
  - [ ] `fillRate` 계산 로직
- [ ] `BacktestRunnerService` 구현 (메인 시뮬레이션 루프)
  - [ ] 공시 이벤트 시간순 정렬 & 진입 시점 결정
  - [ ] lookahead bias 방지 헬퍼 함수 (모든 쿼리에 `asOf` 조건)
  - [ ] 진입 / 보유 / 매도 루프
  - [ ] 슬리피지 적용 (진입: +slippagePct, 매도: -slippagePct)
  - [ ] 수수료·세금 계산 및 기록
- [ ] `PerformanceCalculatorService` 구현
  - [ ] 총수익률, 연환산수익률
  - [ ] 승률, 평균 수익/손실, 손익비(profitFactor)
  - [ ] MDD (equity curve 기반)
  - [ ] Sharpe (월별 수익률 표준편차, 무위험이자율 3.5%/year 기본값)
  - [ ] 월별 수익률 테이블 (`monthlyReturns`)
  - [ ] 이벤트 타입별 분류 (`byEventType`)
  - [ ] Persona별 분류 (`byPersona`)
  - [ ] 최악 10거래 추출 (returnPct ASC)
- [ ] `GateCheckerService` 구현 (실전 투입 기준 6개)
- [ ] `BacktestController` 엔드포인트 구현 (POST /runs, GET /runs, GET /runs/:id, GET /runs/:id/trades, GET /runs/:id/gate, DELETE /runs/:id)
- [ ] Swagger 문서화 (`@ApiTags('backtest')`, `@ApiOperation`, `@ApiResponse`)
- [ ] 백테스트 실행을 비동기 큐 처리 (BullMQ 또는 단순 setImmediate 분리 — 장시간 실행 대응)
- [ ] 단위 테스트: `MarketCalendarService`, `FillSimulatorService`, `PerformanceCalculatorService`

### 5-2. 모바일

- [ ] 백테스트 결과 목록 화면 (`/backtest/index.tsx`)
  - [ ] 실행 목록: name, 기간, totalReturn, winRate, mdd, passedGate 표시
- [ ] 백테스트 상세 화면 (`/backtest/[id].tsx`)
  - [ ] 성과 요약 카드 (totalReturn, annualizedReturn, winRate, profitFactor, mdd, sharpe)
  - [ ] 월별 수익률 바차트
  - [ ] 이벤트 타입별 / Persona별 성과 테이블
  - [ ] 최악 10거래 리스트
  - [ ] 실전 투입 기준 6개 체크리스트 (passedGate 뱃지)
- [ ] 모바일 화면은 **읽기 전용** (백테스트 실행 트리거는 관리자 도구에서만)

### 5-3. 데이터 준비

- [ ] 과거 3년치 일봉 데이터 수집 스크립트 (`scripts/fetch-historical-prices.ts`)
  - [ ] KIS OpenAPI 또는 FinanceDataReader 연동
  - [ ] `StockDailyPrice` 배치 upsert (corpCode + date 복합 유니크)
  - [ ] 거래정지·관리종목 플래그 저장
- [ ] 과거 공시 데이터 백필 (`POST /scheduler/collect` 반복 호출 스크립트)

### 5-4. 문서

- [ ] `docs/database-schema.md` — BacktestRun, BacktestTrade 모델 추가
- [ ] `docs/api-specification.md` — `/backtest/*` 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` — `backend/src/backtest/` 트리 추가
- [ ] `NEXT_STEPS.md` — Phase 10 완료 시 체크 표시

---

## 6. AI 사용 정책

Phase 10 백테스트 엔진은 **AI를 사용하지 않는다.** 모든 판단은 Rule/수식 기반으로 처리한다.

| 역할 | AI 사용 여부 | 이유 |
|------|-------------|------|
| 진입·매도 시뮬레이션 | 금지 | 규칙 기반 재현이 목적. AI 개입 시 bias 발생 |
| 성과지표 계산 | 금지 | 수학 공식으로 확정 가능 |
| Gate 판정 | 금지 | 명확한 수치 기준으로 결정 |
| 결과 해석 리포트 | **보조 허용** | 사용자가 원할 경우 "백테스트 결과 해석" 버튼 → Level 2 AI 호출 |

**AI 금지 영역 명시:**
- 백테스트 결과를 기반으로 AI가 전략 파라미터를 자동 조정하거나 최적화하는 행위는 과적합(overfitting) 위험으로 **절대 금지**
- Gate 판정 결과를 AI가 번복하거나 예외 처리하는 행위 **절대 금지**
- AI가 "이 전략은 실전에서도 수익이 날 것"이라는 **예측·보증 금지** (백테스트는 과거 검증, 미래 보장 아님)

---

## 7. 비용·성능 고려사항

| 항목 | 내용 |
|------|------|
| 실행 시간 | 3년치·50종목 시뮬레이션 기준 예상 5~30분 (PostgreSQL 쿼리 병목) |
| DB 부하 | 시뮬레이션 루프에서 `StockDailyPrice` 조회가 빈번 → **종목×기간 캐시 Map** 을 메모리에 preload 후 루프 실행 |
| 저장 비용 | `BacktestTrade` 최대 수천 건/실행 → `summary` JSON으로 집계 후 원시 trade는 30일 뒤 `COMPLETED` 상태 기준 배치 정리 가능 |
| AI 비용 | Phase 10 자체는 AI 미사용. 결과 해석 요청 시 Level 2 (gpt-4o-mini급) 단발 호출 → 건당 $0.01 이하 |
| 큐 처리 | 백테스트 실행은 HTTP 응답에서 분리 (즉시 `runId` 반환, 상태 폴링 또는 완료 푸시 알림) |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| **lookahead bias** | 모든 DB 쿼리에 `asOf` 조건 강제. 코드 리뷰 시 해당 서비스 파일 전수 검토 |
| **생존자 편향** | 상장폐지 종목도 폐지 직전까지 시뮬레이션 포함. `Company.delistedAt` 필드 추가 및 필터 적용 |
| **공시 시각 불명확** | `rcpDt`가 YYYYMMDD만 있고 시분초 없는 경우 → 장마감 후(15:30)으로 보수적 처리 (익일 시가 진입) |
| **거래정지 중 손절선 도달** | 거래정지 기간 중 `STOP_LOSS` 체결 불가 → 정지 해제 첫날 시가로 강제 청산, `wasTradingSuspended = true` 기록 |
| **상한가 연속 (진입 불가)** | 상한가 당일 진입 불가 → 다음날 재시도, 최대 3일 후에도 불가 시 건너뜀 (`LIMIT_UP_SKIP`) |
| **하한가 매도 불가** | 하한가 당일 매도 불가 → 하한가가 풀리는 날 저가 기준 체결 (최악 케이스 시뮬레이션) |
| **관리종목 진입 후 지정** | 진입 후 관리종목 지정 시 `THESIS_BREAK` 즉시 매도 처리 |
| **데이터 공백** | 일봉 누락 날짜 → 해당일 건너뜀, 연속 5일 이상 공백 시 `FORCE_EXIT` |
| **과적합** | 파라미터 그리드 서치 금지. 단일 전략 파라미터로 전체 기간 단순 검증만 허용 |
| **분봉 부재** | 일봉 + 시가만으로 시뮬레이션. 분봉 기반 정교한 진입은 Phase 12 모의투자에서 검증 |

---

## 9. 완료 기준 (DoD)

### 기능 완료 기준

- [ ] `BacktestRun`, `BacktestTrade` 테이블 마이그레이션 완료 및 운영 DB 적용
- [ ] `POST /backtest/runs` 호출 시 비동기로 시뮬레이션 실행되고 `runId` 즉시 반환
- [ ] 시뮬레이션 완료 후 `BacktestRun.summary` 에 성과 요약 JSON 저장 확인
- [ ] 현실 제약 7종(장중/장후 구분, 다음거래일 시가, 수수료·세금·슬리피지, 거래정지, 상하한가, 부분체결, 관리종목 제외) 모두 `BacktestTrade` 플래그 필드에 기록됨
- [ ] 성과지표 9종(총수익, 연환산수익, 승률, 평균손익, 손익비, MDD, Sharpe, 월별, 이벤트/Persona별) 정상 계산
- [ ] 최악 10거래 (`worstTrades`) 수익률 기준 정확히 정렬
- [ ] 보수적 실전 투입 기준 6개 `RealWorldGate` 판정 결과 `summary.realWorldGate` 에 저장
- [ ] lookahead bias 방지 원칙 코드 리뷰 통과 (모든 쿼리에 `asOf` 조건 확인)

### 품질 기준

- [ ] `MarketCalendarService`, `FillSimulatorService`, `PerformanceCalculatorService` 단위 테스트 커버리지 80% 이상
- [ ] 알려진 시나리오(예: 거래정지 중 손절, 상한가 연속) 대상 통합 테스트 케이스 작성
- [ ] Swagger `/api/docs` 에 `/backtest/*` 엔드포인트 문서 노출

### 통합 기준

- [ ] 모바일 백테스트 결과 목록·상세 화면에서 `passedGate` 뱃지 및 6개 기준 체크리스트 정상 표시
- [ ] `passedGate = false` 인 백테스트 결과에서 모의투자(Phase 12) 진행 불가 안내 메시지 출력
- [ ] `docs/database-schema.md`, `docs/api-specification.md`, `PROJECT_STRUCTURE.md`, `NEXT_STEPS.md` 업데이트 완료
