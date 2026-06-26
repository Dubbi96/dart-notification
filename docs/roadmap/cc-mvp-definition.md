> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# 현실적 MVP 정의

> 작성일: 2026-06-02 · 상태: 설계 확정(기준선)

---

## 1. 목적 & 범위

### 목적

단 하나의 검증 질문에 답하는 시스템을 **검증 가능한 품질로 완성한 뒤, 모의투자로 실비용을 측정**한다.

> **"AI·데이터 비용을 제하고도 이 시스템이 실제로 투자 판단 개선에 도움이 되는가?"**

이 질문에 "Yes"라는 데이터를 얻기 전까지 자동매매(Phase 13~14)는 착수하지 않는다.

### 검증 철학 (중요)

> **얇게/대충 만든 결과가 우연히 잘 나와도 신뢰하지 않는다.** "최소 범위"는 *대상의 범위*(관심 50종목·공시 5종)를 좁힌다는 뜻이지, *구현 품질*을 낮춘다는 뜻이 아니다.
>
> MVP의 11개 기능은 모두 **단위/통합 테스트로 검증 가능한 수준**까지 완성한 뒤, 백테스트(전략 타당성)와 모의투자(실데이터·실비용)를 거쳐야 한다. 이 게이트를 통과하기 전에는 실서비스·실주문으로 넘어가지 않는다.
>
> 전체 진행 순서와 단계별 회귀 점검은 **[실행 로드맵](./01-execution-roadmap.md)** 이 정본이다. (이 문서의 "제외 항목"은 *최소 빌드 범위*를 뜻하며, Event Study·백테스트는 실행 로드맵상 모의투자 졸업 게이트 **이전**에 수행된다.)

### MVP 범위

| 항목 | MVP 내 | MVP 외 |
|------|--------|--------|
| 분석 대상 종목 | 관심 종목 ≤ 50개 | 전체 상장사 스캔 |
| 공시 유형 | 5종(단일판매·공급계약 / 자기주식취득·소각 / 현금·현물배당 / 유상증자 / CB·BW) | 기타 공시 전체 |
| Persona | 4종(가치투자형·성장주형·모멘텀형·이벤트드리븐형) | 커스텀 Persona |
| 매매 범위 | 매수 후보 생성 + 매도/Exit 후보 생성 + 모의주문 | 실제 증권사 주문(실주문 없음) |
| AI | L1~L2 수준(요약·분류·Persona 해석), AIUsageLog 필수 | L3 고성능 모델 전면 투입 |
| 사용자 수 | 내부 테스터 1~5명 (모의투자 검증용) | 외부 서비스 런칭 |

### 포함하는 기능 11개

1. DART 공시 수집 안정화 (Phase 1)
2. 공시 원문 다운로드·파싱 (Phase 2)
3. 이벤트 타입·핵심 수치 추출 (Phase 3)
4. AI 공시 요약·긍정·부정 요인 추출 (Phase 4 일부)
5. AI Persona별 해석 생성 (Phase 4 일부)
6. 현재가·일봉·기본 기술지표 수집 (Phase 5 일부)
7. Buy Score 계산 → 매수 후보 목록 (Phase 6)
8. PositionThesis 저장 (Phase 7)
9. Exit Score 계산 → 매도 후보 목록 (Phase 8 일부)
10. 모의투자 포트폴리오 추적 (Phase 12)
11. AI 비용 로그·비율 모니터링 (Phase 11)

### 제외 항목 (명시적 Out-of-Scope)

- 과거 Event Study 통계 (Phase 9) — 데이터 충분 후 추가
- 백테스트 엔진 (Phase 10) — 모의투자 성과 누적 후 착수
- 반자동·제한적 자동매매 (Phase 13~14) — 졸업 조건 충족 후에만
- 웹 UI, 이메일/카카오 알림 채널 추가
- GPU 서버 자체 AI 서빙

---

## 2. 현재 코드베이스 연결점

### 기존 자산 (즉시 재사용 가능)

| 영역 | 모듈/파일 | 재사용 포인트 |
|------|-----------|---------------|
| 공시 수집 스케줄러 | `backend/src/scheduler/` | Phase 1 안정화 기반 |
| `Disclosure` 테이블 | `schema.prisma` rcpNo PK | 원문 파싱 FK 기준 |
| `Company` 테이블 | `schema.prisma` corpCode PK | 시세 데이터 FK 기준 |
| `WatchList` | `schema.prisma` | 분석 대상 필터링 기준 |
| 공시 7분류 | `scheduler` 정규식 로직 | 5종 필터 1차 게이트 |
| Expo 푸시 알림 파이프라인 | `notification/` | 매수·매도 후보 알림 재사용 |
| CompanyOverview | `schema.prisma` | 기업 기본 정보 조회 |

### 확장해야 할 테이블 (MVP 신규 추가 9개)

기존 자연키(`Disclosure.rcpNo`, `Company.corpCode`)와 FK 정합을 유지한다.

```prisma
// Phase 1 – 수집 로그
model DisclosureCollectionLog {
  id            String   @id @default(cuid())
  runAt         DateTime @default(now())
  bgnDe         String   // 수집 시작일 YYYYMMDD
  endDe         String   // 수집 종료일 YYYYMMDD
  totalFetched  Int      @default(0)
  newlySaved    Int      @default(0)
  failedCount   Int      @default(0)
  status        String   // "SUCCESS" | "PARTIAL" | "FAILED"
  errorMessage  String?

  @@index([runAt])
  @@map("disclosure_collection_logs")
}

// Phase 2 – 원문 파싱
model DisclosureDocument {
  rcpNo       String   @id  // FK → Disclosure.rcpNo (1:1)
  rawFilePath String?       // S3 or local 경로
  rawText     String?  @db.Text
  parsedJson  Json?         // 표·key-value 구조화 결과
  parseStatus String        // "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED"
  fetchedAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  disclosure Disclosure @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)

  @@index([parseStatus])
  @@map("disclosure_documents")
}

// Phase 3 – 이벤트·수치 추출
model DisclosureEvent {
  id          String   @id @default(cuid())
  rcpNo       String               // FK → Disclosure.rcpNo
  corpCode    String               // FK → Company.corpCode
  eventType   String               // enum: SUPPLY_CONTRACT | SHARE_BUYBACK | ...
  polarity    String               // "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL"
  metricsJson Json                 // 이벤트별 핵심 수치 (공식 참고)
  isAmendment Boolean  @default(false)
  createdAt   DateTime @default(now())

  disclosure Disclosure @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)
  company    Company    @relation(fields: [corpCode], references: [corpCode])

  @@index([rcpNo])
  @@index([corpCode, eventType])
  @@index([createdAt])
  @@map("disclosure_events")
}

// Phase 4 – AI 분석 결과
model DisclosureAnalysis {
  id           String   @id @default(cuid())
  rcpNo        String               // FK → Disclosure.rcpNo
  aiLevel      Int                  // 1(저비용) | 2(중간) | 3(고성능)
  taskType     String               // "SUMMARY" | "EVENT_CLASS" | "PERSONA" | "THESIS"
  model        String               // 사용한 외부 LLM 모델명
  promptTokens Int
  completionTokens Int
  costUsd      Float
  outputJson   Json                 // 표준화된 JSON 응답
  createdAt    DateTime @default(now())

  disclosure Disclosure @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)

  @@index([rcpNo])
  @@index([taskType])
  @@map("disclosure_analyses")
}

// Phase 5 – 일봉 시세
model StockDailyPrice {
  id          String   @id @default(cuid())
  corpCode    String               // FK → Company.corpCode
  stockCode   String               // 종목코드 6자리
  tradeDate   String               // YYYYMMDD
  open        Int
  high        Int
  low         Int
  close       Int
  volume      BigInt
  tradingValue BigInt              // 거래대금 (원)
  ma5         Float?
  ma20        Float?
  ma60        Float?
  rsi14       Float?
  fetchedAt   DateTime @default(now())

  company Company @relation(fields: [corpCode], references: [corpCode])

  @@unique([corpCode, tradeDate])
  @@index([corpCode, tradeDate])
  @@map("stock_daily_prices")
}

// Phase 6 – 매수 시그널
model TradingSignal {
  id              String   @id @default(cuid())
  corpCode        String               // FK → Company.corpCode
  rcpNo           String               // 트리거 공시 rcpNo
  signalType      String               // "BUY_CANDIDATE" | "WATCH" | "NEUTRAL" | "AVOID"
  persona         String               // "VALUE" | "GROWTH" | "MOMENTUM" | "EVENT_DRIVEN"
  buyScore        Int                  // 0~100
  entryCondition  Json                 // 진입 조건 배열
  riskFactors     Json                 // 리스크 요인 배열
  scoreBreakdown  Json                 // 항목별 점수 상세
  expiredAt       DateTime             // 유효 만료 시각 (기본: 생성 후 3 거래일)
  isExpired       Boolean  @default(false)
  createdAt       DateTime @default(now())

  company    Company    @relation(fields: [corpCode], references: [corpCode])
  disclosure Disclosure @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)

  @@index([corpCode, createdAt])
  @@index([signalType, isExpired])
  @@map("trading_signals")
}

// Phase 7 – 포지션 논리 저장
model PositionThesis {
  id                String   @id @default(cuid())
  corpCode          String               // FK → Company.corpCode
  rcpNo             String               // 트리거 공시 rcpNo
  persona           String
  entryReason       String   @db.Text
  initialThesis     Json                 // 핵심 매수 논리 배열
  invalidConditions Json                 // 논리 훼손 조건 배열
  takeProfitRule    Json                 // 익절 룰 (partialSell %, trailingStop %)
  stopLossRule      Json                 // 손절 룰 (hardStop %, thesisStop 설명)
  maxWeightPct      Float    @default(5) // 포트폴리오 내 최대 비중 %
  status            String   @default("ACTIVE") // "ACTIVE" | "INVALIDATED" | "EXITED"
  invalidatedAt     DateTime?
  invalidReason     String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  company    Company    @relation(fields: [corpCode], references: [corpCode])
  disclosure Disclosure @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)
  paperTrades PaperTrade[]
  exitSignals ExitSignal[]

  @@index([corpCode, status])
  @@map("position_theses")
}

// Phase 8 – Exit 시그널
model ExitSignal {
  id             String   @id @default(cuid())
  positionThesisId String             // FK → PositionThesis.id
  corpCode       String               // FK → Company.corpCode
  exitScore      Int                  // 0~100
  exitAction     String               // "HOLD" | "WATCH" | "REDUCE" | "EXIT" | "BLOCK_REBUY"
  triggerReasons Json                 // 매도 사유 배열
  scoreBreakdown Json                 // 항목별 점수
  createdAt      DateTime @default(now())

  positionThesis PositionThesis @relation(fields: [positionThesisId], references: [id])
  company        Company        @relation(fields: [corpCode], references: [corpCode])

  @@index([positionThesisId, createdAt])
  @@index([exitAction])
  @@map("exit_signals")
}

// Phase 11+12 – AI 비용 로그 & 모의 거래
model AIUsageLog {
  id           String   @id @default(cuid())
  rcpNo        String?              // 관련 공시 rcpNo (없을 수 있음)
  taskType     String               // "SUMMARY" | "EVENT_CLASS" | "PERSONA" | "THESIS"
  aiLevel      Int
  model        String
  promptTokens Int
  completionTokens Int
  costUsd      Float
  createdAt    DateTime @default(now())

  @@index([taskType, createdAt])
  @@index([createdAt])
  @@map("ai_usage_logs")
}

model PaperTrade {
  id               String   @id @default(cuid())
  positionThesisId String               // FK → PositionThesis.id
  corpCode         String               // FK → Company.corpCode
  tradeType        String               // "BUY" | "SELL" | "PARTIAL_SELL"
  tradeDate        String               // YYYYMMDD
  price            Int                  // 체결 기준가 (모의)
  quantity         Int
  amount           BigInt               // price * quantity
  exitReason       String?              // 매도 시 사유
  pnlPct           Float?               // 손익률 % (매도 시 계산)
  createdAt        DateTime @default(now())

  positionThesis PositionThesis @relation(fields: [positionThesisId], references: [id])
  company        Company        @relation(fields: [corpCode], references: [corpCode])

  @@index([corpCode, tradeDate])
  @@index([positionThesisId])
  @@map("paper_trades")
}
```

---

## 3. 선행 조건 & 의존성

```
Phase 1 (수집 안정화)
  └→ Phase 2 (원문 파싱)
      └→ Phase 3 (이벤트 추출)
          └→ Phase 4 (AI 분석)         ← AIUsageLog 동시 착수
              └→ Phase 5 (시세 데이터)
                  └→ Phase 6 (Buy Score)
                      └→ Phase 7 (PositionThesis)
                          └→ Phase 8 (Exit Score)
                              └→ Phase 12 (PaperTrade 모의투자)
```

| 의존 항목 | 조건 |
|-----------|------|
| DART OpenAPI 키 | 수집·원문 다운로드 모두 필요 |
| 증권사 시세 API (KIS Developers 등) | Phase 5부터 필요, OAuth 토큰 관리 |
| 외부 LLM API (OpenAI / Claude / Gemini) | Phase 4 착수 전 계약·비용 한도 설정 |
| PostgreSQL 확장 | 현재 스키마와 동일 DB 확장(마이그레이션) |

---

## 4. 상세 설계

### 4-1. 공시 이벤트 enum (5종 → 세분화)

```
SUPPLY_CONTRACT          // 단일판매·공급계약
CONTRACT_CANCELLATION    // 계약 취소·정정
SHARE_BUYBACK            // 자기주식 취득
SHARE_CANCELLATION       // 자기주식 소각
DIVIDEND_INCREASE        // 배당 확대
DIVIDEND_CUT             // 배당 축소·삭제
PAID_IN_CAPITAL_INCREASE // 유상증자 (일반공모)
THIRD_PARTY_ALLOTMENT    // 제3자배정 증자
CB_ISSUANCE              // 전환사채 발행
BW_ISSUANCE              // 신주인수권부사채 발행
```

### 4-2. Buy Score 공식

```
Buy Score (0 ~ 100) =
  이벤트 점수       (0~30)  // 이벤트 타입·polarity·핵심 수치 비율
  + Persona 적합도  (0~20)  // AI Persona 해석 결과
  + 차트 점수       (0~20)  // MA 위치·RSI·거래량 증가율
  + 시장 환경 점수  (0~10)  // 코스피/코스닥 당일 분위기
  − 리스크 패널티   (0~30)  // 관리종목·공시 전 선행급등·CB희석 등

신호 등급:
  80 이상  → BUY_CANDIDATE  (강한 매수 후보)
  60~79   → BUY_CANDIDATE  (매수 후보)
  30~59   → WATCH          (관심·관망)
  아래    → NEUTRAL / AVOID
```

### 4-3. Exit Score 공식

```
Exit Score (0 ~ 100) =
  손실 리스크      (0~30)  // 하드스탑 근접·MDD 초과
  + 논리 훼손     (0~25)  // 정정·취소·실적 미반영
  + 차트 훼손     (0~20)  // 20일선 이탈·전저점 이탈
  + 공시 악화     (0~15)  // 동일 기업 악재 공시 재발
  + 시간 초과     (0~10)  // N 거래일 후 반응 없음
  − 긍정 모멘텀   (0~20)  // 추가 매수 공시·거래량 유지

액션 결정:
  0~29  → HOLD
  30~49 → WATCH
  50~69 → REDUCE (일부 축소)
  70~89 → EXIT   (전량 매도 후보)
  90↑   → EXIT   (즉시 리스크 매도)
```

### 4-4. AI 비용 게이팅 의사코드

```typescript
// AI 호출 전 L0 필터 (Phase 11 규칙)
function shouldCallAI(disclosure: Disclosure, event: DisclosureEvent): AiLevel | null {
  // L0: AI 미사용
  if (!WATCHLIST_CORP_CODES.has(disclosure.corpCode)) return null;
  if (event.polarity === 'NEUTRAL' && !isMvpEventType(event.eventType)) return null;
  if (isManagementIssueStock(disclosure.corpCode)) return null;

  // L1: 저비용 — 매매 관련 여부 분류만
  if (event.polarity === 'NEUTRAL') return AiLevel.L1;

  // L2: 중간 — 요약·Persona·Thesis
  if (BUY_SCORE_THRESHOLD >= 60 || isWatchlistTop(disclosure.corpCode)) return AiLevel.L2;

  // 기본 L1
  return AiLevel.L1;
}
```

### 4-5. NestJS 모듈·서비스·엔드포인트 (신규)

```typescript
// 추가 모듈 구조
AppModule
├── DisclosureParserModule        // Phase 2: 원문 다운로드·파싱
│   └── DisclosureParserService
│       + parseDocument(rcpNo: string): Promise<DisclosureDocument>
├── DisclosureEventModule         // Phase 3: 이벤트 추출
│   └── DisclosureEventService
│       + extractEvent(rcpNo: string): Promise<DisclosureEvent>
├── AiAnalystModule               // Phase 4: AI 분석
│   └── AiAnalystService
│       + summarize(rcpNo: string, level: AiLevel): Promise<DisclosureAnalysis>
│       + interpretPersona(rcpNo: string): Promise<DisclosureAnalysis>
├── MarketDataModule              // Phase 5: 시세
│   └── MarketDataService
│       + fetchDailyPrices(corpCode: string, days: number): Promise<StockDailyPrice[]>
│       + getCurrentPrice(stockCode: string): Promise<number>
├── SignalEngineModule            // Phase 6+8: Buy/Exit Score
│   └── BuySignalService
│       + computeBuyScore(rcpNo: string, persona: Persona): Promise<TradingSignal>
│   └── ExitSignalService
│       + computeExitScore(thesisId: string): Promise<ExitSignal>
├── PaperTradingModule            // Phase 12: 모의투자
│   └── PaperTradingService
│       + placeMockBuy(thesisId: string, price: number, qty: number): Promise<PaperTrade>
│       + placeMockSell(thesisId: string, price: number, qty: number, reason: string): Promise<PaperTrade>
│       + getPortfolioSnapshot(): Promise<PaperPortfolioDto>
└── AiCostModule                  // Phase 11: 비용 집계
    └── AiCostService
        + getDailyCost(date: string): Promise<AiCostSummaryDto>
        + getCostRatio(): Promise<{ costUsd: number; mockPnlUsd: number; ratio: number }>
```

**REST 엔드포인트 (추가)**

| Method | Path | 설명 |
|--------|------|------|
| GET | `/disclosures/:rcpNo/document` | 원문 파싱 결과 조회 |
| GET | `/disclosures/:rcpNo/event` | 이벤트 타입·수치 조회 |
| GET | `/disclosures/:rcpNo/analysis` | AI 분석 결과 조회 |
| GET | `/signals/buy?limit=20` | 매수 후보 목록 |
| GET | `/signals/exit?limit=20` | 매도 후보 목록 |
| POST | `/paper-trades/buy` | 모의 매수 실행 |
| POST | `/paper-trades/sell` | 모의 매도 실행 |
| GET | `/paper-trades/portfolio` | 모의 포트폴리오 현황 |
| GET | `/ai-cost/summary?date=YYYYMMDD` | AI 비용 일별 요약 |
| GET | `/ai-cost/ratio` | AI비용/모의순익 비율 |

---

## 5. 작업 분해

### Phase 1 — DART 수집 안정화

- [ ] `DisclosureCollectionLog` 테이블 마이그레이션 추가
- [ ] 스케줄러 실행 시 로그 저장 로직 삽입
- [ ] 중복 실행 락 동작 검증 테스트 작성
- [ ] 수집 실패 시 재시도 로직 (최대 3회, 지수 백오프)
- [ ] 수동 수집 `POST /scheduler/collect` 응답에 로그 ID 포함

### Phase 2 — 원문 파싱

- [ ] DART `document.json` API로 원문 HTML 다운로드
- [ ] HTML → 순수 텍스트 + 표(JSON) 추출 파서 구현
- [ ] `DisclosureDocument` 테이블 마이그레이션 및 저장 서비스
- [ ] 파싱 실패 시 `parseStatus = FAILED` 기록 후 계속 진행
- [ ] 관심 종목 5종 공시에만 원문 다운로드 제한 (비용 통제)

### Phase 3 — 이벤트 추출

- [ ] 이벤트 enum 10개 정의 (`disclosure-event.enum.ts`)
- [ ] 공시 유형별 Rule 기반 파서 구현 (5종 × 핵심 수치)
- [ ] `DisclosureEvent` 테이블 마이그레이션 및 저장 서비스
- [ ] 정정 공시 감지 → `isAmendment = true` 처리
- [ ] 이벤트 타입 분류 정확도 수동 검증 (100건 샘플)

### Phase 4 — AI Analyst Engine

- [ ] `AiLevel` enum 정의, L0 필터 함수 구현
- [ ] 외부 LLM API 클라이언트 모듈 (API 키 환경변수 주입)
- [ ] Task 1: Disclosure Summary AI — 요약·긍정·부정 JSON 출력
- [ ] Task 2: Event Classification AI — eventType 보정·polarity
- [ ] Task 3: Persona Interpretation AI — 4 Persona JSON 출력
- [ ] `DisclosureAnalysis` 저장 및 `AIUsageLog` 동시 기록
- [ ] 일별 AI 비용 한도 초과 시 L1 이하로 강제 다운그레이드

### Phase 5 — 시세 데이터 수집

- [ ] 증권사 OpenAPI (KIS 등) 클라이언트 모듈
- [ ] 관심 종목 일봉 (60일) 초기 백필 스크립트
- [ ] 매일 장 마감 후 일봉 업데이트 스케줄러 (17:00 cron)
- [ ] MA5/MA20/MA60/RSI14 계산 후 `StockDailyPrice` 저장
- [ ] 현재가 온디맨드 조회 서비스 (시세 API 호출)

### Phase 6 — Buy Signal Engine

- [ ] `BuySignalService.computeBuyScore()` 구현 (공식 §4-2)
- [ ] `TradingSignal` 저장 및 유효기간(3거래일) 만료 처리
- [ ] Persona별 가중치 파라미터 설정 파일 (`signal-config.ts`)
- [ ] `GET /signals/buy` 엔드포인트 구현 (Swagger 포함)
- [ ] 모바일: 매수 후보 카드 UI 화면 (공시·점수·근거 표시)

### Phase 7 — PositionThesis 저장

- [ ] Task 4: Position Thesis AI 구현 (진입 사유·훼손 조건 JSON)
- [ ] `PositionThesis` 마이그레이션 및 저장 서비스
- [ ] 모의투자 매수 시 자동 Thesis 생성 플로우
- [ ] 모바일: Thesis 상세 화면 (진입 논리·훼손 조건·손절 룰 표시)

### Phase 8 — Exit Signal Engine

- [ ] `ExitSignalService.computeExitScore()` 구현 (공식 §4-3)
- [ ] 하루 3회 점검 스케줄러 (09:00 / 13:00 / 16:30 cron)
- [ ] `ExitSignal` 저장 및 `PositionThesis.status` 갱신 로직
- [ ] `GET /signals/exit` 엔드포인트 구현
- [ ] 모바일: 매도 후보 카드 UI (Exit Score·사유·권장 액션 표시)

### Phase 11 — AI 비용 통제

- [ ] `AIUsageLog` 마이그레이션 및 저장 훅 (AI 호출 래퍼에서 자동 기록)
- [ ] `GET /ai-cost/summary` 일별 비용 집계 API
- [ ] `GET /ai-cost/ratio` AI비용/모의순익 비율 API
- [ ] 일별 비용 한도 (예: $2/일) 초과 시 알림 발송

### Phase 12 — 모의투자

- [ ] `PaperTrade` 마이그레이션 및 서비스 구현
- [ ] 모의 포트폴리오 snapshot 계산 (평가금액·손익·수익률)
- [ ] 손절/익절 자동 Exit Signal 발동 시 모의 매도 실행
- [ ] `GET /paper-trades/portfolio` 엔드포인트 구현
- [ ] 모바일: 모의 포트폴리오 현황 화면 (보유 종목·손익 목록)

### 공통·인프라

- [ ] Prisma 마이그레이션 9개 테이블 일괄 생성 (`prisma migrate dev`)
- [ ] Swagger 태그 및 DTO 정의 (신규 엔드포인트 전체)
- [ ] 핵심 서비스 단위 테스트 (BuySignalService, ExitSignalService, AiCostService)
- [ ] 환경변수 추가 (`MARKET_API_KEY`, `LLM_API_KEY`, `LLM_DAILY_BUDGET_USD`)
- [ ] `PROJECT_STRUCTURE.md` 트리 업데이트

---

## 6. AI 사용 정책

### MVP 내 허용 Level

| Level | 대상 | 모델 예시 | 비용 기준 |
|-------|------|-----------|-----------|
| L1 | 매매 관련 공시 분류·필터 | 소형 LLM 또는 fine-tuned | < $0.001/건 |
| L2 | 요약·긍정·부정·Persona 해석·Thesis | 중간 LLM | < $0.01/건 |
| L3 (제한) | 보유 종목 악재·복잡한 CB/BW 분석 | 대형 LLM | < $0.05/건, 1일 최대 20건 |

### AI 금지 영역 (절대 원칙 재확인)

> **다음 사항은 MVP 단계에서도 AI가 결정해서는 안 된다.**

- 최종 주문 승인 (모의·실매매 모두)
- 손절·익절 하드 룰 수치 결정
- 포트폴리오 종목 한도·비중 결정
- 주문 수량 계산
- 리스크 룰 우회 또는 예외 처리

AI 출력은 항상 **권고** 수준으로만 사용되고, 최종 판단은 Rule Engine 또는 사용자가 한다.

---

## 7. 비용·성능 고려사항

### AI 비용 목표

| 지표 | 목표(초기 검증) | 장기 목표 |
|------|----------------|-----------|
| AI비용/모의순익 비율 | ≤ 20% | ≤ 10% |
| 일별 AI 비용 한도 | $2/일 | $5/일 (트래픽 증가 시) |
| 공시 1건당 평균 비용 | < $0.005 | < $0.002 |
| L0(AI 미사용) 비율 | ≥ 70% 공시 | ≥ 80% |

### 성능 목표

| 항목 | 목표 |
|------|------|
| 공시 수집 → 알림 발송 지연 | ≤ 15분 (장중) |
| 공시 → AI 분석 완료 | ≤ 5분 (L2 기준) |
| Buy Score 계산 | ≤ 10초/건 |
| Exit Score 일괄 점검 (50 포지션) | ≤ 60초/회 |
| 모의 포트폴리오 snapshot | ≤ 2초 |

### 데이터 비용

- 시세 데이터: **KRX 데이터마켓플레이스(공기업)** 1차 기준 — EOD 일봉·지수·종목상태 일괄 수집. 실시간 현재가/체결만 증권사 OpenAPI 보완
- DART OpenAPI: 무료, 일 10,000건 한도 내 유지

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 영향 | 대응 |
|--------|------|------|
| DART API 장애 | 수집 공백 | `DisclosureCollectionLog` + 재시도, 수동 백필 |
| LLM API 비용 폭주 | 예산 초과 | 일별 한도 + 초과 시 L1 강제 다운그레이드 |
| 시세 API 한도 초과 | 가격 데이터 누락 | 캐싱(24h TTL), 장 마감 후 일괄 업데이트 |
| 정정 공시 미감지 | 오래된 Signal 유지 | `isAmendment` 감지 → Signal 만료 처리 |
| 관리종목 진입 | 잘못된 매수 후보 | L0 필터에서 관리종목 자동 제외 |
| 단기 급등 후 공시 | 선행 주가 반영 | 공시 전 5일 상승률 > 15% → 리스크 패널티 가산 |
| 모의 체결가 비현실 | 수익률 왜곡 | 공시 다음 거래일 시가 기준 체결 원칙 |
| AI JSON 파싱 오류 | 분석 결과 누락 | JSON 스키마 검증 + `parseStatus = FAILED` fallback |
| 50종목 한도 초과 | 비용·복잡도 증가 | WatchList 갯수 제한 enforcing (백엔드 50개 cap) |

---

## 9. 완료 기준 (DoD) & go/no-go 게이트

### MVP 완료 정의 (모두 충족 시 "MVP 완료" 선언)

- [ ] 관심 50개 종목의 5종 공시가 자동 수집·파싱·이벤트 분류까지 파이프라인 완동
- [ ] AI 분석(요약·Persona·Thesis)이 L1~L2 수준으로 10건 이상 정상 생성
- [ ] Buy Score가 관심 종목 공시 발생 시 자동 계산되어 `TradingSignal` 저장
- [ ] Exit Score가 하루 3회 정기 점검으로 계산되어 `ExitSignal` 저장
- [ ] `PaperTrade` 기반 모의 포트폴리오가 ≥ 30일간 실시간 공시로 운용
- [ ] `AIUsageLog`를 통해 AI비용/모의순익 비율이 측정 가능
- [ ] 모바일: 매수 후보 카드 + 매도 후보 카드 + 모의 포트폴리오 화면 동작
- [ ] Swagger 문서에 신규 엔드포인트 전체 등재

### 검증 질문을 측정 가능한 성공 지표로 변환

| 지표 | 측정 방법 | 목표값 (30일 운용 기준) |
|------|-----------|------------------------|
| **신호 적중률** | BUY_CANDIDATE 신호 발생 후 D+5 수익률 > 0% 비율 | ≥ 55% |
| **모의 누적 수익률** | 30일 PaperTrade 포트폴리오 누적 손익 / 초기 가상 원금 | > 0% |
| **벤치마크 대비 초과수익(alpha)** | 동일 기간 모의 누적 수익률 − KOSPI(지수 0001) 수익률 | > 0% (DAR-68) |
| **최대낙폭(MDD)** | 일별 포트폴리오 평가액 시계열의 고점 대비 최대 하락폭 | ≥ -15% (DAR-68) |
| **Sharpe 비율** | 일별 수익률 평균/표준편차 × √252 (참고지표, 게이트 아님) | 높을수록 양호 (DAR-68) |
| **AI비용/모의순익 비율** | 총 AI 비용(USD) / 모의 순익(원·USD 환산) | ≤ 20% |
| **Exit 정확도** | EXIT 액션 발생 후 D+3 추가 하락 여부 비율 | ≥ 50% |
| **수집-분석 파이프라인 안정성** | 수집 성공률 (CollectionLog 기준) | ≥ 95% |

### go/no-go 게이트 (30일 운용 후 평가)

> **DAR-68 졸업기준 상향(의도된 변경):** 누적수익 > 0% 만으로는 상승장에서 buy-and-hold KOSPI 에
> 열위여도 졸업할 수 있다(위장통과). 위험조정·벤치마크 상대지표 없이는 "실제 수익을 낸다"는
> 테제를 증명할 수 없으므로, **벤치마크 초과수익(alpha) > 0** 과 **MDD ≥ -15%** 를 졸업 게이트에
> 추가한다. 기준 산식·구현은 `engine5-trading-risk/simulation` 졸업게이트(G6·G7) 가 정본이며,
> MDD 한도 -15% 는 아래 백테스트 졸업 조건과 정합한다. 순수 Rule(AI 미개입).

**Go 조건 (모두 충족 시 → Phase 9 Event Study 착수):**
- 신호 적중률 ≥ 55% (G1)
- 모의 누적 수익률 > 0% (G2)
- AI비용/모의순익 ≤ 20% (G3)
- Exit 정확도 ≥ 50% (G5)
- 최대낙폭(MDD) ≥ -15% (G6, DAR-68)
- 벤치마크(KOSPI) 대비 초과수익(alpha) > 0% (G7, DAR-68)
- 수집 성공률 ≥ 95% (G4)
- (참고) Sharpe 비율: 위험조정 수익 양호 여부 — 게이트 아님, 정직 표기용

> **F12(2026-06-26) 표본 하한:** 표본 기반 게이트(G1 적중률·G5 Exit 정확도)는 표본수 < **20**
> 이면 `pass=null`+`lowSample=true`로 정직 표기하고 졸업을 차단한다(`GRADUATION_MIN_SAMPLE=20`).
> n=5는 이항잡음이 압도(3/5=60%면 통과)해 go/no-go 근거로 부적절 → 단타 트랙(LOW_SAMPLE_THRESHOLD=20)과 정합.

**No-go 조건 (하나라도 해당 시 → 원인 분석 후 재설계):**
- 신호 적중률 < 40% (3회 연속)
- AI 비용이 모의 손익 초과
- 수집 파이프라인 실패율 > 10%

### 자동매매(Phase 13~14) 졸업 조건

아래 **모든 조건**을 충족해야 반자동매매 착수를 허가한다.

- [ ] MVP 30일 운용 go/no-go 게이트 통과
- [ ] Phase 9 Event Study: 이벤트 유형별 표본 ≥ 50건, D+5 통계 유의 (p < 0.1)
- [ ] Phase 10 백테스트: 상승·하락·횡보 3가지 시장 구간에서 MDD ≤ -15%, 수익률 > 0%
- [ ] Phase 12 모의투자: 90일 이상 운용, 누적 수익 > 0%, AI비용/순익 ≤ 10%
- [ ] Exit Signal 정확도 ≥ 55% (손절 발동 후 추가 하락 확인)
- [ ] AI 금지 영역 침범 없음 (코드 리뷰·감사 로그 확인)
- [ ] 반자동매매 1회 주문 한도·일 손실 한도 Risk Engine 코드 검증 완료
