> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 7 — Position Thesis 저장

> 최종 수정일: 2026-06-02 · 상태: 설계 완료 (미구현)

---

## 1. 목적 & 범위

### 목적

매수 신호가 발생했을 때 "왜 샀는지"를 구조화된 형태로 저장한다.
`PositionThesis`는 시스템의 **기억 장치**다. 이것이 없으면 나중에 "논리가 훼손됐는가?"를 판단할 수 없고,
Exit Engine(Phase 8)은 작동할 수 없다.

> 원칙: 매수보다 매도·포트폴리오 추적을 먼저 안전하게 설계한다. `PositionThesis`가 그 출발점이다.

### 포함 범위

- `PositionThesis` Prisma 모델 설계 및 마이그레이션
- `Portfolio` / `Position` 모델 설계 (Thesis의 컨테이너)
- `TradingSignal`과 `Disclosure`(rcpNo) 연결
- 매수 시 Thesis 자동 생성 흐름 (NestJS 서비스)
- Thesis 생명주기: 생성 → 추적 → 훼손 판정
- Exit Engine(Phase 8)으로의 입력 계약 정의

### 제외 범위

- 실제 매수 주문 실행 (Phase 13)
- Exit Score 계산 및 매도 신호 발행 (Phase 8)
- 백테스트/모의투자 연동 (Phase 10/12)
- 자동매매 (Phase 14)

---

## 2. 현재 코드베이스 연결점

| 항목 | 현재 상태 | Phase 7 연결 |
|------|-----------|-------------|
| `Disclosure` (rcpNo PK) | `backend/prisma/schema.prisma` | `PositionThesis.triggerRcpNos[]` FK 배열로 연결 |
| `Company` (corpCode PK) | 동일 파일 | `Position.corpCode` FK |
| `User` | 동일 파일 | `Portfolio.userId` FK |
| `WatchList` | 동일 파일 | 관심 종목 → 매수 후보 필터 기준 |
| 공시 수집 스케줄러 | `backend/src/scheduler/` | Thesis 생성 트리거 기반 |
| `TradingSignal` (Phase 6 설계) | 미구현 | `PositionThesis.signalId` FK |
| `DisclosureEvent` (Phase 3 설계) | 미구현 | Thesis `eventType` 참조 |

---

## 3. 선행 조건 & 의존성

| Phase | 이유 |
|-------|------|
| Phase 1 — DART 수집 안정화 | `Disclosure.rcpNo`가 안정적으로 존재해야 FK 연결 가능 |
| Phase 3 — 이벤트 수치 추출 | `eventType`, `salesRatio` 등 수치가 있어야 Thesis 조건 생성 가능 |
| Phase 4 — AI Analyst Engine | `initialThesis[]`, `invalidConditions[]` 항목을 AI가 채움 |
| Phase 5 — 시세·차트 데이터 | 손절·익절 기준(ATR 기반), 진입가 저장 위해 현재가 API 필요 |
| Phase 6 — 매수 Signal Engine | `TradingSignal` 레코드가 있어야 Thesis의 `signalId` FK를 걸 수 있음 |

---

## 4. 상세 설계

### 4-1. Prisma 모델 스케치

```prisma
// =========================================
// 포트폴리오 (사용자별 계좌 단위)
// =========================================
model Portfolio {
  id          String   @id @default(cuid())
  userId      String
  name        String   @default("기본 포트폴리오")
  isPaper     Boolean  @default(false)  // 모의투자 여부
  isActive    Boolean  @default(true)
  maxStockPct Float    @default(10.0)   // 단일 종목 최대 비중(%) — 하드 룰, AI 변경 불가
  maxDrawdown Float    @default(10.0)   // 허용 최대 낙폭(%) — 하드 룰
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  positions Position[]

  @@index([userId])
  @@map("portfolios")
}

// =========================================
// 포지션 (종목 보유 단위)
// =========================================
model Position {
  id          String         @id @default(cuid())
  portfolioId String
  corpCode    String         // FK → Company.corpCode
  stockCode   String         // 6자리 종목코드 (조회 편의)
  corpName    String         // 비정규화 (조회 성능)
  status      PositionStatus @default(OPEN)

  // 매수 정보
  entryDate   DateTime
  entryPrice  Float          // 평균 매수단가 (원)
  quantity    Int            // 보유 수량
  totalCost   Float          // 매수 원가 합계 (수수료 포함)

  // 청산 정보 (CLOSED 시 채워짐)
  exitDate    DateTime?
  exitPrice   Float?
  realizedPnl Float?         // 실현 손익 (원)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  portfolio Portfolio       @relation(fields: [portfolioId], references: [id])
  company   Company         @relation(fields: [corpCode], references: [corpCode])
  thesis    PositionThesis?
  snapshots PositionDailySnapshot[]

  @@index([portfolioId, status])
  @@index([corpCode])
  @@map("positions")
}

enum PositionStatus {
  OPEN      // 보유 중
  CLOSED    // 청산 완료
  PARTIAL   // 일부 청산
}

// =========================================
// Position Thesis — 핵심 모델
// =========================================
model PositionThesis {
  id          String          @id @default(cuid())
  positionId  String          @unique   // 1:1 — 포지션당 하나의 Thesis
  signalId    String?         // FK → TradingSignal.id (Phase 6)

  // 진입 맥락
  persona         String      // "GROWTH" | "MOMENTUM" | "VALUE" | "EVENT_DRIVEN"
  triggerRcpNos   String[]    // 매수 근거 공시 rcpNo 배열 (FK 역할, Disclosure와 정합)
  eventType       String      // "SUPPLY_CONTRACT" | "SHARE_BUYBACK" | ... (DisclosureEvent enum)
  entryReason     String      // 한 문장 요약 (예: "대규모 공급계약 — 최근매출 대비 24%")

  // AI 생성 매수 논리 (JSON 배열, AI 필수)
  initialThesis       Json    // String[]
  // 예: ["계약금액 최근 매출 대비 24%", "거래상대방 대기업", "공시 후 거래량 20일평균 300%↑", "20일선 위 추세"]

  // AI 생성 훼손 조건 (JSON 배열, AI 필수)
  invalidConditions   Json    // String[]
  // 예: ["계약금액 축소 정정공시 발생", "계약 해지 공시", "5거래일 내 거래량 급감", "20일선 종가 이탈"]

  // 청산 룰 — Rule Engine 결정, AI 변경 불가 (AI 금지 영역)
  stopLossHardPct     Float   // 하드 손절 (%) 예: -7.0
  stopLossThesis      String  // 논리 훼손 손절 설명 (예: "핵심 매수 논리 2개 이상 훼손")
  takeProfitPartialPct Float  // 분할 익절 기준 (%) 예: +12.0
  trailingStopFromHighPct Float // 고점 대비 트레일링 스탑 (%) 예: -6.0
  maxHoldingDays      Int     // 목표 최대 보유 기간 (영업일)
  maxWeightPct        Float   // 이 종목 최대 비중 (%) — 포트폴리오 대비, 하드 룰

  // 생명주기 상태
  thesisStatus   ThesisStatus  @default(ACTIVE)
  violatedAt     DateTime?     // 훼손 판정 시각
  violatedReason String?       // 어떤 invalidCondition이 트리거됐는지

  // AI 생성 메타
  aiModel    String?           // 사용한 LLM 모델명
  aiCostUsd  Float?            // 해당 호출 비용 (USD)
  aiInputTokens  Int?
  aiOutputTokens Int?

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  position Position @relation(fields: [positionId], references: [id], onDelete: Cascade)

  @@index([thesisStatus])
  @@index([persona])
  @@index([eventType])
  @@map("position_theses")
}

enum ThesisStatus {
  ACTIVE    // 논리 유효, 보유 지속
  WATCHING  // 일부 조건 흔들림, 주의 모드
  VIOLATED  // 핵심 논리 훼손 — Exit Engine 즉시 평가 요청
  EXPIRED   // 보유 기간 초과
  CLOSED    // 포지션 청산 완료
}

// =========================================
// 포지션 일별 스냅샷 (손익 추적)
// =========================================
model PositionDailySnapshot {
  id          String   @id @default(cuid())
  positionId  String
  snapshotDate DateTime // 기준일 (00:00 KST)
  closePrice  Float    // 당일 종가
  quantity    Int      // 당일 말 보유 수량
  marketValue Float    // closePrice × quantity
  unrealizedPnl Float  // 평가 손익
  unrealizedPnlPct Float // 평가 손익률 (%)
  highFromEntry Float? // 진입 이후 최고가

  position Position @relation(fields: [positionId], references: [id], onDelete: Cascade)

  @@unique([positionId, snapshotDate])
  @@index([positionId, snapshotDate])
  @@map("position_daily_snapshots")
}
```

### 4-2. TradingSignal 연결 (Phase 6 인터페이스)

Phase 6에서 설계한 `TradingSignal` 스키마 최소 계약:

```prisma
// (Phase 6 담당, 여기서는 참조 계약만 명시)
model TradingSignal {
  id         String  @id @default(cuid())
  corpCode   String
  stockCode  String
  rcpNo      String  // 트리거 공시 (FK → Disclosure.rcpNo)
  persona    String
  buyScore   Float
  signal     String  // "BUY_CANDIDATE" | "WATCH" | "NEUTRAL" | "AVOID"
  entryConditions Json  // String[]
  riskFactors     Json  // String[]
  createdAt  DateTime @default(now())
  // ...
  theses PositionThesis[] // Phase 7에서 추가
}
```

### 4-3. NestJS 모듈 구조

```
backend/src/
  portfolio/
    portfolio.module.ts
    portfolio.service.ts           // Portfolio CRUD
    portfolio.controller.ts
  position/
    position.module.ts
    position.service.ts            // Position 생성·조회·청산
    position.controller.ts
  position-thesis/
    position-thesis.module.ts
    position-thesis.service.ts     // Thesis 생성·상태 추적·훼손 판정
    position-thesis.controller.ts
    dto/
      create-thesis.dto.ts
      thesis-violation.dto.ts
    interfaces/
      thesis-lifecycle.interface.ts
```

### 4-4. 서비스 시그니처

```typescript
// position-thesis.service.ts

/**
 * 매수 신호 발생 시 Thesis 자동 생성.
 * AI Task: Position Thesis AI (Phase 4, L2 비용 게이트)
 * 입력: TradingSignal + DisclosureEvent 수치 JSON
 * 출력: PositionThesis 레코드 생성
 */
async createFromSignal(
  positionId: string,
  signalId: string,
  disclosureContext: DisclosureThesisContext,
): Promise<PositionThesis>;

/**
 * 신규 공시·가격 이벤트 발생 시 ACTIVE Thesis 전체 재평가.
 * invalidConditions 배열을 순회하며 Rule 기반 1차 체크,
 * 훼손 의심 시 AI 보조 판정 (L3 비용 게이트).
 */
async evaluateViolation(
  thesisId: string,
  triggerEvent: ThesisViolationTrigger,
): Promise<ThesisViolationResult>;

/**
 * 보유 기간 초과 체크 (매일 스케줄러 호출).
 * maxHoldingDays 초과 시 status → EXPIRED.
 */
async checkExpiry(thesisId: string): Promise<void>;

/**
 * Exit Engine(Phase 8) 진입점.
 * VIOLATED | EXPIRED 상태 Thesis 목록 조회.
 * Exit Engine은 이 목록을 소비해 ExitSignal을 생성한다.
 */
async findPendingExitEvaluation(): Promise<PositionThesis[]>;

/**
 * Thesis 완전 종료 (포지션 청산 완료 시).
 */
async closeTh(thesisId: string, exitSummary: string): Promise<PositionThesis>;
```

### 4-5. API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/portfolios` | 포트폴리오 생성 |
| `GET`  | `/portfolios/:id` | 포트폴리오 조회 (포지션 포함) |
| `POST` | `/portfolios/:id/positions` | 포지션 수동 등록 (모의·반자동) |
| `GET`  | `/positions/:id` | 포지션 상세 + Thesis |
| `GET`  | `/positions/:id/thesis` | Thesis 상세 조회 |
| `PATCH` | `/positions/:id/thesis/status` | Thesis 상태 수동 갱신 (관리자용) |
| `GET`  | `/positions/pending-exit` | VIOLATED·EXPIRED Thesis 목록 |

### 4-6. Thesis 생성 의사코드

```
function createThesisFromSignal(signal: TradingSignal, event: DisclosureEvent):

  // 1. Rule Engine: 손절·익절 기준 계산 (AI 금지)
  atr = fetchATR14(signal.stockCode)
  stopLossHardPct   = max(-7.0, -(2.5 * atr / entryPrice * 100))
  takeProfitPartialPct = min(+15.0, +(3.5 * atr / entryPrice * 100))
  trailingStopPct   = stopLossHardPct / 2  // 예: -3.5%
  maxHoldingDays    = lookupHoldingDays(event.eventType, signal.persona)
  maxWeightPct      = min(5.0, portfolio.maxStockPct)

  // 2. AI 호출 (L2 게이트): initialThesis + invalidConditions 생성
  aiInput = {
    summary: event.parsedJson,
    eventType: event.eventType,
    polarity: event.polarity,
    positiveFactors: event.positiveFactors,
    negativeFactors: event.negativeFactors,
    persona: signal.persona,
    chartState: { ma20Position, rsiVal, volumeRatio }
  }
  aiOutput = callPositionThesisAI(aiInput)  // LLM API, L2 비용
  // aiOutput.initialThesis: String[]
  // aiOutput.invalidConditions: String[]

  // 3. 저장
  thesis = prisma.positionThesis.create({
    positionId, signalId,
    persona: signal.persona,
    triggerRcpNos: [event.rcpNo, ...relatedRcpNos],
    eventType: event.eventType,
    entryReason: aiOutput.entryReason,
    initialThesis: aiOutput.initialThesis,
    invalidConditions: aiOutput.invalidConditions,
    stopLossHardPct,
    stopLossThesis: aiOutput.stopLossThesis,
    takeProfitPartialPct,
    trailingStopFromHighPct: trailingStopPct,
    maxHoldingDays,
    maxWeightPct,
    thesisStatus: "ACTIVE",
    aiModel: aiOutput.model,
    aiCostUsd: aiOutput.costUsd
  })

  return thesis
```

### 4-7. Thesis 훼손 판정 의사코드

```
function evaluateViolation(thesisId, triggerEvent):
  thesis = fetchThesis(thesisId)
  violated = []

  // 1단계: Rule 기반 체크 (비용 0)
  for condition in thesis.invalidConditions:
    if ruleEngine.check(condition, triggerEvent):
      violated.append(condition)

  // 2단계: 가격 기반 하드 체크 (비용 0)
  if currentPrice <= entryPrice * (1 + thesis.stopLossHardPct / 100):
    violated.append("하드 손절 가격 도달")

  // 3단계: 훼손 의심 시 AI 보조 판정 (L3 게이트)
  //        -- AI는 "최종 판정"이 아닌 "훼손 해석" 보조 역할만
  if len(violated) >= 1:
    aiJudgment = callThesisViolationAI(thesis, triggerEvent, violated)
    // aiJudgment.isViolated: boolean
    // aiJudgment.severity: "MINOR" | "MAJOR" | "CRITICAL"
    // aiJudgment.reason: string

    if aiJudgment.severity in ["MAJOR", "CRITICAL"] or len(violated) >= 2:
      updateThesisStatus(thesisId, "VIOLATED", violatedReason=...) 
      // → Exit Engine(Phase 8)이 findPendingExitEvaluation()으로 픽업

    elif aiJudgment.severity == "MINOR":
      updateThesisStatus(thesisId, "WATCHING")

  return { violated, aiJudgment }
```

### 4-8. Thesis 생명주기 FSM

```
             공시 수신 / 가격 이벤트
                      │
         ┌────────────▼────────────┐
         │         ACTIVE          │  ← Thesis 생성 시 초기 상태
         │   (논리 유효, 보유 중)   │
         └────────┬────────┬───────┘
                  │        │
      조건 흔들림  │        │ maxHoldingDays 초과
                  ▼        ▼
            WATCHING    EXPIRED
                  │        │
    MAJOR/CRITICAL│        │ (Phase 8 Exit Engine 평가)
      훼손 판정   │        │
                  ▼        │
              VIOLATED ◄───┘
                  │
         Phase 8 ExitSignal 생성
                  │
         포지션 청산 완료
                  │
                  ▼
               CLOSED
```

### 4-9. AI 입출력 JSON 계약

**입력 (Position Thesis AI, L2 게이트)**

```json
{
  "task": "POSITION_THESIS",
  "persona": "GROWTH_MOMENTUM",
  "eventType": "SUPPLY_CONTRACT",
  "eventData": {
    "contractAmount": 120000000000,
    "salesRatio": 24.0,
    "counterparty": "대기업A",
    "isAmendment": false
  },
  "positiveFactors": ["계약금액 최근매출 24%", "거래상대방 대기업"],
  "negativeFactors": ["최근 5거래일 +18% 급등"],
  "chartState": {
    "priceVsMa20": "ABOVE",
    "rsi14": 63,
    "volumeRatio20d": 3.2
  }
}
```

**출력 (Position Thesis AI)**

```json
{
  "entryReason": "대규모 공급계약 공시 — 최근매출 대비 24%, 거래상대방 안정적",
  "initialThesis": [
    "계약금액 최근 매출 대비 24% 수준으로 매출 성장 기여 가능",
    "거래상대방 대기업 — 계약 안정성 높음",
    "공시 후 거래량 20일 평균 대비 320% 급증",
    "현재가 20일선 위 상승 추세 유지"
  ],
  "invalidConditions": [
    "계약금액 축소·취소 정정공시 발생",
    "거래상대방 관련 부정적 공시(부도·소송) 발생",
    "공시 후 5거래일 내 거래량 20일평균 이하로 급감",
    "현재가 20일선 종가 이탈 지속(2거래일)",
    "공시 후 20거래일 내 시장 대비 초과수익 0% 미달"
  ],
  "stopLossThesis": "위 무효 조건 2개 이상 동시 충족 시 논리 훼손으로 판단"
}
```

---

## 5. 작업 분해

### DB / 마이그레이션

- [ ] `Portfolio` 모델 마이그레이션 작성
- [ ] `Position` 모델 마이그레이션 작성
- [ ] `PositionThesis` 모델 마이그레이션 작성
- [ ] `PositionDailySnapshot` 모델 마이그레이션 작성
- [ ] `PositionStatus`, `ThesisStatus` enum 추가
- [ ] `npx prisma migrate dev --name phase7-position-thesis` 실행·검증
- [ ] 기존 `Disclosure.rcpNo` FK 정합성 테스트 (triggerRcpNos 배열)

### 백엔드 모듈

- [ ] `PortfolioModule` 생성, CRUD 서비스·컨트롤러
- [ ] `PositionModule` 생성, 포지션 등록·조회·청산 서비스
- [ ] `PositionThesisModule` 생성
- [ ] `createFromSignal()` 서비스 구현
- [ ] `evaluateViolation()` 서비스 구현 (Rule 1차 체크)
- [ ] `checkExpiry()` 서비스 구현 + 스케줄러 등록 (매일 08:30 KST)
- [ ] `findPendingExitEvaluation()` 쿼리 구현 (Phase 8 인터페이스)
- [ ] AI 호출 클라이언트 (L2 게이트: Phase 4 AIAnalystService 재사용)
- [ ] AI 훼손 판정 보조 호출 (L3 게이트: evaluateViolation 2단계)
- [ ] `AIUsageLog` 기록 (Phase 11 연동)
- [ ] Swagger 문서 (`/api/docs`) 엔드포인트 등록

### 안전 장치 (AI 금지 영역 명시)

- [ ] 손절·익절 하드 룰 수치는 `RiskConfigService`에서 Rule Engine이 결정, AI 변경 불가로 코드 주석 명시
- [ ] `maxWeightPct` 상한 하드코딩 (단일 종목 최대 10%, 기본 5%) — AI 우회 불가
- [ ] `Portfolio.maxDrawdown` 초과 시 신규 포지션 블록 로직
- [ ] 최종 주문 승인 로직 이 Phase에서 구현 금지 (Phase 13)

### 테스트

- [ ] `createFromSignal()` 유닛 테스트 (AI mock)
- [ ] `evaluateViolation()` Rule 체크 유닛 테스트 5개 케이스
- [ ] `checkExpiry()` 만료 판정 테스트
- [ ] Thesis → Exit 인터페이스 통합 테스트 (mock Phase 8)

### 문서

- [ ] `docs/database-schema.md` 신규 모델 반영
- [ ] `docs/api-specification.md` 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` 모듈 트리 갱신
- [ ] `NEXT_STEPS.md` Phase 7 완료 체크

---

## 6. AI 사용 정책

| 구분 | 적용 여부 | 상세 |
|------|-----------|------|
| **L2 — Thesis 생성** | 필수 | `createFromSignal()` 호출 시. 입력: 이벤트 수치 JSON + Persona + 차트 상태. 출력: `initialThesis[]` + `invalidConditions[]` |
| **L3 — 훼손 판정 보조** | 조건부 | Rule 1차 체크에서 위반 1개 이상 감지 시만 호출. AI는 "심각도 분류(MINOR/MAJOR/CRITICAL)"와 "해석 근거"만 제공 |
| **AI 금지** | 절대 | 손절 가격 결정 / 주문 수량 / 포트폴리오 비중 한도 / 최종 매도 주문 승인 |

**비용 통제:**

- Thesis 생성은 `TradingSignal.signal == "BUY_CANDIDATE"` (buyScore ≥ 60)인 경우에만 AI 호출
- 훼손 판정 AI는 Rule 1차 체크 통과한 경우만 (비용 0 Rule이 먼저)
- 모든 호출은 `AIUsageLog`에 기록: `model`, `costUsd`, `inputTokens`, `outputTokens`, `task = "POSITION_THESIS"` or `"THESIS_VIOLATION"`

---

## 7. 비용·성능 고려사항

| 항목 | 예상 규모 | 대응 |
|------|-----------|------|
| Thesis 생성 AI 호출 | 일 최대 10~20건 (관심 50종목 × BUY_CANDIDATE 비율) | buyScore 60 이상만 → 실제 5건 이하 예상 |
| 훼손 판정 AI 호출 | 보유 종목 수 × 일 이벤트 건수 | Rule 1차 필터 후 호출 → 비용 대폭 절감 |
| `PositionDailySnapshot` 증가 | 보유 기간 × 종목 수 | 6개월 이상 CLOSED 스냅샷 아카이브(파티셔닝 또는 TTL 정책) |
| `findPendingExitEvaluation` 쿼리 | 하루 3회 실행 (Phase 8 스케줄러) | `@@index([thesisStatus])` 인덱스로 O(1) 필터 |
| Thesis JSON 컬럼 크기 | `initialThesis`, `invalidConditions` 각 5~10항목 | PostgreSQL `jsonb` — 검색 불필요, text[] 대신 jsonb로 유연성 확보 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 설명 | 대응 |
|--------|------|------|
| **rcpNo FK 불일치** | `triggerRcpNos` 배열에 없는 rcpNo 저장 | 저장 전 `Disclosure.rcpNo` 존재 여부 검증, 없으면 배열에서 제외 후 경고 로그 |
| **AI 생성 논리 품질 저하** | `initialThesis`가 너무 일반적이거나 비어있음 | 항목 수 최소 3개 검증 + 빈 항목 거부 validation |
| **AI 호출 실패** | LLM API timeout / 오류 | 폴백: Rule 기반 기본 Thesis 템플릿으로 생성, `aiModel = "FALLBACK_RULE"` 표시 |
| **정정공시 미감지** | `invalidConditions`에 있는 조건인데 Rule이 탐지 못함 | Phase 3 이벤트 추출에서 `isAmendment` 플래그 정확히 설정, 정정 탐지 Rule 별도 구현 |
| **포트폴리오 비중 한도 우회** | 여러 신호가 동시에 같은 종목 Thesis 생성 시도 | `Position` 생성 전 현재 비중 계산 → `maxWeightPct` 초과 시 포지션 생성 거부 (예외 throw) |
| **Thesis 없이 포지션 존재** | Phase 13에서 수동 주문 입력 시 Thesis 생성 누락 | `Position.thesis` relation nullable → 하지만 Phase 8 Exit Engine은 Thesis 없는 포지션에 대해 기본 손절 룰만 적용하도록 fallback 명시 |
| **동일 종목 복수 포지션** | 같은 portfolioId + corpCode로 OPEN 포지션이 2개 생기는 경우 | `@@unique([portfolioId, corpCode])` 는 걸지 않고 (분할 매수 허용), 대신 합산 비중이 `maxWeightPct` 초과하는지 서비스 레이어에서 체크 |

---

## 9. 완료 기준 (DoD)

### 필수 (Phase 8 착수 전 충족)

- [ ] `Portfolio`, `Position`, `PositionThesis`, `PositionDailySnapshot` 테이블이 프로덕션 DB에 마이그레이션 완료
- [ ] `createFromSignal()` 호출 시 `PositionThesis` 레코드가 DB에 정확히 생성됨 (AI mock 포함)
- [ ] `evaluateViolation()` Rule 1차 체크가 정상 동작 — 하드 손절가 이하·정정공시 발생 케이스 테스트 통과
- [ ] `findPendingExitEvaluation()` 이 `VIOLATED` + `EXPIRED` 상태 Thesis를 정확히 반환
- [ ] `checkExpiry()` 스케줄러가 매일 08:30 KST에 실행되며 만료 Thesis를 `EXPIRED`로 갱신
- [ ] `maxWeightPct` 초과 시 포지션 생성이 거부됨 (서비스 레이어 예외)
- [ ] AI 호출 결과가 `AIUsageLog`에 기록됨
- [ ] Swagger `/api/docs`에 모든 신규 엔드포인트 문서화
- [ ] `docs/database-schema.md`, `PROJECT_STRUCTURE.md` 갱신 완료

### 권장 (Phase 10 착수 전 충족)

- [ ] `evaluateViolation()` AI 보조 판정(L3) 실제 LLM 연동 테스트
- [ ] 보유 기간 별 손절·익절 파라미터 튜닝 (Phase 9 Event Study 결과 반영)
- [ ] `PositionDailySnapshot` 아카이브 정책 설정 (6개월 TTL)
