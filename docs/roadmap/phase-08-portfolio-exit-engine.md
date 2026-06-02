> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 8 — Portfolio Tracking & Exit Engine

> 작성일: 2026-06-02 · AI 사용: **보조(논리 훼손 해석 한정)** · 선행 Phase: Phase 7 (PositionThesis)

---

## 1. 목적 & 범위

### 목적

"매수보다 매도·포트폴리오 추적을 먼저 안전하게 설계한다"는 3대 원칙 제2항의 핵심 구현체다.
Phase 7이 **왜 샀는지**를 저장한다면, Phase 8은 **언제 팔아야 하는지**를 실시간으로 감시한다.

보유 포지션 전체를 하루 3회(장 시작 전·장중·장 마감 후) 점검해 6종 매도 트리거와 Exit Score를 산출하고, 5종 액션(`HOLD / WATCH / REDUCE / EXIT / BLOCK_REBUY`) 중 하나를 제안한다. 점수와 논거는 `ExitSignal`에 영속화하며, 최종 주문 승인과 실제 주문 집행은 Phase 13(반자동매매) 이전에는 절대 자동으로 수행하지 않는다.

### 포함

- `Portfolio`, `Position`, `PositionDailySnapshot`, `ExitSignal`, `PortfolioRiskSnapshot` Prisma 모델
- `PortfolioModule` / `ExitEngineService` / `PortfolioController` NestJS 구조
- Exit Score 공식 및 6종 트리거 평가 의사코드
- 하루 3회 점검 Cron 스케줄러 설계
- `PositionThesis.invalidConditions` 평가 연동
- 포트폴리오 위험 스냅샷(`PortfolioRiskSnapshot`) 생성 로직
- REST API 엔드포인트 명세
- 모바일 Exit Alert 알림 흐름

### 제외

- 실제 주문 집행 → Phase 13 (반자동매매)
- 자동 손절·익절 주문 → Phase 14 (제한적 자동매매)
- 백테스트용 Exit Rule 성과 측정 → Phase 10
- 모의투자 Exit 연동 → Phase 12
- **AI가 최종 주문 수량·손익 하드룰·포트폴리오 한도를 결정하는 행위 전면 금지**

---

## 2. 현재 코드베이스 연결점

| 파일 / 모델 | 역할 | Phase 8 연결 방향 |
|------------|------|-------------------|
| `backend/prisma/schema.prisma` | `Disclosure`(rcpNo PK), `Company`(corpCode PK) | `Position.corpCode → Company`, `ExitSignal.triggerRcpNo → Disclosure` FK 연결 |
| `backend/src/scheduler/scheduler.service.ts` | 기존 cron 관리 | 하루 3회 Exit 점검 cron 추가 |
| `backend/src/dart-api/dart-api.service.ts` | 공시 분류 | 보유 종목 악재 공시 감지에 재활용 |
| Phase 7 `PositionThesis` (설계 예정) | 진입 논리·훼손 조건 저장 | `invalidConditions` JSON 읽어 논리훼손 점수 산출 |
| Phase 5 `StockDailyPrice`, `TechnicalIndicator` (설계 예정) | 일봉·기술지표 | MA5/20 이탈, ATR, VWAP, RSI 읽어 차트훼손 점수 산출 |
| Phase 4 `DisclosureAnalysis` (설계 예정) | AI 분석 JSON | 보유 종목 신규 악재 공시 분석 결과 참조 |

---

## 3. 선행 조건 & 의존성

| 항목 | 상태 | 비고 |
|------|------|------|
| Phase 0 (기준선) | 완료 필요 | — |
| Phase 1 (수집 안정화) | 완료 필요 | 악재 공시 감지 흐름 필요 |
| Phase 3 (이벤트 추출) | 완료 필요 | `DisclosureEvent.eventType` 기반 논리훼손 판단 |
| Phase 5 (시세·차트 데이터) | 완료 필요 | 차트훼손 점수 산출에 `StockDailyPrice`, `TechnicalIndicator` 필요 |
| Phase 7 (PositionThesis) | 완료 필요 | `invalidConditions` 평가의 직접 선행 조건 |
| `Company.corpCode` 자연키 PK | 현재 존재 | `Position` FK 기반 |
| `Disclosure.rcpNo` 자연키 PK | 현재 존재 | `ExitSignal.triggerRcpNo` FK 기반 |
| KIS/증권사 OpenAPI (시세) | Phase 5에서 연동 | 현재가, ATR, VWAP 실시간 조회 |

---

## 4. 상세 설계

### 4-1. Prisma 모델

```prisma
// backend/prisma/schema.prisma 에 추가 (Phase 8)

// ─────────────────────────────────────────
// 포트폴리오 (사용자별 계좌 단위)
// ─────────────────────────────────────────
model Portfolio {
  id          String   @id @default(cuid())
  userId      String
  name        String   @default("기본 포트폴리오")
  currency    String   @default("KRW")
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 한도 설정 (하드룰 — AI 금지 영역)
  // 이 값들은 Risk Engine이 강제 적용. AI가 변경 불가.
  maxSinglePositionPct  Float @default(10.0)  // 단일 종목 최대 비중 %
  maxSectorPct          Float @default(30.0)  // 단일 섹터 최대 비중 %
  maxDailyLossPct       Float @default(2.0)   // 일일 최대 손실 %
  maxWeeklyLossPct      Float @default(5.0)   // 주간 최대 손실 %
  stopLossGlobalPct     Float @default(15.0)  // 포트폴리오 전체 손실한도 %

  // Relations
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  positions Position[]
  riskSnapshots PortfolioRiskSnapshot[]

  @@index([userId])
  @@map("portfolios")
}

// ─────────────────────────────────────────
// 포지션 (종목별 보유 내역)
// ─────────────────────────────────────────
enum PositionStatus {
  OPEN      // 보유 중
  CLOSED    // 전량 매도 완료
  PARTIAL   // 일부 매도 후 잔여 보유
}

model Position {
  id           String         @id @default(cuid())
  portfolioId  String
  corpCode     String         // FK → Company.corpCode (자연키)
  stockCode    String         // 종목코드 6자리 (시세 조회용)

  // 진입 정보
  entryDate    DateTime
  entryPrice   Float          // 평균 매수가 (원)
  quantity     Int            // 보유 수량
  entryAmount  Float          // 총 매수금액 = entryPrice × quantity

  // 현재 상태 (장 마감 후 스냅샷 기준 갱신)
  currentPrice Float?
  currentValue Float?         // currentPrice × quantity
  unrealizedPnl Float?        // currentValue - entryAmount
  unrealizedPnlPct Float?     // unrealizedPnl / entryAmount × 100

  // 리스크 기준 (PositionThesis에서 복사 저장 — 빠른 조회용)
  stopLossPct   Float?        // 손절 기준 % (예: -7.0)
  takeProfitPct Float?        // 익절 기준 % (예: +12.0)
  maxHoldDays   Int?          // 최대 보유 기간(거래일)

  // 고점 추적 (트레일링 스탑용)
  highestPrice  Float?
  highestAt     DateTime?

  status       PositionStatus @default(OPEN)
  closedAt     DateTime?

  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  // Relations
  portfolio      Portfolio              @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
  company        Company                @relation(fields: [corpCode], references: [corpCode])
  dailySnapshots PositionDailySnapshot[]
  exitSignals    ExitSignal[]

  @@index([portfolioId, status])
  @@index([corpCode])
  @@index([stockCode])
  @@map("positions")
}

// ─────────────────────────────────────────
// 포지션 일별 스냅샷 (백테스트·성과 분석용)
// ─────────────────────────────────────────
model PositionDailySnapshot {
  id            String   @id @default(cuid())
  positionId    String
  snapshotDate  String   // YYYYMMDD

  openPrice     Float?
  closePrice    Float?
  highPrice     Float?
  lowPrice      Float?
  volume        BigInt?  // 당일 거래량

  // 기술지표 스냅샷
  ma5           Float?
  ma20          Float?
  ma60          Float?
  rsi14         Float?
  atr14         Float?
  vwap          Float?

  // 포지션 성과
  quantity      Int
  positionValue Float    // closePrice × quantity
  unrealizedPnl Float
  unrealizedPnlPct Float

  // 당일 Exit Score (장 마감 후 점검 기준)
  exitScore     Int?
  exitAction    String?  // HOLD/WATCH/REDUCE/EXIT/BLOCK_REBUY

  createdAt     DateTime @default(now())

  // Relations
  position Position @relation(fields: [positionId], references: [id], onDelete: Cascade)

  @@unique([positionId, snapshotDate])
  @@index([positionId, snapshotDate])
  @@map("position_daily_snapshots")
}

// ─────────────────────────────────────────
// 매도 신호 (Exit Signal)
// ─────────────────────────────────────────
enum ExitTriggerType {
  STOP_LOSS            // 손실 제한
  TAKE_PROFIT          // 수익 실현
  THESIS_INVALIDATED   // 투자논리 훼손
  TIME_LIMIT           // 시간 제한
  CHART_BREAKDOWN      // 차트 훼손
  REBALANCING          // 리밸런싱
}

enum ExitAction {
  HOLD          // 보유 유지
  WATCH         // 주의 관찰 (다음 점검까지 유지)
  REDUCE        // 일부 축소 (25~50% 매도 제안)
  EXIT          // 전량 매도 후보
  BLOCK_REBUY   // 매도 후 재매수 금지
}

model ExitSignal {
  id           String          @id @default(cuid())
  positionId   String
  checkTime    String          // "PRE_MARKET" | "INTRADAY" | "POST_MARKET"
  checkedAt    DateTime        @default(now())

  // Exit Score 구성 요소 (각 0~20점, 합산 후 감산)
  lossRiskScore       Int      @default(0)   // 손실 리스크 (최대 20)
  thesisBreakScore    Int      @default(0)   // 투자논리 훼손 (최대 20)
  chartBreakScore     Int      @default(0)   // 차트 훼손 (최대 20)
  disclosureRiskScore Int      @default(0)   // 공시 악화 (최대 20)
  overweightScore     Int      @default(0)   // 과다 비중 (최대 10)
  timeExceededScore   Int      @default(0)   // 시간 초과 (최대 10)
  positiveMomentumBonus Int    @default(0)   // 긍정 모멘텀 보너스 (최대 -20, 감산)

  exitScore    Int              // 최종 합산 점수
  exitAction   ExitAction
  triggerType  ExitTriggerType?  // 주요 트리거 (복수 가능 시 최고 점수 기준)
  triggerTypes String[]          // 복수 트리거 목록

  // 근거 상세 (JSON)
  // { lossRiskDetail: {...}, thesisDetail: {...}, chartDetail: {...}, ... }
  scoreDetail  Json

  // 관련 공시 (공시 악화 트리거 시 연결)
  triggerRcpNo String?   // FK → Disclosure.rcpNo (nullable)

  // AI 해석 (논리훼손 트리거 한정, 보조 역할)
  aiExplanation String?  // AI가 invalidConditions 훼손 여부를 자연어로 설명
  aiUsed        Boolean  @default(false)

  // 사용자 처리 결과
  isAcknowledged Boolean  @default(false)
  acknowledgedAt DateTime?
  userAction     String?   // "AGREED_EXIT" | "OVERRIDDEN_HOLD" | "PARTIAL_EXIT"

  createdAt    DateTime    @default(now())

  // Relations
  position  Position    @relation(fields: [positionId], references: [id], onDelete: Cascade)
  disclosure Disclosure? @relation(fields: [triggerRcpNo], references: [rcpNo])

  @@index([positionId, checkedAt])
  @@index([exitAction])
  @@index([exitScore])
  @@index([triggerRcpNo])
  @@map("exit_signals")
}

// ─────────────────────────────────────────
// 포트폴리오 위험 스냅샷 (일 1회 장 마감 후)
// ─────────────────────────────────────────
model PortfolioRiskSnapshot {
  id            String   @id @default(cuid())
  portfolioId   String
  snapshotDate  String   // YYYYMMDD

  totalValue    Float    // 전체 평가금액
  cashAmount    Float?   // 현금 잔고 (입력 시)
  unrealizedPnl Float
  unrealizedPnlPct Float

  // 집중도 위험
  topPositionPct    Float   // 최대 단일 종목 비중 %
  topSectorPct      Float?  // 최대 단일 섹터 비중 %
  openPositionCount Int

  // 당일 손익
  dailyPnl     Float?
  dailyPnlPct  Float?

  // 주간 손익 (집계)
  weeklyPnl    Float?
  weeklyPnlPct Float?

  // 포트폴리오 전체 위험 상태
  // "NORMAL" | "CAUTION" | "DANGER" | "CRITICAL"
  riskLevel    String   @default("NORMAL")

  // 하드룰 위반 여부 (AI 금지 영역 — 룰 엔진만 판단)
  hardRuleBreached Boolean @default(false)
  hardRuleDetail   String? // 어떤 한도 초과인지 기술

  createdAt    DateTime @default(now())

  // Relations
  portfolio Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  @@unique([portfolioId, snapshotDate])
  @@index([portfolioId, snapshotDate])
  @@map("portfolio_risk_snapshots")
}
```

**FK 정합성 주의:**
- `Position.corpCode → Company.corpCode` (자연키 PK, 기존 존재)
- `ExitSignal.triggerRcpNo → Disclosure.rcpNo` (자연키 PK, 기존 존재, nullable)
- `PositionThesis`는 Phase 7에서 `positionId`와 1:1 관계로 연결 예정

---

### 4-2. NestJS 모듈 구조

```
backend/src/portfolio/
  portfolio.module.ts
  portfolio.controller.ts
  portfolio.service.ts          # 포트폴리오 CRUD, 포지션 관리
  exit-engine.service.ts        # Exit Score 산출·ExitSignal 생성
  exit-engine.scheduler.ts      # 하루 3회 cron
  dto/
    create-portfolio.dto.ts
    open-position.dto.ts
    exit-signal-response.dto.ts
    portfolio-summary.dto.ts
```

---

### 4-3. Exit Score 공식 및 6종 트리거 의사코드

#### Exit Score 합산 공식

```
Exit Score = lossRiskScore       (0~20)
           + thesisBreakScore    (0~20)
           + chartBreakScore     (0~20)
           + disclosureRiskScore (0~20)
           + overweightScore     (0~10)
           + timeExceededScore   (0~10)
           - positiveMomentumBonus (0~20)

범위: -20 ~ 100 (실질: 0 이하는 HOLD 고정)

판정 기준:
  0  ~ 29 → HOLD         (보유 유지)
  30 ~ 49 → WATCH        (주의 관찰)
  50 ~ 69 → REDUCE       (일부 축소 25~50% 제안)
  70 ~ 89 → EXIT         (전량 매도 후보)
  90 ~100 → EXIT + BLOCK_REBUY (즉시 리스크 매도, 재매수 금지)
```

#### 트리거 1: 손실 제한 (`lossRiskScore`, 최대 20점)

```
function calcLossRiskScore(position, currentPrice, atr14, portfolioLoss):
  score = 0

  # 하드 스탑 (entryPrice 기준 %)
  pnlPct = (currentPrice - position.entryPrice) / position.entryPrice * 100
  if pnlPct <= position.stopLossPct:          # 예: -7%
    score += 20                               # 즉시 최고점 → EXIT 확정
    return score                              # 이하 계산 불필요

  # ATR 기반 이탈 (1.5×ATR 이하)
  atrStop = position.entryPrice - 1.5 * atr14
  if currentPrice < atrStop:
    score += 15

  # 트레일링 스탑 (-6% from highest)
  trailingStop = position.highestPrice * (1 - 0.06)
  if currentPrice < trailingStop and pnlPct > 5:  # 수익권에서만 트레일링
    score += 12

  # 포트폴리오 전체 일일 손실 한도 초과 (하드룰 — AI 금지)
  if portfolioLoss <= -portfolio.maxDailyLossPct:
    score = min(score + 10, 20)               # 추가 +10, 20 캡

  return min(score, 20)
```

#### 트리거 2: 수익 실현 (`positiveMomentumBonus`와 연동, lossRiskScore 감산 없음)

```
# 수익 실현은 ExitScore 상승이 아닌 별도 조건 처리
# 분할 익절: pnlPct >= takeProfitPct → REDUCE 직접 제안 (score 무관)
# 트레일링 스탑 수익 실현: 위 lossRiskScore 트레일링 항목에서 처리
```

#### 트리거 3: 투자논리 훼손 (`thesisBreakScore`, 최대 20점)

```
function calcThesisBreakScore(position, thesis, newDisclosureEvents):
  score = 0
  if thesis is None:
    return 0                  # thesis 없으면 평가 불가 — 0점(보수 처리)

  invalidConditions = thesis.invalidConditions  # Phase 7 저장 배열
  # 예: ["계약금액 축소 정정공시", "계약 해지", "20일선 종가 이탈"]

  triggeredCount = 0
  for condition in invalidConditions:
    if matchRuleOrAI(condition, newDisclosureEvents, position):
      triggeredCount += 1

  # Rule 매칭: 이벤트 타입(CONTRACT_CANCELLATION, PAID_IN_CAPITAL_INCREASE 등)
  # AI 보조: invalidCondition 문장이 Rule로 판별 불가한 경우만 AI 호출
  #         → AI 사용 시 AIUsageLog 기록 (Level L2)

  if triggeredCount >= 3:  score = 20
  elif triggeredCount == 2: score = 14
  elif triggeredCount == 1: score = 8

  # 핵심 훼손 조건(첫 번째) 단독 위반 시 가중
  if primaryConditionTriggered:
    score = max(score, 16)

  return min(score, 20)
```

#### 트리거 4: 시간 제한 (`timeExceededScore`, 최대 10점)

```
function calcTimeExceededScore(position, thesis, marketData):
  score = 0
  holdDays = tradingDaysSince(position.entryDate)

  if thesis.maxHoldDays and holdDays > thesis.maxHoldDays:
    score += 8

  # 공시 후 N거래일 이내 반응 없음 (5일 기준)
  if holdDays >= 5:
    excessReturn = calcExcessReturn(position, marketData, days=5)
    if excessReturn < 0:                 # 시장 대비 초과수익 없음
      score += 4

  # 거래량 급감 (공시 후 D+3 ~ D+5 평균이 D0~D+2 대비 50% 미만)
  if avgVolumeRatio(position, recentDays=5) < 0.5:
    score += 2

  return min(score, 10)
```

#### 트리거 5: 차트 훼손 (`chartBreakScore`, 최대 20점)

```
function calcChartBreakScore(position, technicalData):
  score = 0
  close = technicalData.closePrice
  ma5   = technicalData.ma5
  ma20  = technicalData.ma20
  vwap  = technicalData.vwap

  # MA5 이탈 (종가 기준)
  if close < ma5:
    score += 6

  # MA20 이탈 (추세 훼손 핵심)
  if close < ma20:
    score += 10

  # VWAP 이탈 (장중 점검 시)
  if close < vwap:
    score += 4

  # 전저점 이탈 (20일 최저가 이탈)
  if close < technicalData.low20:
    score += 8

  # 장대음봉 (종가 - 시가) / 시가 < -3%
  candleDropPct = (close - technicalData.openPrice) / technicalData.openPrice * 100
  if candleDropPct <= -3.0:
    score += 6

  return min(score, 20)
```

#### 트리거 6: 리밸런싱 (`overweightScore`, 최대 10점)

```
function calcOverweightScore(position, portfolio, sectorWeights):
  score = 0
  positionPct = position.currentValue / portfolio.totalValue * 100

  # 단일 종목 비중 초과
  if positionPct > portfolio.maxSinglePositionPct:  # 예: 10%
    excess = positionPct - portfolio.maxSinglePositionPct
    score += min(int(excess / 2) * 2, 8)  # 초과 2%당 +2점, 최대 8점

  # 섹터 비중 초과
  sectorPct = sectorWeights.get(position.sector, 0)
  if sectorPct > portfolio.maxSectorPct:            # 예: 30%
    score += 2

  return min(score, 10)
```

#### 긍정 모멘텀 보너스 감산 (`positiveMomentumBonus`, 최대 20점 감산)

```
function calcPositiveMomentumBonus(position, technicalData, disclosureEvents):
  bonus = 0

  # 시장 대비 초과수익 지속
  excessReturn5d = calcExcessReturn(position, days=5)
  if excessReturn5d > 5:  bonus += 8
  elif excessReturn5d > 2: bonus += 4

  # 거래량 지속 증가 (최근 3일 평균 > 20일 평균 × 1.5)
  if technicalData.volumeRatio3d > 1.5:
    bonus += 6

  # MA20 위에서 상승 추세 유지
  if technicalData.closePrice > technicalData.ma20 and technicalData.ma20 > technicalData.ma20Prev:
    bonus += 4

  # 긍정 신규 공시 (같은 종목 호재 공시)
  if any(e.polarity == 'POSITIVE' for e in disclosureEvents if e.daysAgo <= 3):
    bonus += 2

  return min(bonus, 20)
```

---

### 4-4. 하루 3회 점검 스케줄러

```typescript
// exit-engine.scheduler.ts

// PRE_MARKET: 장 시작 전 08:30 (전날 종가 기준 일괄 점검)
@Cron('30 8 * * 1-5', { timeZone: 'Asia/Seoul' })
async checkPreMarket() {
  await this.exitEngineService.runDailyCheck('PRE_MARKET');
}

// INTRADAY: 장중 13:00 (현재가 기준 긴급 손절·급락 감지)
@Cron('0 13 * * 1-5', { timeZone: 'Asia/Seoul' })
async checkIntraday() {
  await this.exitEngineService.runDailyCheck('INTRADAY');
}

// POST_MARKET: 장 마감 후 16:00 (종가 확정 기준 종합 점검 + 스냅샷 저장)
@Cron('0 16 * * 1-5', { timeZone: 'Asia/Seoul' })
async checkPostMarket() {
  await this.exitEngineService.runDailyCheck('POST_MARKET');
  await this.exitEngineService.savePortfolioRiskSnapshots();
}
```

#### 점검 시간대별 체크 항목

| 시간대 | 체크 항목 |
|--------|-----------|
| **장 시작 전 (PRE_MARKET)** | 전일 종가 기준 하드 스탑 도달 여부 / 신규 악재 공시(전일 장 마감 후~당일 08:20) / 투자논리 훼손 조건 재평가 / 리밸런싱 비중 초과 |
| **장중 (INTRADAY)** | 현재가 기준 하드 스탑·ATR 스탑 이탈 / VWAP 이탈 / 장중 급락(−3% 이상) 실시간 감지 / 장중 돌발 공시(CONTRACT_CANCELLATION 등) |
| **장 마감 후 (POST_MARKET)** | 종가 확정 기준 Exit Score 전 항목 종합 산출 / MA5·MA20·전저점 이탈 / 시간 제한 평가 / `PositionDailySnapshot` 저장 / `PortfolioRiskSnapshot` 생성 / REDUCE·EXIT 신호 → 사용자 푸시 알림 발송 |

---

### 4-5. `ExitEngineService` 핵심 메서드 시그니처

```typescript
// exit-engine.service.ts

export class ExitEngineService {

  // 전체 오픈 포지션 일괄 점검
  async runDailyCheck(checkTime: 'PRE_MARKET' | 'INTRADAY' | 'POST_MARKET'): Promise<void>

  // 단일 포지션 Exit Score 산출 (외부 호출 가능)
  async evaluatePosition(
    positionId: string,
    checkTime: string,
  ): Promise<ExitSignalDto>

  // Exit Score 구성 요소 계산 (내부)
  private calcLossRiskScore(position: Position, priceData: PriceData): number
  private calcThesisBreakScore(position: Position, thesis: PositionThesis, events: DisclosureEvent[]): Promise<number>
  private calcChartBreakScore(position: Position, techData: TechnicalData): number
  private calcDisclosureRiskScore(position: Position, recentEvents: DisclosureEvent[]): number
  private calcOverweightScore(position: Position, portfolio: Portfolio): number
  private calcTimeExceededScore(position: Position, thesis: PositionThesis, marketData: MarketData): number
  private calcPositiveMomentumBonus(position: Position, techData: TechnicalData, events: DisclosureEvent[]): number

  // 포트폴리오 위험 스냅샷 저장 (POST_MARKET 한정)
  async savePortfolioRiskSnapshots(): Promise<void>

  // 하드룰 위반 체크 (AI 금지 영역 — 룰 엔진 전용)
  // 위반 시 BLOCK_REBUY 강제, 알림 발송
  private checkHardRules(portfolio: Portfolio, riskSnapshot: PortfolioRiskSnapshot): boolean
}
```

---

### 4-6. REST API 엔드포인트

```typescript
// portfolio.controller.ts

// ── 포트폴리오 관리 ──────────────────────────────────
POST   /portfolio
  Body: CreatePortfolioDto
  → PortfolioDto

GET    /portfolio
  → PortfolioSummaryDto[]  // 사용자의 전체 포트폴리오 목록

GET    /portfolio/:id
  → PortfolioDetailDto     // 포지션 목록 + 위험 지표 포함

// ── 포지션 관리 ──────────────────────────────────────
POST   /portfolio/:id/positions
  Body: OpenPositionDto    // corpCode, stockCode, entryDate, entryPrice, quantity
  → PositionDto

GET    /portfolio/:id/positions
  Query: ?status=OPEN      // OPEN | CLOSED | PARTIAL
  → PositionDto[]

PATCH  /portfolio/:id/positions/:positionId
  Body: UpdatePositionDto  // currentPrice, quantity (일부 매도 시 수량 갱신)
  → PositionDto

// ── Exit Signal ───────────────────────────────────────
POST   /portfolio/:id/positions/:positionId/evaluate
  → ExitSignalDto          // 즉시 Exit Score 산출 (온디맨드)

GET    /portfolio/:id/positions/:positionId/exit-signals
  Query: ?limit=10
  → ExitSignalDto[]

PATCH  /portfolio/:id/positions/:positionId/exit-signals/:signalId/acknowledge
  Body: { userAction: 'AGREED_EXIT' | 'OVERRIDDEN_HOLD' | 'PARTIAL_EXIT' }
  → ExitSignalDto

// ── 포트폴리오 위험 스냅샷 ────────────────────────────
GET    /portfolio/:id/risk-snapshots
  Query: ?from=YYYYMMDD&to=YYYYMMDD
  → PortfolioRiskSnapshotDto[]
```

---

### 4-7. AI 사용 정책 (Phase 8)

#### AI 사용 위치: `thesisBreakScore` 계산 시 보조(L2)

`PositionThesis.invalidConditions` 항목 중 **Rule(이벤트 타입·수치 비교)로 판단 불가한 문장**에 한해 AI를 호출한다.

```json
// AI 입력 (최소화)
{
  "invalidCondition": "공시 후 5거래일 내 거래량 급감",
  "recentVolumeData": [{ "date": "20260528", "volumeRatio": 0.42 }, ...],
  "question": "이 조건이 현재 데이터 기준으로 충족(훼손)되었는가? true/false와 근거 1문장만 반환"
}

// AI 출력
{
  "triggered": true,
  "reason": "공시 후 5거래일 평균 거래량이 공시 전 20일 평균의 42%로 급감 확인"
}
```

**AI 금지 영역 (Phase 8에서 절대 불가):**
| 금지 항목 | 이유 |
|-----------|------|
| 최종 주문 승인 | Risk Engine 전용 |
| 손절·익절 % 하드룰 결정 | Portfolio.stopLossPct는 사용자 입력값, AI 변경 불가 |
| 포트폴리오 비중 한도 변경 | maxSinglePositionPct 등 하드룰은 AI 접근 금지 |
| 주문 수량 산정 | Phase 13(반자동) 이전 전면 금지 |
| Exit Score 최종 액션 결정 | 공식 기반 Rule Engine 전용, AI 개입 불가 |

AI 호출 시 반드시 `AIUsageLog` 기록 (Level L2, Phase 11 비용 통제 연동).

---

## 5. 작업 분해

### DB / 스키마

- [ ] `Portfolio` 모델 추가 (`portfolios` 테이블, 한도 필드 포함)
- [ ] `Position` 모델 추가 (`positions` 테이블, `PositionStatus` enum 포함)
- [ ] `PositionDailySnapshot` 모델 추가 (`position_daily_snapshots`)
- [ ] `ExitSignal` 모델 추가 (`exit_signals`, `ExitTriggerType`·`ExitAction` enum)
- [ ] `PortfolioRiskSnapshot` 모델 추가 (`portfolio_risk_snapshots`)
- [ ] `User` 모델에 `portfolios Portfolio[]` relation 추가
- [ ] `Company` 모델에 `positions Position[]` relation 추가
- [ ] `Disclosure` 모델에 `exitSignals ExitSignal[]` relation 추가
- [ ] `npx prisma migrate dev --name phase08-portfolio-exit-engine` 실행 및 검증

### NestJS 모듈 구축

- [ ] `backend/src/portfolio/portfolio.module.ts` 생성 (PrismaModule, ScheduleModule import)
- [ ] `PortfolioService` 구현: CRUD + 포지션 관리
- [ ] `ExitEngineService` 구현: 6종 트리거 점수 계산 메서드 전체
- [ ] `ExitEngineScheduler` 구현: 3개 cron (PRE_MARKET·INTRADAY·POST_MARKET, KST 보장)
- [ ] `PortfolioController` 구현: 위 9개 엔드포인트 전체 + Swagger 데코레이터
- [ ] `AppModule`에 `PortfolioModule` 등록

### Exit Score 로직 구현

- [ ] `calcLossRiskScore`: 하드스탑·ATR·트레일링·포트폴리오 손실한도 연산
- [ ] `calcThesisBreakScore`: Rule 매칭 + AI 보조 (L2) + `AIUsageLog` 기록
- [ ] `calcChartBreakScore`: MA5·MA20·VWAP·전저점·장대음봉 연산
- [ ] `calcDisclosureRiskScore`: 신규 공시 이벤트 타입별 점수 테이블 적용
- [ ] `calcOverweightScore`: 단일 종목·섹터 비중 초과 연산
- [ ] `calcTimeExceededScore`: 보유기간·초과수익·거래량 추이 연산
- [ ] `calcPositiveMomentumBonus`: 초과수익·거래량·추세·공시 호재 감산 연산
- [ ] `determineAction`: Exit Score → ExitAction 매핑 + BLOCK_REBUY 조건 처리
- [ ] `checkHardRules`: 포트폴리오 한도 위반 시 BLOCK_REBUY 강제 (AI 금지 영역 명확화)

### 스냅샷 & 알림

- [ ] POST_MARKET 점검 후 `PositionDailySnapshot` upsert 저장
- [ ] POST_MARKET 점검 후 `PortfolioRiskSnapshot` upsert 저장
- [ ] `exitAction`이 REDUCE·EXIT·BLOCK_REBUY인 경우 Expo Push 알림 발송 연동

### 테스트

- [ ] `calcLossRiskScore` 단위 테스트: 하드스탑 도달·ATR 이탈·트레일링 시나리오 각 1건
- [ ] `calcChartBreakScore` 단위 테스트: MA20 이탈 + 장대음봉 복합 시나리오
- [ ] `calcThesisBreakScore` 단위 테스트: invalidConditions 1·2·3개 위반 시 점수 검증
- [ ] `ExitEngineService.evaluatePosition` 통합 테스트: 전체 score 합산 정확성
- [ ] `checkHardRules` 단위 테스트: maxDailyLossPct 초과 시 hardRuleBreached=true 확인
- [ ] `POST /portfolio/:id/positions/:positionId/evaluate` E2E 테스트

### 문서 / 운영

- [ ] `docs/database-schema.md` — 5개 신규 모델 추가
- [ ] `docs/api-specification.md` — 9개 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` — `backend/src/portfolio/` 디렉터리 트리 추가
- [ ] `NEXT_STEPS.md` — Phase 8 완료 항목 `[x]` 처리

---

## 6. AI 사용 정책

| 영역 | AI 사용 여부 | Level | 입력 | 출력 |
|------|-------------|-------|------|------|
| `thesisBreakScore` — Rule 불가 조건 | 보조 (선택) | L2 | invalidCondition 문장 + 최소 수치 데이터 | `{ triggered: bool, reason: string }` |
| 보유 논리 유지 여부 자연어 설명 (`aiExplanation`) | 보조 | L2 | 훼손 근거 요약 | 1~2문장 |
| Exit Score 최종 액션 결정 | **AI 금지** | — | — | — |
| 손절·익절 % 결정 | **AI 금지** | — | — | — |
| 포트폴리오 한도 결정 | **AI 금지** | — | — | — |
| 주문 수량·타이밍 결정 | **AI 금지** | — | — | — |

비전 원칙 §4: AI 금지 영역은 "최종 주문 승인 / 손절·익절 하드 룰 / 포트폴리오 한도 / 주문 수량 결정 / 리스크 룰 우회". Phase 8에서 이를 구현 레벨로 명확히 분리한다.

---

## 7. 비용·성능 고려사항

| 항목 | 내용 |
|------|------|
| 하루 3회 점검 대상 | 포지션 수 × 3회. 초기 MVP 50종목 이하 기준 무부하. 500종목 이상 시 청크 병렬 처리 필요 |
| KIS/증권사 OpenAPI Rate Limit | 초당 수십 건 제한. 포지션 현재가 조회는 청크 단위(10~20종목) 배치 호출 + delay 삽입 |
| `PositionDailySnapshot` 증가율 | 포지션 1개당 거래일 약 250행/년. 1,000 포지션 × 2년 = 50만 행 — 인덱스 유지로 충분 |
| AI 호출 비용 | `thesisBreakScore` AI 보조는 포지션당 최대 1회/일. 조건 Rule로 100% 커버되면 AI 미호출. 초기 AI호출/일 ≤ 보유종목 수 × 0.3 목표 |
| 알림 발송 | REDUCE·EXIT 신호 중복 알림 방지: 동일 positionId × checkTime × exitAction 중복 체크 |
| PortfolioRiskSnapshot | 포트폴리오당 1행/일. 운영 부하 없음 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Phase 5·7 미완료 상태에서 Phase 8 실행 | `technicalData`·`thesis` null → 차트·논리훼손 점수 계산 불가 | null guard: 선행 데이터 없으면 해당 점수 0점으로 처리, 점검 결과에 `dataMissing: true` 플래그 기록 |
| 현재가 API 장애 | INTRADAY 점검 실패 | 마지막 성공 시세 사용 + `stalePriceWarning` 플래그 추가, 점수 산출 계속 |
| 장 중 돌발 공시 → 즉각 EXIT 필요 | INTRADAY cron(13:00)까지 지연 | 공시 수집 스케줄러(Phase 1) 콜백에서 보유종목 악재 공시 감지 시 즉시 `evaluatePosition` 호출 |
| 트레일링 스탑 오작동 | 고점 기록 누락 시 잘못된 감산 | `highestPrice` 갱신 시 `highestAt` 함께 저장, 30거래일 이상 고점 미갱신 시 경고 |
| 포트폴리오 한도 하드룰 위반 시 AI 개입 시도 | 비전 원칙 위반 | `checkHardRules` 메서드는 AI 의존성 없음. DI 구조상 AI 서비스 주입 금지 (`@Inject` 차단) |
| 사용자가 `OVERRIDDEN_HOLD`로 EXIT 무시 | 손실 확대 | 무시 횟수 누적(`overrideCount`), 3회 이상 무시 시 PRE_MARKET 재알림 |
| 비거래일(주말·공휴일) cron 실행 | 시세 없음 | `checkTradingDay()` 선행 — 비거래일이면 즉시 return |
| `PositionThesis.invalidConditions`가 비어있음 | `thesisBreakScore` = 0 강제 | 점검 결과에 `thesisMissing: true` 기록, 사용자에게 Thesis 입력 유도 알림 |

---

## 9. 완료 기준 (DoD)

| 항목 | 검증 방법 |
|------|-----------|
| 5개 신규 Prisma 모델 마이그레이션이 개발·스테이징 DB에 적용됨 | `prisma migrate status` green |
| `POST /portfolio/:id/positions/:positionId/evaluate` 호출 시 `exitScore`·`exitAction`·`scoreDetail` 반환 | Swagger UI 수동 확인 |
| 하드 스탑(-7%) 도달 포지션 → `lossRiskScore=20`, `exitAction=EXIT` 확정 | 단위 테스트 |
| MA20 이탈 + 전저점 이탈 복합 → `chartBreakScore >= 18` | 단위 테스트 |
| `invalidConditions` 2개 이상 위반 → `thesisBreakScore >= 14` | 단위 테스트 |
| PRE_MARKET·INTRADAY·POST_MARKET 3개 cron이 KST 기준 올바른 시각에 실행됨 | 로그 확인 |
| POST_MARKET 점검 후 `PositionDailySnapshot` 및 `PortfolioRiskSnapshot`이 생성됨 | DB 직접 조회 |
| REDUCE·EXIT 신호 발생 시 사용자에게 Expo Push 알림이 발송됨 | 테스트 디바이스 확인 |
| `checkHardRules`가 `maxDailyLossPct` 초과 시 `hardRuleBreached=true` + BLOCK_REBUY 설정 | 단위 테스트 |
| AI 호출이 `thesisBreakScore` 보조 한정임을 코드 리뷰로 확인 | PR 체크리스트 |
| `docs/database-schema.md`, `docs/api-specification.md`, `PROJECT_STRUCTURE.md` 업데이트 완료 | 문서 리뷰 |
