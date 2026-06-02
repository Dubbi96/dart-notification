> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 5 — 시세·차트·시장 데이터 결합

---

## 1. 목적 & 범위

### 목적

공시(Phase 1~4)가 아무리 좋아도 **가격이 이미 반영됐거나 시장이 무너지면 매수 금지**다.
이 Phase는 시세 수집 인프라를 구축하고, 종목별 기술지표를 배치로 계산하여
Phase 6(Buy Score) · Phase 8(Exit Score) · Phase 9(Event Study)가 참조할 수 있는
Quant & Market Engine의 데이터 토대를 완성한다.

### 포함 범위

- 증권사 OpenAPI 비교·선정 및 인증 통합
- 일봉/분봉 가격 데이터 수집 배치
- 종목 상태 수집 (거래정지 · 관리종목 · 투자주의 · 이상급등)
- 기술지표 배치 계산 (MA · RSI · MACD · Bollinger · ATR · VWAP · 거래량지표 · 전고/전저 · 공시 전 선행상승률)
- 시장지수 / 업종지수 일봉 수집
- 백엔드 API: 모바일 차트 데이터 조회 엔드포인트 (읽기 전용)

### 제외 범위 (이 Phase에서 하지 않는 것)

- 실시간 체결/호가 스트리밍 (Phase 13 반자동매매 때 도입)
- 주문 실행 (Phase 13~14)
- 백테스트 / 모의투자 (Phase 10 · 12)
- AI 기반 차트 패턴 단독 예측 — **차트는 예언 도구가 아니다**

---

## 2. 현재 코드베이스 연결점

| 기존 자산 | 활용 방법 |
|-----------|-----------|
| `Company` (`corpCode` PK, `stockCode`, `market`) | 수집 대상 종목 기준. `stockCode`가 null이면 수집 스킵 |
| `WatchList` (`corpCode` FK) | 초기 수집 우선순위 — 관심 종목 + 거래대금 충분 종목 먼저 |
| `Disclosure` (`rcpNo` PK, `rcpDt`, `corpCode`) | 공시 전 선행상승률(D-5 ~ D-1) 계산의 기준점 |
| `backend/src/scheduler/` | 기존 cron 인프라. 시세 배치도 동일 패턴으로 추가 |
| `backend/src/companies/` | 기업 서비스 — 종목 상태 필드 추가 후 조회 인터페이스 공유 |
| Prisma + PostgreSQL | 기존 마이그레이션 체계 그대로 사용 |

---

## 3. 선행 조건 & 의존성

| 조건 | 비고 |
|------|------|
| Phase 1 완료 — `Disclosure` 안정 수집 | 공시 전 선행상승률 계산 기준 |
| `Company.stockCode` 정확도 확보 | 시드(seed.ts) 재검증 필요. 빈 값이면 수집 스킵 |
| `Company.market` KOSPI/KOSDAQ 구분 | feature-status에서 불완전 상태. Phase 5 착수 전 보완 |
| **KRX 데이터마켓플레이스 접근** | 1차 소스. 일봉·지수·종목상태·상장 메타 |
| 증권사 OpenAPI 계정 (KIS) — *보완* | 실시간 현재가/분봉이 필요한 시점에 모의계좌로 시작. 본 Phase 필수 아님 |
| 시장지수용 지수코드 목록 | KOSPI·KOSDAQ·업종지수 (KRX 코드 체계 기준) |

---

## 4. 상세 설계

### 4-1. 데이터 소스 선정 — KRX 데이터마켓플레이스 기준

> **결정(2026-06-02):** 시세·통계 기준 데이터의 1차 소스는 **KRX 데이터마켓플레이스(한국거래소, 공기업)** 로 한다.
> 공기업 공식 데이터라 출처 신뢰성·라이선스가 명확하고, 일봉·지수·종목상태·통계 데이터를 표준 형식으로 제공한다.
> 증권사 OpenAPI(KIS 등)는 **KRX가 제공하지 않는 영역(실시간 현재가/분봉/주문 체결)** 의 보완 소스로만 사용한다.

**역할 분담:**

| 데이터 | 1차 소스 | 비고 |
|--------|----------|------|
| 일봉 OHLCV (종목·지수) | **KRX 데이터마켓플레이스** | EOD 일괄 수집(장 마감 후) |
| 시장/업종 지수 일봉 | **KRX** | KOSPI·KOSDAQ·업종지수 |
| 종목 상태(거래정지·관리·투자주의) | **KRX** | 시장조치/관리종목 데이터 |
| 상장사 메타(종목코드·시장구분) | **KRX** | `Company.stockCode`/`market` 보완(seed 정합) |
| 분봉 / 실시간 현재가 | 증권사 OpenAPI(KIS) — *보완* | Phase 6 실시간 신호·Phase 13 필요 시 |
| 주문 체결(매수/매도) | 증권사 OpenAPI(KIS) — *별도* | **Phase 13~14 전용. KRX는 체결 미제공** |

**선정 근거:**
- KRX는 한국거래소가 운영하는 공식 데이터 소스로 **EOD 일봉·지수·통계·종목상태**를 신뢰성 있게 제공 → Phase 5(시세 토대)·Phase 9(Event Study)·Phase 10(백테스트)의 과거 데이터 기준으로 적합.
- **실시간 현재가/체결은 KRX 범위 밖**이므로, 실시간 신호(Phase 6 이후)와 주문(Phase 13~14)은 증권사 OpenAPI로 보완한다.
- 따라서 이 Phase의 핵심 산출물(일봉·지표·종목상태)은 KRX로 충분하며, 증권사 연동은 실시간/체결이 필요한 후속 Phase로 미룰 수 있다.

**수집 전략:**
- `KrxMarketService` — KRX 데이터마켓플레이스에서 일봉/지수/종목상태를 **장 마감 후 일괄(EOD) 배치** 수집
- 응답 캐시(당일치 24h TTL), 거래일 캘린더 기반 휴장일 스킵
- 실패 시 재시도 3회 후 알림(로그/Slack webhook) + `DisclosureCollectionLog`와 동일 패턴의 수집 로그 기록
- 증권사 OpenAPI(KIS) 토큰 관리(`KisAuthService`, OAuth2 24h 캐시)는 **실시간/체결 보완이 필요한 시점(Phase 6 후반~13)에 도입** — 본 Phase에서는 선택 사항

### 4-2. Prisma 모델 스케치

```prisma
// 일봉 가격
model StockDailyPrice {
  id          String   @id @default(cuid())
  stockCode   String   // Company.stockCode (비공식 FK — 쿼리 조인 시 Company 참조)
  tradeDate   String   // YYYYMMDD
  openPrice   Int      // 시가 (원)
  highPrice   Int      // 고가
  lowPrice    Int      // 저가
  closePrice  Int      // 종가
  volume      BigInt   // 거래량 (주)
  tradingValue BigInt  // 거래대금 (원)
  changeRate  Float    // 전일 대비 등락률 (%)
  createdAt   DateTime @default(now())

  @@unique([stockCode, tradeDate])
  @@index([stockCode, tradeDate]) // 기간 조회
  @@index([tradeDate])            // 날짜별 전체 조회
  @@map("stock_daily_prices")
}

// 분봉 가격 (공시 직후 단기 반응 분석용)
model StockMinutePrice {
  id          String   @id @default(cuid())
  stockCode   String
  tradeDate   String   // YYYYMMDD
  tradeTime   String   // HHmmss
  openPrice   Int
  highPrice   Int
  lowPrice    Int
  closePrice  Int
  volume      BigInt
  createdAt   DateTime @default(now())

  @@unique([stockCode, tradeDate, tradeTime])
  @@index([stockCode, tradeDate])
  @@index([tradeDate, tradeTime])  // 시각 순 정렬
  @@map("stock_minute_prices")
}

// 기술지표 (일봉 기준 — 매일 장 마감 후 배치 계산)
model TechnicalIndicator {
  id           String   @id @default(cuid())
  stockCode    String
  tradeDate    String   // YYYYMMDD
  // 이동평균
  ma5          Float?
  ma20         Float?
  ma60         Float?
  ma120        Float?
  // 모멘텀
  rsi14        Float?   // 0~100
  macdLine     Float?   // MACD Line (EMA12 - EMA26)
  macdSignal   Float?   // Signal Line (EMA9 of MACD)
  macdHist     Float?   // Histogram
  // 변동성
  bbUpper      Float?   // Bollinger Upper (MA20 + 2σ)
  bbMiddle     Float?   // = MA20
  bbLower      Float?   // Bollinger Lower (MA20 - 2σ)
  atr14        Float?   // Average True Range (14일)
  // 수급
  vwap         Float?   // 당일 VWAP (분봉 기반)
  volRatio20   Float?   // 거래량/20일평균 거래량 (배)
  valRatio20   Float?   // 거래대금/20일평균 거래대금 (배)
  // 가격 위치
  highBreak52w Boolean? // 52주 신고가 돌파 여부
  lowBreak52w  Boolean? // 52주 신저가 이탈 여부
  prevHighBreak Boolean? // 전고점(최근 60일 고가) 돌파
  prevLowBreak  Boolean? // 전저점(최근 60일 저가) 이탈
  // 공시 전 선행상승률 (공시 D-5 ~ D-1 대비 종가 변화율 — DisclosureEvent 계산 시 채움)
  preDisclosureReturn Float? // 단위: %

  createdAt DateTime @default(now())

  @@unique([stockCode, tradeDate])
  @@index([stockCode, tradeDate])
  @@map("technical_indicators")
}

// 종목 상태 (매일 갱신)
model StockStatus {
  stockCode        String   @id // Company.stockCode
  tradeDate        String   // 마지막 갱신 날짜 YYYYMMDD
  isTradingSuspended Boolean @default(false) // 거래정지
  isManagement     Boolean  @default(false) // 관리종목
  isInvestmentCaution Boolean @default(false) // 투자주의
  isAbnormalSurge  Boolean  @default(false) // 이상급등 (투자위험/경고)
  statusNote       String?  // 사유 (예: "불성실공시법인 지정")
  updatedAt        DateTime @updatedAt

  @@map("stock_statuses")
}

// 시장·업종 지수 일봉
model MarketIndex {
  id          String   @id @default(cuid())
  indexCode   String   // "0001"=KOSPI, "1001"=KOSDAQ, 업종코드 등
  indexName   String   // "KOSPI", "KOSDAQ", "전기전자"
  tradeDate   String   // YYYYMMDD
  closeValue  Float    // 지수 종가
  changeRate  Float    // 전일 대비 등락률 (%)
  volume      BigInt?
  createdAt   DateTime @default(now())

  @@unique([indexCode, tradeDate])
  @@index([indexCode, tradeDate])
  @@map("market_indices")
}
```

**FK 설계 원칙:** `StockDailyPrice.stockCode` ↔ `Company.stockCode`는 Prisma 관계 선언 없이
쿼리 레벨에서 조인한다. `Company.stockCode`가 nullable이고 natural key(DART corpCode)와 분리되므로
DB 레벨 FK 제약은 걸지 않고, 서비스 레이어에서 Company 조회 후 stockCode 유효성 확인.

### 4-3. NestJS 모듈 구조

```
backend/src/market/
├── market.module.ts
├── market.service.ts              // 지표 조회, 종목 상태 확인
├── krx-market.service.ts          // KRX 일봉/지수/종목상태 수집 (1차 소스)
├── kis-auth.service.ts            // (보완) 증권사 OAuth2 토큰 — 실시간/체결 필요 시
├── kis-price.service.ts           // (보완) 실시간 현재가/분봉 — 후속 Phase
├── price-batch.service.ts         // 수집 배치 (cron, EOD 일괄)
├── indicator-calculator.service.ts // 지표 계산 로직
├── market.controller.ts           // REST API (모바일 조회용)
└── dto/
    ├── daily-price.dto.ts
    ├── indicator.dto.ts
    └── market-status.dto.ts
```

### 4-4. 핵심 서비스 시그니처

```typescript
// kis-price.service.ts
class KisPriceService {
  fetchDailyPrices(stockCode: string, startDate: string, endDate: string): Promise<DailyOhlcv[]>
  fetchMinutePrices(stockCode: string, date: string, interval: 1 | 3 | 5 | 10 | 30): Promise<MinuteOhlcv[]>
  fetchStockStatus(stockCode: string): Promise<StockStatusRaw>
  fetchMarketIndex(indexCode: string, startDate: string, endDate: string): Promise<IndexOhlcv[]>
}

// price-batch.service.ts
class PriceBatchService {
  // 매 평일 18:30 — 당일 일봉 수집 (관심종목 + 최근 TradingSignal 종목)
  @Cron('30 18 * * 1-5') collectDailyPrices(): Promise<void>

  // 매 평일 18:45 — 당일 분봉 수집 (당일 공시 발생 종목만)
  @Cron('45 18 * * 1-5') collectMinutePricesForDisclosureDates(): Promise<void>

  // 매 평일 19:00 — 기술지표 계산
  @Cron('0 19 * * 1-5') calculateIndicators(): Promise<void>

  // 매 평일 08:50 — 종목 상태 갱신 (장 시작 전)
  @Cron('50 8 * * 1-5') updateStockStatuses(): Promise<void>

  // 백필: 수동 트리거 (과거 데이터 적재용)
  backfillDailyPrices(stockCode: string, startDate: string, endDate: string): Promise<void>
}

// indicator-calculator.service.ts
class IndicatorCalculatorService {
  calculateAll(stockCode: string, referenceDate: string): Promise<TechnicalIndicator>
  calculateMA(prices: number[], period: number): number | null
  calculateRSI(closes: number[], period: 14): number | null
  calculateMACD(closes: number[]): { line: number; signal: number; hist: number } | null
  calculateBollinger(closes: number[], period: 20, stdDev: 2): { upper: number; middle: number; lower: number } | null
  calculateATR(highs: number[], lows: number[], closes: number[], period: 14): number | null
  calculateVWAP(minutes: MinuteOhlcv[]): number | null
  calculateVolRatio(volume: number, volumes20d: number[]): number
  detectHighBreak52w(high: number, highs52w: number[]): boolean
  detectLowBreak52w(low: number, lows52w: number[]): boolean
  calculatePreDisclosureReturn(stockCode: string, disclosureDate: string): Promise<number | null>
}

// market.controller.ts
@Controller('market')
class MarketController {
  @Get('prices/:stockCode/daily')   // 일봉 (쿼리: startDate, endDate, limit)
  getDailyPrices(@Param('stockCode') stockCode: string, @Query() q: DailyPriceQueryDto): Promise<DailyPriceResponseDto[]>

  @Get('prices/:stockCode/minute')  // 분봉 (쿼리: date, interval)
  getMinutePrices(@Param() p, @Query() q): Promise<MinutePriceResponseDto[]>

  @Get('indicators/:stockCode')     // 기술지표 (쿼리: date)
  getIndicator(@Param('stockCode') stockCode: string, @Query('date') date: string): Promise<IndicatorResponseDto>

  @Get('status/:stockCode')         // 종목 상태
  getStockStatus(@Param('stockCode') stockCode: string): Promise<StockStatusResponseDto>

  @Get('indices/:indexCode/daily')  // 시장지수
  getMarketIndex(@Param('indexCode') indexCode: string, @Query() q): Promise<IndexResponseDto[]>

  @Post('backfill')                 // 백필 트리거 (관리자용)
  @UseGuards(AdminGuard)
  triggerBackfill(@Body() dto: BackfillDto): Promise<{ accepted: boolean }>
}
```

### 4-5. 지표 계산 의사코드

#### RSI (14일)

```
gains = closes[i] - closes[i-1] > 0 ? diff : 0  (for i in last 15 days)
losses = closes[i] - closes[i-1] < 0 ? abs(diff) : 0
avgGain = mean(gains[1..14])  // 첫 계산: 단순평균
avgLoss = mean(losses[1..14])
RS = avgGain / avgLoss
RSI = 100 - (100 / (1 + RS))
// 이후: Wilder 스무딩 — avgGain = (prevAvgGain * 13 + gain) / 14
```

#### MACD (12/26/9)

```
ema12 = EMA(closes, 12)
ema26 = EMA(closes, 26)
macdLine = ema12 - ema26
signalLine = EMA(macdLine[-9:], 9)
histogram = macdLine - signalLine
// EMA(prices, n): 초기값 = 단순이동평균, 이후 k=2/(n+1) 지수가중
```

#### Bollinger Bands (20, 2σ)

```
ma20 = MA(closes[-20:], 20)
stddev = stdev(closes[-20:])  // 표본 표준편차
upper = ma20 + 2 * stddev
lower = ma20 - 2 * stddev
```

#### ATR (14일)

```
for each day:
  tr = max(high - low, abs(high - prevClose), abs(low - prevClose))
atr = Wilder_smooth(tr_list, 14)  // 첫값: mean(tr[-14:])
```

#### VWAP (당일 분봉 기반)

```
vwap = sum(closePrice[i] * volume[i]) / sum(volume[i])  // i = 당일 각 분봉
```

#### 거래량 비율

```
volRatio20 = todayVolume / mean(volume[-20:])  // 20일 평균 대비 배수
valRatio20 = todayTradingValue / mean(tradingValue[-20:])
```

#### 공시 전 선행상승률 (pre-disclosure return)

```
// disclosureDate = rcpDt (YYYYMMDD)
priceD_1 = StockDailyPrice.closePrice where tradeDate = 직전 거래일(disclosureDate)
priceD_6 = StockDailyPrice.closePrice where tradeDate = 직전 6번째 거래일(disclosureDate)
// 직전 5거래일 수익률 = D-5 ~ D-1
preDisclosureReturn = (priceD_1 - priceD_6) / priceD_6 * 100
// 예: +15% → Phase 6에서 과열 패널티 부여
// 데이터 부족 시 null 저장 (지표 계산 불가 종목은 Phase 6에서 해당 항목 점수 0처리)
```

#### 전고/전저 돌파 감지

```
recent60HighPrices = StockDailyPrice.highPrice where tradeDate in 최근 60거래일 (오늘 제외)
prevHigh = max(recent60HighPrices)
prevHighBreak = todayHighPrice > prevHigh

recent60LowPrices = StockDailyPrice.lowPrice where tradeDate in 최근 60거래일 (오늘 제외)
prevLow = min(recent60LowPrices)
prevLowBreak = todayLowPrice < prevLow
```

### 4-6. 차트 데이터 사용 원칙

**올바른 용도 (Phase 6 · 8에서만 활용):**
- 진입 가격 위치 확인 — "현재가가 20일선 위/아래"
- 과열 판단 — "RSI > 75" 또는 "공시 전 5일 +15% 이상"
- 손익 기준 설정 — "ATR의 2배 = 손절 폭 기준"
- 추세 훼손 감지 — "5·20일선 연속 이탈", "전저점 하향 돌파"

**금지 용도 (절대):**
- AI에게 차트 지표만 주고 등락 단독 예측 요청
- 기술지표 단독으로 매수 결정 (공시 분석 없이)
- 차트 패턴으로 포트폴리오 한도·손절 룰 우회

---

## 5. 작업 분해

### 5-1. 인프라 & 인증

- [ ] **KRX 데이터마켓플레이스 접근 확인** — 일봉/지수/종목상태/상장 메타 엔드포인트 검증
- [ ] `KrxMarketService` 구현 — EOD 일괄 수집 + 거래일 캘린더 휴장일 스킵 + 응답 캐시
- [ ] 환경변수 추가: `KRX_BASE_URL` (필요 시 `KRX_API_KEY`)
- [ ] (보완·선택) 증권사 OpenAPI 실시간 연동은 실시간 현재가/분봉이 필요한 시점에 도입: `KisAuthService` + `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`

### 5-2. DB 마이그레이션

- [ ] `StockDailyPrice` 모델 추가 + 마이그레이션
- [ ] `StockMinutePrice` 모델 추가 + 마이그레이션
- [ ] `TechnicalIndicator` 모델 추가 + 마이그레이션
- [ ] `StockStatus` 모델 추가 + 마이그레이션
- [ ] `MarketIndex` 모델 추가 + 마이그레이션
- [ ] `Company.market` 컬럼 데이터 보완 (KOSPI/KOSDAQ 구분)

### 5-3. 수집 배치

- [ ] `KisPriceService.fetchDailyPrices()` 구현 (KIS REST 호출 + 파싱)
- [ ] `PriceBatchService.collectDailyPrices()` cron 구현 (18:30 평일)
- [ ] `KisPriceService.fetchMinutePrices()` 구현
- [ ] `PriceBatchService.collectMinutePricesForDisclosureDates()` cron 구현 (18:45 평일)
- [ ] 종목 상태 수집 구현 (`updateStockStatuses()`, 08:50 평일)
- [ ] 시장지수 일봉 수집 구현 (KOSPI 0001, KOSDAQ 1001)
- [ ] 백필 API 엔드포인트 구현 (`POST /market/backfill`)
- [ ] 과거 데이터 최초 백필 실행 (최소 250거래일 — 지표 계산에 필요한 252일 확보)

### 5-4. 지표 계산

- [ ] `IndicatorCalculatorService.calculateMA()` 구현 (5/20/60/120)
- [ ] `IndicatorCalculatorService.calculateRSI()` 구현 (Wilder 스무딩)
- [ ] `IndicatorCalculatorService.calculateMACD()` 구현 (12/26/9)
- [ ] `IndicatorCalculatorService.calculateBollinger()` 구현
- [ ] `IndicatorCalculatorService.calculateATR()` 구현
- [ ] `IndicatorCalculatorService.calculateVWAP()` 구현 (분봉 기반)
- [ ] `IndicatorCalculatorService.calculateVolRatio()` 구현
- [ ] `IndicatorCalculatorService.detectHighBreak52w()` / `detectLowBreak52w()` 구현
- [ ] `IndicatorCalculatorService.calculatePreDisclosureReturn()` 구현
- [ ] `PriceBatchService.calculateIndicators()` cron 구현 (19:00 평일)
- [ ] 지표 계산 실패 시 null 저장 + 에러 로그

### 5-5. API 엔드포인트

- [ ] `GET /market/prices/:stockCode/daily` 구현
- [ ] `GET /market/prices/:stockCode/minute` 구현
- [ ] `GET /market/indicators/:stockCode` 구현
- [ ] `GET /market/status/:stockCode` 구현
- [ ] `GET /market/indices/:indexCode/daily` 구현
- [ ] Swagger 문서 데코레이터 추가

### 5-6. 모바일 연동

- [ ] `MarketService` (React Query 훅) 작성: `useDailyPrices`, `useIndicator`, `useStockStatus`
- [ ] 공시 상세 화면에 "현재가 + 주요 지표 요약" 섹션 추가 (차트 라이브러리는 Phase 6 이후)
- [ ] 종목 상태가 거래정지/관리종목이면 경고 배지 표시

---

## 6. AI 사용 정책

이 Phase에서 AI는 **사용하지 않는다.**

시세 수집 · 지표 계산은 결정론적 수식이다. AI가 개입할 근거가 없으며
비용 낭비 없이 Rule 엔진만으로 완전히 구현 가능하다.

**AI 개입 절대 금지:**
- 차트 지표로 등락 예측 (AI 독자 예언 금지)
- 포트폴리오 손절/익절 수준 결정 (하드 룰 우회 금지)
- 주문 수량 · 주문 타이밍 결정 (Phase 13~14 이전 금지)

AI는 Phase 4 (공시 해석) · Phase 6 (Buy Score 설명 텍스트 생성) · Phase 8 (Exit Score 설명) 에서만 활용한다.

---

## 7. 비용·성능 고려사항

### API 호출 비용

| 항목 | 예상 |
|------|------|
| KIS 일봉 호출 | 하루 최대 500종목 × 1회 = 500건/일. 무료 한도 내 |
| KIS 분봉 호출 | 공시 발생 종목만 (평균 10~30종목/일). 부담 없음 |
| 초기 백필 (250일 × 500종목) | 약 125,000건. 1일 이내 순차 완료 (200ms 간격) |

### DB 용량 추정

| 테이블 | 예상 행 수 (2년) |
|--------|-----------------|
| `StockDailyPrice` | 500종목 × 500일 = 250,000행 |
| `StockMinutePrice` | 50종목(공시발생) × 390분 × 250일 = 약 490만 행. **파티셔닝 검토** |
| `TechnicalIndicator` | 500 × 500 = 250,000행 |
| `MarketIndex` | 2지수 × 500일 = 1,000행 |

`StockMinutePrice`는 1년 초과 데이터는 자동 삭제 배치 추가 권장.

### 성능 최적화

- `StockDailyPrice` 일괄 upsert: `createMany skipDuplicates` 패턴 (기존 Disclosure와 동일)
- 지표 계산은 종목당 최대 252행 조회 → 단일 DB 쿼리로 처리, 외부 API 불필요
- `@@index([stockCode, tradeDate])` 복합 인덱스로 기간 조회 최적화

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| KIS API 토큰 만료 중 수집 | `KisAuthService`에서 토큰 유효성 검증 → 자동 재발급 → 재시도 |
| 주말·공휴일 수집 실행 | cron `1-5`(평일)로 제한. 공휴일은 KIS API 응답이 빈 배열 → 정상 처리 |
| 거래정지 종목 일봉 없음 | `null` 저장 + `StockStatus.isTradingSuspended = true` 플래그 |
| 상장폐지 종목 | `Company.stockCode` null 처리 후 수집 스킵 |
| 250일 미달 신규 상장주 | 지표 계산 시 데이터 부족 → 해당 지표 `null` 저장. Phase 6에서 null 지표는 점수 0 처리 |
| 분봉 데이터 대용량 | 30분봉(390분 → 13봉/일) 먼저 사용. 필요 시 1분봉으로 확대 |
| KIS API 서비스 장애 | 재시도 3회 + 실패 로그. 다음 배치 주기에 재수집 (일봉은 하루 내 재시도 무방) |
| 선행상승률 계산 대상일 거래 없음 | 직전 유효 거래일로 대체. 5거래일 내 유효 데이터 없으면 null |
| 주식 분할/병합 | `changeRate` 이상치 감지(±50% 이상) → 수동 검토 플래그. 이 Phase에서는 보정 미구현 |
| 관리종목/거래정지 종목을 매수 후보로 올리는 실수 | Phase 6 Buy Score 계산 시 `StockStatus` 조회 필수 — 거래정지/관리종목이면 **즉시 BLOCK** |

---

## 9. 완료 기준 (DoD)

- [ ] **데이터 적재**: 관심 종목 50개 이상, 250거래일 이상 일봉 데이터 DB에 존재
- [ ] **배치 안정성**: 3거래일 연속 18:30 cron 자동 실행 + 당일 일봉 정상 저장 확인
- [ ] **지표 정확성**: MA20 · RSI14 · MACD 값을 외부 참조 데이터(네이버 금융 또는 KIS 앱)와 오차 1% 이내 비교 검증
- [ ] **종목 상태**: 임의 거래정지 종목 1개 선택, `StockStatus.isTradingSuspended = true` 정상 반영 확인
- [ ] **API 동작**: `GET /market/indicators/:stockCode?date=YYYYMMDD` → 지표 JSON 정상 반환
- [ ] **선행상승률**: 임의 공시 rcpNo 3건에 대해 D-5~D-1 수익률 계산 값 수동 검증
- [ ] **null 안전성**: 신규 상장 또는 데이터 부족 종목 요청 시 500 에러 없이 null 포함 응답 반환
- [ ] **AI 미사용 확인**: 이 Phase에서 외부 LLM API 호출 코드가 없음을 코드 리뷰로 확인
- [ ] **문서 업데이트**: `docs/database-schema.md` · `PROJECT_STRUCTURE.md` · `NEXT_STEPS.md` 갱신
