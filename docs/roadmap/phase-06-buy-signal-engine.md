> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 6 — 매수 Signal Engine

> 작성일: 2026-06-02 · 상태: 설계 준비 완료(미착수) · AI 사용: **보조(Persona 적합도 해석)** · 선행 Phase: Phase 3·4·5

---

## 1. 목적 & 범위

### 목적

Phase 3(이벤트 수치), Phase 4(AI 정성 분석), Phase 5(시세·차트·수급)가 각각 생성한 신호를 **단일 Buy Score**로 합산하고, 신호 등급·진입 조건·리스크 팩터를 담은 `TradingSignal` 레코드를 생성한다. 이 레코드가 Phase 7 `PositionThesis` 저장의 입력이 된다.

**가장 중요한 설계 원칙:** 이 Engine은 **매수 후보 리포트를 생성하는 곳에서 멈춘다.** 자동 주문·자동 체결·포트폴리오 반영은 Phase 13~14까지 금지다.

### 포함 범위

- Buy Score 7개 컴포넌트 점수화 및 가중치(config화)
- 리스크 패널티 계산
- 신호 등급 산정(5단계)
- 진입 조건(EntryCondition) 평가
- `TradingSignal` Prisma 모델 및 마이그레이션
- NestJS `BuySignalModule` — 서비스·컨트롤러·엔드포인트
- 매수 후보 리포트 생성(Push 알림 + 모바일 피드)

### 제외 범위

- 자동 주문 실행 → Phase 13~14 (절대 금지)
- Position 생성·포트폴리오 반영 → Phase 7~8
- 백테스트 기반 가중치 최적화 → Phase 10 이후
- AI가 최종 매수 여부를 단독으로 결정하는 구조 → 영구 금지

---

## 2. 현재 코드베이스 연결점

| 파일/모듈 | 역할 | Phase 6 연결 방식 |
|-----------|------|-------------------|
| `backend/prisma/schema.prisma` | `Disclosure`(rcpNo PK), `Company`(corpCode PK) | `TradingSignal`의 FK 기준 |
| Phase 3 산출물 `DisclosureEvent` | 이벤트 타입·핵심 수치(JSON) | 컴포넌트 ①② 입력 |
| Phase 4 산출물 `DisclosureAnalysis` | AI Persona 해석·polarity·positiveFactors | 컴포넌트 ③ 입력 |
| Phase 5 산출물 `TechnicalIndicator`, `StockDailyPrice` | 기술지표·현재가·거래량 | 컴포넌트 ④⑤⑥⑦ 입력 |
| `backend/src/notifications/` | 알림 발송 서비스 | 강한 매수후보(80↑) 시 Push 연동 |
| `WatchList` 모델 | 관심 종목 목록 | 신호 생성 대상 필터 기준 |

---

## 3. 선행 조건 & 의존성

| 항목 | 이유 |
|------|------|
| **Phase 3 완료** (`DisclosureEvent` + 수치 JSON) | 이벤트 점수·핵심 수치 점수의 직접 입력 |
| **Phase 4 완료** (`DisclosureAnalysis` + Persona 해석 JSON) | Persona 적합도 점수 입력 |
| **Phase 5 완료** (`TechnicalIndicator`, `StockDailyPrice`) | 차트·거래량·시장 분위기 점수 입력 |
| Phase 9 `EventStudyResult` (선택) | 과거 유사 공시 성과 컴포넌트. 미완료 시 해당 컴포넌트 0점 처리 후 가중치 재배분 |
| 증권사 현재가 API(KIS 등) 설정 | Phase 5 의존. 실시간 진입 조건 평가에 필요 |
| `AIUsageLog` (Phase 11 선행 권장) | AI 비용 기록 구조. 없으면 로컬 로그로 대체 가능 |

---

## 4. 상세 설계

### 4-1. Buy Score 공식

```
Buy Score =
  W1 × DisclosureEventScore        (공시 이벤트 점수)
+ W2 × KeyMetricScore              (핵심 수치 점수)
+ W3 × PersonaFitScore             (Persona 적합도)
+ W4 × HistoricalEventScore        (과거 유사 공시 성과)
+ W5 × ChartScore                  (현재 차트 점수)
+ W6 × VolumeLiquidityScore        (거래량·수급 점수)
+ W7 × MarketSectorScore           (시장·업종 분위기)
− RiskPenalty                      (리스크 패널티, 양수 값)
```

**기본 가중치 (config화, `buy-signal.config.ts`)**

```typescript
// buy-signal.config.ts
export const BUY_SCORE_WEIGHTS = {
  disclosureEvent:   0.25,  // W1
  keyMetric:         0.20,  // W2
  personaFit:        0.15,  // W3
  historicalEvent:   0.10,  // W4 — Phase 9 미완료 시 0 & 나머지 재배분
  chart:             0.15,  // W5
  volumeLiquidity:   0.10,  // W6
  marketSector:      0.05,  // W7
} as const;

// 점수 범위: 각 컴포넌트는 [-100, 100] 스케일
// Buy Score = 가중합 후 소수점 버림 (정수 반환)
```

---

### 4-2. 컴포넌트별 점수화 방식

#### C1. 공시 이벤트 점수 (DisclosureEventScore)

**입력:** `DisclosureEvent.eventType`, `DisclosureEvent.polarity`

```typescript
// 이벤트 타입 기본 점수 맵 (config화)
const EVENT_BASE_SCORES: Record<string, number> = {
  SUPPLY_CONTRACT:           70,
  SHARE_BUYBACK:             65,
  SHARE_CANCELLATION:        80,
  DIVIDEND_INCREASE:         60,
  EARNINGS_SURPRISE:         75,
  PAID_IN_CAPITAL_INCREASE: -50,   // 희석 효과 기본값
  THIRD_PARTY_ALLOTMENT:    -60,
  CB_ISSUANCE:              -40,
  BW_ISSUANCE:              -35,
  EARNINGS_SHOCK:           -80,
  CONTRACT_CANCELLATION:    -70,
  AUDIT_OPINION_RISK:       -90,
  TRADING_SUSPENSION:      -100,
  DELISTING_RISK:          -100,
  LAWSUIT:                  -30,
  MAJOR_SHAREHOLDER_CHANGE:  10,   // 사안에 따라 상이 → C3 Persona가 보정
};

// polarity 보정 (AI Phase 4 결과)
function applyPolarityAdjust(baseScore: number, polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED'): number {
  if (polarity === 'NEGATIVE') return baseScore * 0.5;   // 부정 판단 시 절반
  if (polarity === 'MIXED')    return baseScore * 0.7;
  return baseScore;  // POSITIVE: 그대로
}

function calcDisclosureEventScore(event: DisclosureEvent, analysis: DisclosureAnalysis): number {
  const base = EVENT_BASE_SCORES[event.eventType] ?? 0;
  const adjusted = applyPolarityAdjust(base, analysis.polarity);
  return clamp(adjusted, -100, 100);
}
```

---

#### C2. 핵심 수치 점수 (KeyMetricScore)

**입력:** `DisclosureEvent.metricsJson` (Phase 3 산출물)

```typescript
// 이벤트 타입별 수치 평가 함수 (의사코드)

function calcKeyMetricScore(event: DisclosureEvent): number {
  const m = event.metricsJson;

  switch (event.eventType) {

    case 'SUPPLY_CONTRACT':
      // salesRatio = contractAmount / recentSales * 100
      const ratio = m.salesRatio;
      if (ratio >= 30) return 100;
      if (ratio >= 20) return 80;
      if (ratio >= 10) return 60;
      if (ratio >=  5) return 40;
      if (ratio >=  1) return 20;
      return 0;  // 1% 미만 — 의미 없는 소규모 계약

    case 'SHARE_CANCELLATION':
      // cancellationRatio = cancelledShares / totalShares * 100
      const cr = m.cancellationRatio;
      if (cr >= 5)  return 100;
      if (cr >= 3)  return 80;
      if (cr >= 1)  return 60;
      return 30;

    case 'DIVIDEND_INCREASE':
      // yoyDividendGrowth (%) : 전년 대비 배당 증가율
      const dy = m.yoyDividendGrowth;
      if (dy >= 50) return 100;
      if (dy >= 20) return 70;
      if (dy >=  5) return 40;
      return 10;

    case 'PAID_IN_CAPITAL_INCREASE':
      // dilutionRate (%)
      const dr = m.dilutionRate;
      if (dr >= 30) return -100;
      if (dr >= 20) return -80;
      if (dr >= 10) return -60;
      if (dr >=  5) return -40;
      return -20;

    case 'CB_ISSUANCE':
      // fundingAmount relative to marketCap
      const cbRatio = m.fundingAmount / m.marketCap * 100;
      if (cbRatio >= 20) return -80;
      if (cbRatio >= 10) return -50;
      return -20;

    case 'EARNINGS_SURPRISE':
      // surpriseRate = (actualEPS - estimatedEPS) / |estimatedEPS| * 100
      const sr = m.surpriseRate;
      if (sr >= 30) return 100;
      if (sr >= 15) return 70;
      if (sr >=  5) return 40;
      return 10;

    default:
      return 0;  // 수치 평가 불가 이벤트
  }
}
```

---

#### C3. Persona 적합도 (PersonaFitScore)

**입력:** `DisclosureAnalysis.personaViews[]` (Phase 4 AI 출력 JSON)

```typescript
// Persona 우선순위 맵 (사용자 설정 Persona 기준)
// personaViews의 각 항목: { persona, view: 'POSITIVE'|'NEUTRAL'|'NEGATIVE'|'WATCH', reason }

const VIEW_SCORE: Record<string, number> = {
  POSITIVE: 100,
  WATCH:     40,
  NEUTRAL:    0,
  NEGATIVE: -60,
};

function calcPersonaFitScore(
  personaViews: PersonaView[],
  userPersona: string,  // 'GROWTH' | 'VALUE' | 'MOMENTUM' | 'EVENT_DRIVEN'
): number {
  const matched = personaViews.find(v => v.persona === userPersona);
  if (!matched) return 0;
  return VIEW_SCORE[matched.view] ?? 0;
}

// NOTE: AI 금지 영역
// 이 함수는 AI가 생성한 personaViews를 점수로 변환하는 Rule 함수다.
// AI가 "PersonaFitScore = X"를 직접 결정하는 구조는 허용하지 않는다.
```

---

#### C4. 과거 유사 공시 성과 (HistoricalEventScore)

**입력:** `EventStudyResult` (Phase 9 산출물) — 미완료 시 0점

```typescript
function calcHistoricalEventScore(
  eventType: string,
  subCategory: string,  // 예: 'salesRatio_20pct_above'
): number {
  const result = await eventStudyRepo.findBest(eventType, subCategory);
  if (!result) return 0;  // Phase 9 미완료 or 표본 부족

  // D+5 평균 초과수익 기반 스케일
  const ar5 = result.avgAbnormalReturn5d;  // 단위: %
  if (ar5 >= 10) return 100;
  if (ar5 >=  5) return 70;
  if (ar5 >=  2) return 40;
  if (ar5 >=  0) return 10;
  if (ar5 >= -3) return -30;
  return -70;
}
```

---

#### C5. 현재 차트 점수 (ChartScore)

**입력:** `TechnicalIndicator` (Phase 5 산출물)

```typescript
// 각 조건은 true=1, false=0 (바이너리 체크)
// 가중 합산 후 [-100, 100] 정규화

const CHART_RULES = [
  { check: (t) => t.closePrice > t.ma20,         weight: 20,  label: '20일선 위' },
  { check: (t) => t.closePrice > t.ma60,         weight: 15,  label: '60일선 위' },
  { check: (t) => t.rsi14 < 70,                  weight: 10,  label: 'RSI 과열 미도달' },
  { check: (t) => t.rsi14 > 30,                  weight: 10,  label: 'RSI 과매도 아님' },
  { check: (t) => t.macdLine > t.macdSignal,     weight: 15,  label: 'MACD 골든크로스' },
  { check: (t) => t.closePrice > t.bollingerMid, weight: 10,  label: 'BB 중심선 위' },
  // 패널티 조건 (음수 기여)
  { check: (t) => t.closePrice < t.ma5,          weight: -20, label: '5일선 아래' },
  { check: (t) => t.priorGain5d > 15,            weight: -30, label: '5일 15%↑ 선행 급등' },
];

function calcChartScore(indicator: TechnicalIndicator): number {
  const maxPos = CHART_RULES.filter(r => r.weight > 0).reduce((s, r) => s + r.weight, 0); // 80
  const raw = CHART_RULES.reduce((s, r) => s + (r.check(indicator) ? r.weight : 0), 0);
  return clamp(Math.round((raw / maxPos) * 100), -100, 100);
}
```

---

#### C6. 거래량·수급 점수 (VolumeLiquidityScore)

**입력:** `StockDailyPrice.volume`, `StockDailyPrice.tradingValue`, `TechnicalIndicator`

```typescript
function calcVolumeLiquidityScore(today: StockDailyPrice, avg20: VolumeStat): number {
  const volRatio = today.volume / avg20.avgVolume;       // 오늘 거래량 / 20일 평균
  const tvRatio  = today.tradingValue / avg20.avgValue;  // 거래대금 비율

  // 최소 유동성 기준 (거래대금 < 10억 → 매매 불가 판정)
  if (today.tradingValue < 1_000_000_000) return -100;

  let score = 0;
  // 거래량 급증
  if (volRatio >= 5) score += 100;
  else if (volRatio >= 3) score += 70;
  else if (volRatio >= 2) score += 40;
  else if (volRatio >= 1) score += 10;
  else score -= 20;  // 감소

  // 거래대금 보정
  if (tvRatio < 1) score -= 10;

  return clamp(score, -100, 100);
}
```

---

#### C7. 시장·업종 분위기 점수 (MarketSectorScore)

**입력:** Phase 5 수집 시장지수(`KOSPI`/`KOSDAQ`), 업종 지수

```typescript
function calcMarketSectorScore(market: MarketSnapshot): number {
  let score = 0;

  // 시장지수 방향
  if (market.kospiChange1d > 1.0)  score += 30;
  else if (market.kospiChange1d > 0) score += 10;
  else if (market.kospiChange1d < -2.0) score -= 40;
  else if (market.kospiChange1d < -1.0) score -= 20;

  // 업종 분위기
  if (market.sectorChange1d > 1.5)  score += 30;
  else if (market.sectorChange1d > 0) score += 10;
  else if (market.sectorChange1d < -2.0) score -= 30;

  // 공포지수/급락장 패널티
  if (market.vixEquivalent > 30) score -= 30;

  return clamp(score, -100, 100);
}
```

---

#### 리스크 패널티 (RiskPenalty)

**항상 양수 값으로 Buy Score에서 차감**

```typescript
function calcRiskPenalty(event: DisclosureEvent, stock: StockStatus): number {
  let penalty = 0;

  // 하드 차단 조건 (점수와 무관하게 신호 생성 자체를 BLOCKED로 전환)
  const BLOCK_CONDITIONS = [
    stock.tradingStatus === 'SUSPENDED',       // 거래정지
    stock.status === 'MANAGEMENT',             // 관리종목
    stock.status === 'INVESTMENT_CAUTION',     // 투자주의
    stock.status === 'DELISTING_ALERT',        // 상장폐지 위험
    event.eventType === 'AUDIT_OPINION_RISK',
    event.eventType === 'TRADING_SUSPENSION',
  ];
  if (BLOCK_CONDITIONS.some(Boolean)) return Infinity;  // 신호 BLOCKED

  // 누적 패널티
  if (stock.priorGain5d > 20)  penalty += 40;   // 5일 20%↑ 급등 후 공시
  if (stock.priorGain5d > 10)  penalty += 20;
  if (event.isAmendment)       penalty += 15;   // 정정공시 신뢰도 할인
  if (event.isContractCancel)  penalty += 50;
  if (event.eventType === 'PAID_IN_CAPITAL_INCREASE' && event.metricsJson.dilutionRate > 15)
                               penalty += 30;
  if (stock.avgDailyVolume < 100_000) penalty += 20;  // 저유동성

  return clamp(penalty, 0, 100);
}
```

---

### 4-3. Buy Score 통합 계산 (의사코드)

```typescript
async function calcBuyScore(
  event: DisclosureEvent,
  analysis: DisclosureAnalysis,
  indicator: TechnicalIndicator,
  stockStatus: StockStatus,
  userPersona: string,
): Promise<BuyScoreResult> {

  // 리스크 패널티 선행 계산 (Infinity = 조기 차단)
  const penalty = calcRiskPenalty(event, stockStatus);
  if (penalty === Infinity) {
    return { buyScore: -100, signal: 'BLOCKED', blockedReason: '매매 불가 종목 조건' };
  }

  const W = BUY_SCORE_WEIGHTS;
  const components = {
    disclosureEvent:  calcDisclosureEventScore(event, analysis),
    keyMetric:        calcKeyMetricScore(event),
    personaFit:       calcPersonaFitScore(analysis.personaViews, userPersona),
    historicalEvent:  await calcHistoricalEventScore(event.eventType, event.subCategory),
    chart:            calcChartScore(indicator),
    volumeLiquidity:  calcVolumeLiquidityScore(stockStatus.todayPrice, stockStatus.avg20),
    marketSector:     calcMarketSectorScore(stockStatus.market),
  };

  const weightedSum =
    W.disclosureEvent * components.disclosureEvent +
    W.keyMetric       * components.keyMetric +
    W.personaFit      * components.personaFit +
    W.historicalEvent * components.historicalEvent +
    W.chart           * components.chart +
    W.volumeLiquidity * components.volumeLiquidity +
    W.marketSector    * components.marketSector;

  const buyScore = Math.round(clamp(weightedSum - penalty, -100, 100));

  return {
    buyScore,
    signal: mapScoreToSignal(buyScore),
    components,
    penalty,
  };
}
```

---

### 4-4. 신호 등급

```typescript
type SignalGrade =
  | 'STRONG_BUY_CANDIDATE'  // 80 이상
  | 'BUY_CANDIDATE'         // 60 ~ 79
  | 'WATCH'                 // 30 ~ 59
  | 'NEUTRAL'               // -29 ~ 29
  | 'AVOID'                 // -30 이하
  | 'BLOCKED';              // 하드 차단 (거래정지 등)

function mapScoreToSignal(score: number): SignalGrade {
  if (score >= 80)  return 'STRONG_BUY_CANDIDATE';
  if (score >= 60)  return 'BUY_CANDIDATE';
  if (score >= 30)  return 'WATCH';
  if (score >= -29) return 'NEUTRAL';
  return 'AVOID';
}
```

---

### 4-5. 진입 조건 평가 (EntryCondition)

진입 조건은 **점수 계산과 독립된 체크리스트**다. Buy Score가 높아도 진입 조건이 미충족이면 `entryReady = false`로 표시된다.

```typescript
const ENTRY_CONDITION_RULES: EntryConditionRule[] = [
  {
    id:    'ABOVE_MA20',
    label: '현재가가 20일 이동평균선 위',
    check: (i) => i.closePrice > i.ma20,
    required: true,  // 필수 조건
  },
  {
    id:    'VOLUME_SURGE_300',
    label: '공시 후 거래량 20일 평균 대비 300% 이상',
    check: (i, s) => (s.todayVolume / s.avg20Volume) >= 3.0,
    required: false,  // 선택 조건 (충족 시 신뢰도 상승)
  },
  {
    id:    'BREAK_PREV_HIGH',
    label: '전일 고가 돌파(장중 확인)',
    check: (i, s) => s.currentPrice > s.prevHighPrice,
    required: false,
  },
  {
    id:    'NOT_OVERBOUGHT',
    label: 'RSI 70 미만(과열 미도달)',
    check: (i) => i.rsi14 < 70,
    required: true,
  },
  {
    id:    'MIN_LIQUIDITY',
    label: '거래대금 10억 이상(최소 유동성)',
    check: (_, s) => s.tradingValue >= 1_000_000_000,
    required: true,
  },
];

function evaluateEntryConditions(
  indicator: TechnicalIndicator,
  stockStatus: StockStatus,
): { met: string[]; unmet: string[]; entryReady: boolean } {
  const met: string[] = [];
  const unmet: string[] = [];

  for (const rule of ENTRY_CONDITION_RULES) {
    if (rule.check(indicator, stockStatus)) {
      met.push(rule.label);
    } else {
      unmet.push(rule.label);
      if (rule.required) {
        // 필수 조건 미충족 → entryReady = false
      }
    }
  }

  const requiredUnmet = ENTRY_CONDITION_RULES
    .filter(r => r.required && unmet.includes(r.label));

  return {
    met,
    unmet,
    entryReady: requiredUnmet.length === 0,
  };
}
```

---

### 4-6. Prisma 모델 스케치

```prisma
// backend/prisma/schema.prisma 에 추가

enum SignalGrade {
  STRONG_BUY_CANDIDATE
  BUY_CANDIDATE
  WATCH
  NEUTRAL
  AVOID
  BLOCKED
}

model TradingSignal {
  id              String      @id @default(cuid())

  // 공시 연결 (자연키 FK: Disclosure.rcpNo)
  rcpNo           String
  // 종목 연결 (자연키 FK: Company.corpCode)
  corpCode        String
  stockCode       String      // 종목코드 6자리 (Company.stockCode 복사 — 조회 성능)

  // 이벤트
  eventType       String      // DisclosureEvent.eventType
  subCategory     String?     // 이벤트 세분류 (예: 'salesRatio_20pct_above')

  // Persona
  persona         String      // 'GROWTH' | 'VALUE' | 'MOMENTUM' | 'EVENT_DRIVEN'

  // Buy Score 결과
  buyScore        Int         // -100 ~ 100 (정수)
  signal          SignalGrade

  // 컴포넌트별 점수 (추적·디버깅용)
  scoreBreakdown  Json        // { disclosureEvent, keyMetric, personaFit, ... }
  riskPenalty     Int         // 차감된 패널티 합계

  // 진입 조건
  entryConditionMet    String[]   // 충족된 조건 label 목록
  entryConditionUnmet  String[]   // 미충족 조건 label 목록
  entryReady           Boolean    @default(false)

  // 리스크 요인 (human-readable)
  riskFactors          String[]

  // AI 생성 요약 (Phase 4 DisclosureAnalysis 참조)
  signalSummary        String?    // AI가 작성한 매수 근거 요약 (1~2줄)

  // 차단 사유 (signal=BLOCKED 시)
  blockedReason        String?

  // 유효 시간 (공시 발생 후 N시간 내 유효)
  validUntil           DateTime?

  // 상태
  isNotified           Boolean    @default(false)  // Push 발송 여부
  notifiedAt           DateTime?

  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt

  // Relations
  disclosure   Disclosure @relation(fields: [rcpNo],   references: [rcpNo])
  company      Company    @relation(fields: [corpCode], references: [corpCode])

  @@index([corpCode])
  @@index([stockCode])
  @@index([signal])
  @@index([rcpNo])
  @@index([createdAt])
  @@index([persona])
  @@index([entryReady])
  @@map("trading_signals")
}
```

**기존 자연키와의 FK 정합:**
- `TradingSignal.rcpNo` → `Disclosure.rcpNo` (N:1, 공시 하나에 Persona 수만큼 신호 생성 가능)
- `TradingSignal.corpCode` → `Company.corpCode` (N:1)
- `onDelete: Restrict` — 공시 삭제 시 신호도 의미 없어지므로 Cascade 고려. 초기는 Restrict(데이터 보존).

---

### 4-7. NestJS 모듈·서비스·엔드포인트

**모듈 구조**

```
backend/src/
  buy-signal/
    buy-signal.module.ts
    buy-signal.service.ts        // 점수 계산 오케스트레이터
    buy-signal.controller.ts     // 관리자 트리거 + 사용자 조회
    config/
      buy-signal.config.ts       // 가중치·임계값 config
    scoring/
      disclosure-event.scorer.ts
      key-metric.scorer.ts
      persona-fit.scorer.ts
      historical-event.scorer.ts
      chart.scorer.ts
      volume-liquidity.scorer.ts
      market-sector.scorer.ts
      risk-penalty.scorer.ts
    entry/
      entry-condition.evaluator.ts
    report/
      signal-report.builder.ts   // TradingSignal → 사용자 리포트 객체 변환
```

**서비스 시그니처**

```typescript
// buy-signal.service.ts
class BuySignalService {
  // 단건: 특정 공시 + Persona → TradingSignal 생성
  async generateSignal(
    rcpNo: string,
    persona: string,
  ): Promise<TradingSignal>

  // 배치: 새로 수집된 공시 목록 → 전체 Persona 신호 생성
  async generateSignalsForDisclosure(rcpNo: string): Promise<TradingSignal[]>

  // 조회: 매수 후보 목록 (signal IN [STRONG_BUY_CANDIDATE, BUY_CANDIDATE])
  async getBuyCandidates(
    filters: { persona?: string; minScore?: number; entryReadyOnly?: boolean },
    pagination: { page: number; limit: number },
  ): Promise<{ signals: TradingSignal[]; total: number }>

  // 조회: 특정 공시의 신호 요약
  async getSignalsByRcpNo(rcpNo: string): Promise<TradingSignal[]>

  // 유효 기간 만료 신호 정리 (cron)
  async expireStaleSignals(): Promise<number>
}
```

**컨트롤러 엔드포인트**

```typescript
// buy-signal.controller.ts

// 공시 기준 신호 수동 생성 (관리자)
POST /buy-signal/generate/:rcpNo
  Body: { personas?: string[] }    // 생략 시 전체 4 Persona
  → 200 { generated: TradingSignalDto[] }

// 매수 후보 목록 조회 (사용자/관리자)
GET /buy-signal/candidates
  ?persona=GROWTH&minScore=60&entryReadyOnly=true&page=1&limit=20
  → 200 { signals: TradingSignalDto[]; total: number; page: number }

// 특정 공시의 신호 조회 (사용자)
GET /buy-signal/by-disclosure/:rcpNo
  → 200 TradingSignalDto[]

// 신호 상세 (사용자)
GET /buy-signal/:id
  → 200 TradingSignalDetailDto  // scoreBreakdown, entryConditions 포함

// 매수 후보 리포트 (사용자 — 모바일 피드 데이터)
GET /buy-signal/report/latest
  ?persona=GROWTH&limit=10
  → 200 SignalReportDto[]

// 만료 신호 정리 수동 트리거 (관리자)
POST /buy-signal/expire
  → 200 { expired: number }
```

---

## 5. 작업 분해

### DB / 스키마
- [ ] `TradingSignal` 모델 `schema.prisma`에 추가 (`SignalGrade` enum 포함)
- [ ] `Disclosure` 모델에 `tradingSignals TradingSignal[]` 역방향 relation 추가
- [ ] `Company` 모델에 `tradingSignals TradingSignal[]` 역방향 relation 추가
- [ ] `npx prisma migrate dev --name add-trading-signal` 실행 및 커밋
- [ ] 마이그레이션 후 기존 데이터 영향 없음 확인 (신규 테이블만 추가)

### Config
- [ ] `buy-signal.config.ts` 작성 (가중치·이벤트 기본 점수 맵·진입 조건 임계값)
- [ ] 환경변수 기반 config 오버라이드 지원 (`BUY_SIGNAL_W1`, `BUY_SIGNAL_W2` 등)

### Scoring 모듈
- [ ] `disclosure-event.scorer.ts` 구현 (이벤트 기본 점수 + polarity 보정)
- [ ] `key-metric.scorer.ts` 구현 (공급계약 5종 외 확장 가능 구조)
- [ ] `persona-fit.scorer.ts` 구현 (AI personaViews → Rule 변환)
- [ ] `historical-event.scorer.ts` 구현 (Phase 9 미완료 시 0 반환 안전 처리)
- [ ] `chart.scorer.ts` 구현 (Phase 5 `TechnicalIndicator` 의존)
- [ ] `volume-liquidity.scorer.ts` 구현 (최소 거래대금 하드 차단 포함)
- [ ] `market-sector.scorer.ts` 구현 (시장지수·업종지수 방향)
- [ ] `risk-penalty.scorer.ts` 구현 (Infinity 반환으로 BLOCKED 처리)

### EntryCondition / BuySignalService
- [ ] `entry-condition.evaluator.ts` 구현 (필수·선택 조건 분리)
- [ ] `buy-signal.service.ts` 통합 오케스트레이터 구현
- [ ] `generateSignalsForDisclosure` 배치 메서드 구현 (4 Persona × 1 공시)
- [ ] `expireStaleSignals` cron 구현 (매 1시간, `validUntil < now()`)

### Report / Notification
- [ ] `signal-report.builder.ts` 구현 (TradingSignal → 사용자용 리포트 객체)
- [ ] `STRONG_BUY_CANDIDATE` 생성 시 기존 Push Notification 서비스 연동
- [ ] Push 알림 본문: `[매수후보] {corpName} — Score {buyScore}. {signalSummary}`

### Controller / Endpoint
- [ ] `buy-signal.controller.ts` 엔드포인트 6개 구현
- [ ] `JwtAuthGuard` 적용 (사용자 조회 전체) + `AdminGuard` (수동 생성·만료 트리거)
- [ ] Swagger `@ApiTags('buy-signal')`, `@ApiOperation`, `@ApiResponse` 데코레이터 작성
- [ ] `GET /buy-signal/candidates` 응답 DTO 페이지네이션 검증

### 테스트
- [ ] `disclosure-event.scorer.spec.ts`: 이벤트 타입 × polarity 매트릭스 단위 테스트
- [ ] `key-metric.scorer.spec.ts`: 5종 이벤트 × 경계값 단위 테스트
- [ ] `risk-penalty.scorer.spec.ts`: BLOCKED 조건(거래정지·관리종목 등) 단위 테스트
- [ ] `entry-condition.evaluator.spec.ts`: 필수 조건 미충족 → `entryReady=false` 검증
- [ ] `buy-signal.service.spec.ts`: 전체 점수 계산 통합 단위 테스트(mock 의존성)
- [ ] E2E: 공시 수집 → 신호 생성 → `GET /buy-signal/candidates` 응답 확인

### 문서 업데이트
- [ ] `docs/database-schema.md` — `TradingSignal` 모델 추가
- [ ] `docs/api-specification.md` — 신규 6개 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` — `backend/src/buy-signal/` 트리 추가
- [ ] `NEXT_STEPS.md` — Phase 6 완료 항목 `[x]` 처리

---

## 6. AI 사용 정책

| 항목 | 판단 |
|------|------|
| 점수 계산 자체 | **AI 미사용** — 순수 Rule 함수. AI가 Buy Score를 직접 결정하면 재현 불가 |
| `signalSummary` (1~2줄 매수 근거 요약) | **Phase 4 AI 출력 재사용** — 새 AI 호출 없음. `DisclosureAnalysis.summary` 발췌 |
| Persona 해석 변환(`PersonaFitScore`) | **Phase 4 AI 출력 → Rule 변환** — AI 추가 호출 없음 |
| 진입 조건 평가 | **AI 미사용** — 수치 조건 체크 |

**AI 금지 영역 (이 Phase 포함 전체 시스템)**

> - **최종 주문 승인**: AI가 "이 신호는 매수해도 된다"를 결정하는 것 — 절대 금지
> - **손절·익절 하드 룰**: AI가 숫자(예: -7%)를 동적으로 변경하는 것 — 금지
> - **포트폴리오 한도**: AI가 종목별 비중을 결정하는 것 — 금지
> - **주문 수량 결정**: AI가 매수 수량을 산출하는 것 — 금지
> - **리스크 룰 우회**: "이번만 예외"를 AI가 판단하는 것 — 금지

**자동매수 금지 선언:**
이 Phase는 `TradingSignal` 레코드와 후보 리포트를 생성하는 것에서 완전히 멈춘다. 생성된 신호를 기반으로 주문을 자동 실행하는 코드는 Phase 13~14 이전에는 작성하지 않는다.

---

## 7. 비용·성능 고려사항

| 항목 | 수치 목표 | 비고 |
|------|-----------|------|
| 단건 신호 생성 소요 시간 | < 200ms (p95) | AI 추가 호출 없음 — DB 조회 + 수치 연산만 |
| 공시 1건당 신호 생성 수 | 최대 4개 (Persona × 4) | 하드 차단 시 1개(BLOCKED)로 감소 |
| AI 추가 비용 | **$0** | Phase 4 결과 재사용. 새 AI 호출 없음 |
| `TradingSignal` 행 수 (1년) | 관심 50종 × 5공시/일 × 4Persona × 365 ≒ 36만 행 | 인덱스로 조회 성능 유지 |
| 만료 신호 정리 | 매 1시간 cron | `validUntil < now()` 업데이트(삭제 아님, 보존) |
| Push 알림 부하 | `STRONG_BUY_CANDIDATE`만 발송 | 관심 종목 + Persona 매칭 사용자에게만 |
| Config 변경 반영 | 앱 재시작 없이 가능 | DB/환경변수 기반 가중치로 hot-swap 설계 |
| `historicalEvent` 점수 | Phase 9 완료 전 0점 처리 | 전체 가중합에서 W4(10%)를 나머지에 비례 재배분 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Phase 5 데이터 미수집 (장마감 후 공시) | `TechnicalIndicator` null → 차트·거래량 점수 0 처리 | `null` 체크 후 0점 기본값, `riskFactors`에 "차트 데이터 없음" 기록 |
| 공시 후 3분 내 급등(선행매수) | C5 차트가 이미 이전 데이터 → 점수 과대평가 | `validUntil` 설정(공시 후 2영업일), 장중 재계산 cron 추가 |
| 동일 rcpNo + Persona 신호 중복 생성 | DB 중복 | `upsert` 사용(rcpNo + persona 복합 unique → Phase 9 고려 후 추가 여부 결정) |
| 리스크 패널티 Infinity 미처리 | 예외 전파 | `try/catch`로 잡아 `BLOCKED` 신호 저장 후 조용히 종료 |
| 가중치 합이 1.0을 초과 (config 오류) | Buy Score 범위 초과 | 서버 시작 시 config 검증, 합이 1.0±0.001 벗어나면 시작 실패 |
| Phase 9 미완료 시 historicalEvent 전체 0 | 전반적 점수 낮아짐 | W4를 다른 컴포넌트에 비례 재배분, 로그에 명시 |
| 관리종목·투자주의 종목에 WATCH 신호 생성 | 사용자 혼동 | RiskPenalty에서 Infinity 반환 → 무조건 BLOCKED. 추가로 `blockedReason` 명시 |
| 저유동성 종목(소형주) 고득점 | 실제 매수 불가 | `VolumeLiquidityScore` 거래대금 10억 미만 하드 차단 + `riskFactors` 경고 |
| Buy Score 80↑인데 entryReady=false | 신호 강도와 진입 가능성 불일치 | 리포트에 "조건 미충족 매수 대기" 명시. Score와 entryReady를 항상 함께 표시 |
| 정정공시로 이벤트 수치 변경 | 기존 신호 무효화 | `amendmentDetector`가 정정 감지 시 기존 TradingSignal `signal=AVOID`로 업데이트 |

---

## 9. 완료 기준 (DoD)

### 기능 완료
- [ ] `TradingSignal` Prisma 마이그레이션이 개발·스테이징 DB에 정상 적용됨
- [ ] `generateSignalsForDisclosure(rcpNo)` 호출 시 4개 Persona 신호가 생성됨
- [ ] 거래정지·관리종목 종목에 대해 신호 `BLOCKED`가 반환됨(자동 매수 방어선)
- [ ] `buyScore` 범위가 -100~100 내에 유지됨(클램핑 검증)
- [ ] `entryReady=true`인 신호가 필수 진입 조건을 모두 충족함
- [ ] `STRONG_BUY_CANDIDATE` 생성 시 Push 알림이 발송됨
- [ ] `GET /buy-signal/candidates?minScore=60` 응답이 정확한 필터 결과를 반환함
- [ ] 가중치 합 검증 실패 시 서버가 시작되지 않음(config 안전장치)
- [ ] 정정공시 감지 시 기존 신호가 `AVOID`로 업데이트됨

### 품질 기준
- [ ] 각 Scorer 단위 테스트 커버리지 80% 이상
- [ ] 실제 과거 공시 샘플 5건 기준 수동 점수 검증(엔지니어 리뷰)
- [ ] 단건 신호 생성 p95 < 200ms (부하 테스트 또는 타임 측정)
- [ ] `docs/database-schema.md`, `docs/api-specification.md` 업데이트 완료

### Phase 7 진입 조건
- `TradingSignal` 레코드 생성이 안정적으로 동작하고, `BUY_CANDIDATE` 이상 신호가 최소 10건 이상 실데이터에서 생성됨
- `signalSummary`, `riskFactors`, `entryConditionMet` 필드가 Phase 7 `PositionThesis` 초기 데이터로 활용 가능한 상태임
- **자동 주문·포트폴리오 반영 코드가 이 Phase에 존재하지 않음을 코드 리뷰로 확인**
