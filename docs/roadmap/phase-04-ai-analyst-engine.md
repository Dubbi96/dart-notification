> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 4 — AI Analyst Engine 도입

> 최종 수정일: 2026-06-02 · 상태: 설계 확정

---

## 1. 목적 & 범위

### 목적
공시 원문에서 추출된 최소 구조화 데이터(Phase 3 산출물)를 외부 LLM API에 전달해 **정성적 의미 해석**을 자동화한다. 4개 AI Task(Disclosure Summary / Event Classification / Persona Interpretation / Position Thesis) 각각에 대해 입력 스키마, 프롬프트 설계 원칙, 출력 JSON 스키마, 저장 모델을 확정한다.

### 포함
- 4개 AI Task의 NestJS 서비스 설계 및 엔드포인트
- `DisclosureAnalysis`, `PersonaAnalysis` Prisma 모델
- 구조화 출력 강제(JSON mode), 프롬프트 버전 관리
- rcpNo + task 기준 멱등성 캐시
- 실패·재시도 전략
- AI 금지 영역 명시

### 제외
- AI 비용 게이트(L0~L3) 세부 구현 → Phase 11 참조
- 시세·차트 데이터 결합 → Phase 5
- TradingSignal 생성(Buy Score) → Phase 6
- PositionThesis 저장 완전체 → Phase 7
- 자동매매 관련 일체

---

## 2. 현재 코드베이스 연결점

| 레이어 | 현재 존재 | Phase 4 의존 |
|--------|-----------|-------------|
| DB | `Disclosure` (rcpNo PK), `Company` (corpCode PK) | Phase 3 `DisclosureEvent` 필요 |
| NestJS 모듈 | `DisclosureModule`, `SchedulerModule` | `AiAnalystModule` 신규 추가 |
| Phase 2 산출물 | `DisclosureDocument.parsedJson` | AI 입력 원천 |
| Phase 3 산출물 | `DisclosureEvent.eventType`, `DisclosureEvent.dataJson` | AI 입력 최소화의 핵심 |

Phase 4는 Phase 2·3이 모두 완료된 공시에 대해서만 AI를 호출한다. 파싱 미완료(`parseStatus != DONE`) 또는 이벤트 미추출 공시는 AI 호출 대상에서 제외한다.

---

## 3. 선행 조건 & 의존성

| 조건 | 설명 |
|------|------|
| Phase 2 완료 | `DisclosureDocument` 테이블 존재, `parseStatus = DONE` |
| Phase 3 완료 | `DisclosureEvent` 테이블 존재, `eventType` + `dataJson` 저장됨 |
| 외부 LLM API 키 | 환경변수 `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_MODEL` |
| Phase 11 (AI 비용 게이트) | 선행 불필요하나, Phase 11 완료 전까지는 임시 호출 필터 사용 |
| `AIUsageLog` 테이블 | Phase 4 시작 시 함께 생성 (비용 집계의 기반) |

---

## 4. 상세 설계

### 4-1. Prisma 모델

```prisma
// AI 분석 결과 — rcpNo + task 복합 고유키로 멱등성 보장
model DisclosureAnalysis {
  id            String   @id @default(cuid())
  rcpNo         String   // FK → Disclosure.rcpNo
  task          String   // "SUMMARY" | "EVENT_CLASSIFICATION" | "PERSONA_INTERPRETATION" | "POSITION_THESIS"
  promptVersion String   // 예: "summary-v1.2"
  inputJson     Json     // LLM에 전달한 최소 입력 (감사·비용 추적용)
  outputJson    Json     // LLM 구조화 출력 (JSON mode 응답 파싱 결과)
  modelId       String   // 실제 사용 모델 식별자 (예: "gpt-4o-mini")
  promptTokens  Int
  completionTokens Int
  costUsd       Float    // 실제 비용 (달러)
  status        String   @default("PENDING") // "PENDING" | "DONE" | "FAILED"
  failReason    String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  disclosure    Disclosure @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)

  @@unique([rcpNo, task])       // 멱등성: 같은 공시·같은 task 중복 호출 방지
  @@index([rcpNo])
  @@index([task, status])
  @@index([createdAt])
  @@map("disclosure_analyses")
}

// Persona별 분석 — DisclosureAnalysis 산하 세부 레코드
model PersonaAnalysis {
  id                   String   @id @default(cuid())
  disclosureAnalysisId String   // FK → DisclosureAnalysis.id (task = "PERSONA_INTERPRETATION")
  rcpNo                String   // 역참조 편의용 (중복 저장)
  persona              String   // "VALUE" | "GROWTH" | "MOMENTUM" | "EVENT_DRIVEN"
  view                 String   // "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "WATCH"
  reason               String   // 해석 근거 (자유 텍스트)
  actionHint           String?  // "즉시 관심 추가" | "거래량 확인 후" | "보유 유지" 등
  createdAt            DateTime @default(now())

  // Relations
  analysis             DisclosureAnalysis @relation(fields: [disclosureAnalysisId], references: [id], onDelete: Cascade)

  @@unique([disclosureAnalysisId, persona])
  @@index([rcpNo, persona])
  @@map("persona_analyses")
}

// AI 비용 로그 — Phase 11 완성 전 임시 최소 구현
model AIUsageLog {
  id           String   @id @default(cuid())
  rcpNo        String?
  task         String
  modelId      String
  promptTokens Int
  completionTokens Int
  costUsd      Float
  calledAt     DateTime @default(now())

  @@index([rcpNo])
  @@index([calledAt])
  @@map("ai_usage_logs")
}
```

> `Disclosure.rcpNo` 자연키 PK와 FK 정합: `DisclosureAnalysis.rcpNo → Disclosure.rcpNo`. `PersonaAnalysis`는 `DisclosureAnalysis.id`를 거쳐 간접 연결.

### 4-2. NestJS 모듈 구조

```
backend/src/
└── ai-analyst/
    ├── ai-analyst.module.ts
    ├── ai-analyst.controller.ts     // 관리자 트리거 엔드포인트
    ├── ai-analyst.service.ts        // 4개 Task 오케스트레이션
    ├── tasks/
    │   ├── disclosure-summary.task.ts
    │   ├── event-classification.task.ts
    │   ├── persona-interpretation.task.ts
    │   └── position-thesis.task.ts
    ├── prompts/
    │   ├── summary-v1.0.ts          // 프롬프트 버전 상수로 관리
    │   ├── event-class-v1.0.ts
    │   ├── persona-v1.0.ts
    │   └── thesis-v1.0.ts
    ├── dto/
    │   ├── trigger-analysis.dto.ts
    │   └── analysis-result.dto.ts
    └── ai-analyst.scheduler.ts      // 신규 공시 자동 처리 cron
```

### 4-3. 서비스 시그니처

```typescript
// ai-analyst.service.ts
interface AiAnalystService {
  // rcpNo 단위 전체 4개 Task 순차 실행
  runAllTasks(rcpNo: string): Promise<void>;

  // 개별 Task 실행 (멱등: 이미 DONE이면 스킵)
  runSummaryTask(rcpNo: string): Promise<DisclosureAnalysis>;
  runEventClassificationTask(rcpNo: string): Promise<DisclosureAnalysis>;
  runPersonaInterpretationTask(rcpNo: string): Promise<DisclosureAnalysis>;
  runPositionThesisTask(rcpNo: string): Promise<DisclosureAnalysis>;

  // 멱등 체크
  isAlreadyDone(rcpNo: string, task: AiTask): Promise<boolean>;

  // 배치: 미처리 공시 일괄 처리
  processPendingDisclosures(limit?: number): Promise<void>;
}

type AiTask = 'SUMMARY' | 'EVENT_CLASSIFICATION' | 'PERSONA_INTERPRETATION' | 'POSITION_THESIS';
```

### 4-4. 엔드포인트

```
POST /ai-analyst/trigger/:rcpNo
  - 관리자·스케줄러 전용. 지정 rcpNo에 대해 4개 Task 전부 실행.
  - Response: { rcpNo, tasksTriggered: string[], alreadyDone: string[] }

POST /ai-analyst/trigger-batch
  - Body: { limit: number (default 20) }
  - 미처리(status=PENDING) 공시 최대 limit개 순차 처리.

GET /ai-analyst/analyses/:rcpNo
  - 해당 공시의 4개 Task 결과 조회.
  - Response: DisclosureAnalysis[] (각 outputJson 포함)

GET /ai-analyst/analyses/:rcpNo/persona
  - PersonaAnalysis[] 4종 조회.

GET /ai-analyst/cost-summary?from=&to=
  - 날짜 범위 내 AIUsageLog 집계 (총비용, task별 비용, 호출 수).
```

### 4-5. Task별 설계

---

#### Task 1. Disclosure Summary AI

**목적**: 공시 원문을 3~5문장으로 요약, 핵심 포인트, 리스크 요인 추출.

**입력 (최소화 원칙)**
```json
{
  "reportName": "단일판매·공급계약체결",
  "corpName": "예시전자(주)",
  "eventType": "SUPPLY_CONTRACT",
  "contractAmount": 120000000000,
  "recentSales": 500000000000,
  "salesRatio": 24.0,
  "counterparty": "거래상대방",
  "contractPeriod": "2026-06-01 ~ 2027-05-31",
  "isAmendment": false,
  "rawSummaryText": "주요 항목 텍스트 500자 이내"
}
```

> 공시 전문 전체를 AI에 전달하지 않는다. Phase 3 파싱으로 추출된 key-value + 원문 요약 텍스트(500자 이내)만 입력으로 사용한다.

**프롬프트 설계 원칙 (summary-v1.0)**
- 역할 지시: "당신은 한국 주식시장 공시 분석 전문가입니다."
- 출력 형식: JSON only. 프리텍스트 금지.
- 어조: 사실 기반, 추측 금지, 주가 예측 금지.
- 길이 제한: summary 100자 이내, keyPoints 최대 3개, riskFactors 최대 3개.

**출력 JSON 스키마**
```json
{
  "summary": "대규모 공급계약 체결 공시입니다. 계약금액은 최근 매출의 24% 수준입니다.",
  "keyPoints": [
    "계약금액 1,200억 원으로 최근 매출 대비 24% 비중",
    "계약 기간 1년, 명확한 거래 상대방"
  ],
  "riskFactors": [
    "정정 또는 취소 공시 발생 시 모멘텀 반전 가능",
    "거래상대방 신용도 별도 확인 필요"
  ],
  "polarity": "POSITIVE",
  "confidence": 0.85
}
```

---

#### Task 2. Event Classification AI

**목적**: Rule 기반 이벤트 분류 결과를 보정·확인하고, 하위 타입 및 긍정·부정·혼재 판정.

**입력**
```json
{
  "reportName": "주요사항보고서(유상증자결정)",
  "ruleBasedEventType": "PAID_IN_CAPITAL_INCREASE",
  "issueType": "THIRD_PARTY_ALLOTMENT",
  "fundingAmount": 50000000000,
  "purpose": ["운영자금", "시설자금"],
  "dilutionRate": 20.0,
  "discountRate": 10.0,
  "isAmendment": false
}
```

**프롬프트 설계 원칙 (event-class-v1.0)**
- Rule 기반 분류 결과를 참고하되, 보정이 필요하면 `correctedEventType` 필드에 다른 값 제공.
- `subType` 세분화: 예) THIRD_PARTY_ALLOTMENT / RIGHTS_OFFERING / GENERAL_PUBLIC_OFFERING.
- `polarity` 결정 근거를 `polarityReason`에 반드시 포함.
- 불확실한 경우 `confidence` 0.5 미만으로 표기.

**출력 JSON 스키마**
```json
{
  "confirmedEventType": "PAID_IN_CAPITAL_INCREASE",
  "correctedEventType": null,
  "subType": "THIRD_PARTY_ALLOTMENT",
  "polarity": "NEGATIVE",
  "polarityReason": "20% 희석 및 10% 할인 발행으로 기존 주주 가치 훼손 가능성",
  "confidence": 0.90,
  "mixedSignals": ["시설 투자 목적은 성장 가능성 시사", "운영자금 비중이 높으면 재무 건전성 우려"]
}
```

---

#### Task 3. Persona Interpretation AI

**목적**: 확정된 이벤트 정보를 4개 Persona 관점에서 해석.

**입력**
```json
{
  "eventType": "SUPPLY_CONTRACT",
  "polarity": "POSITIVE",
  "summary": "대규모 공급계약 체결 공시입니다.",
  "keyPoints": ["계약금액 최근 매출 24%", "계약 기간 명확"],
  "riskFactors": ["정정 공시 위험"],
  "contractAmount": 120000000000,
  "salesRatio": 24.0
}
```

**프롬프트 설계 원칙 (persona-v1.0)**
- 4개 Persona를 배열로 순회하여 각각 독립적으로 해석.
- `view`: POSITIVE / NEGATIVE / NEUTRAL / WATCH 중 하나.
- `reason`: 50자 이내 한국어.
- `actionHint`: 해당 Persona가 취할 액션 제안 (정보 제공 목적, 매수·매도 지시 아님).

**출력 JSON 스키마**
```json
{
  "personaViews": [
    {
      "persona": "VALUE",
      "view": "NEUTRAL",
      "reason": "계약이 내재가치를 크게 바꾸지 않으나 안정적 매출 기여",
      "actionHint": "현재 밸류에이션 대비 적정성 재검토"
    },
    {
      "persona": "GROWTH",
      "view": "POSITIVE",
      "reason": "매출 성장 기여 가능성, 신규 거래처 확장 신호",
      "actionHint": "추가 계약 공시 여부 모니터링"
    },
    {
      "persona": "MOMENTUM",
      "view": "WATCH",
      "reason": "공시 후 거래량 급증 여부 확인 필요",
      "actionHint": "당일 거래량 20일 평균 대비 200% 이상 시 관심 상향"
    },
    {
      "persona": "EVENT_DRIVEN",
      "view": "POSITIVE",
      "reason": "명확한 이벤트 트리거, 계약 규모 유의미",
      "actionHint": "당일 시가 근처 진입 조건 설정"
    }
  ]
}
```

---

#### Task 4. Position Thesis AI

**목적**: 매수 후보 근거(진입 논리) + 논리 훼손 조건(매도 트리거) 초안 생성. Phase 7에서 확정 저장.

**입력**
```json
{
  "rcpNo": "20260601000123",
  "corpName": "예시전자(주)",
  "eventType": "SUPPLY_CONTRACT",
  "polarity": "POSITIVE",
  "keyPoints": ["계약금액 최근 매출 24%", "계약 기간 명확"],
  "riskFactors": ["정정 공시 위험"],
  "personaViews": [
    { "persona": "GROWTH", "view": "POSITIVE" },
    { "persona": "EVENT_DRIVEN", "view": "POSITIVE" }
  ],
  "salesRatio": 24.0
}
```

**프롬프트 설계 원칙 (thesis-v1.0)**
- Thesis는 **투자 가설** 초안이다. 확정 매수 지시가 아님을 시스템 프롬프트에 명시.
- `initialThesis`: 매수를 고려할 근거 (사실 기반 3~5개).
- `invalidConditions`: 매도·관심 해제를 트리거할 조건 (사실 기반 3~5개).
- `watchConditions`: 추가 확인이 필요한 조건.
- 주가 예측, 목표가, 손절선 수치는 AI가 직접 제안하지 않음 (AI 금지 영역).

**출력 JSON 스키마**
```json
{
  "thesisSummary": "대규모 공급계약 공시로 단기 매출 성장 가시성 확보",
  "initialThesis": [
    "계약금액이 최근 매출 대비 24%로 유의미한 규모",
    "계약 기간 명확, 거래상대방 안정적",
    "이벤트드리븐 및 성장주 Persona 모두 긍정 평가"
  ],
  "invalidConditions": [
    "계약금액 축소 정정공시 발생",
    "계약 해지 공시 발생",
    "공시 후 5거래일 내 거래량 급감(20일 평균 이하 복귀)",
    "계약 상대방 관련 부정적 뉴스 발생"
  ],
  "watchConditions": [
    "거래상대방 최종 확정 여부 추가 공시",
    "동종업계 유사 공시 대비 규모 비교"
  ],
  "applicablePersonas": ["GROWTH", "EVENT_DRIVEN"],
  "confidence": 0.78
}
```

> **AI 금지 영역**: Position Thesis AI는 목표가, 손절 수치, 주문 수량, 포트폴리오 비중을 제안하지 않는다. 이 값들은 Phase 7 Rule Engine + 사용자 설정으로만 결정한다.

---

### 4-6. 멱등성 처리 의사코드

```typescript
async function runTaskIdempotent(rcpNo: string, task: AiTask): Promise<DisclosureAnalysis> {
  // 1. 기존 레코드 조회
  const existing = await prisma.disclosureAnalysis.findUnique({
    where: { rcpNo_task: { rcpNo, task } },
  });

  // 2. 이미 완료된 경우 스킵
  if (existing?.status === 'DONE') return existing;

  // 3. PENDING 레코드 선점 (upsert로 중복 실행 방지)
  const record = await prisma.disclosureAnalysis.upsert({
    where: { rcpNo_task: { rcpNo, task } },
    create: { rcpNo, task, status: 'PENDING', promptVersion: PROMPT_VERSIONS[task], inputJson: {}, outputJson: {}, modelId: '', promptTokens: 0, completionTokens: 0, costUsd: 0 },
    update: { status: 'PENDING' },
  });

  try {
    // 4. 입력 데이터 조합 (Phase 2 + Phase 3 최소 데이터)
    const inputJson = await buildMinimalInput(rcpNo, task);

    // 5. LLM 호출 (JSON mode 강제)
    const result = await callLLMWithJsonMode(task, inputJson);

    // 6. 결과 저장
    await prisma.disclosureAnalysis.update({
      where: { id: record.id },
      data: { status: 'DONE', inputJson, outputJson: result.parsed, modelId: result.modelId, promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd, promptVersion: PROMPT_VERSIONS[task] },
    });

    // 7. 비용 로그
    await prisma.aIUsageLog.create({ data: { rcpNo, task, modelId: result.modelId, promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd } });

    return record;
  } catch (error) {
    // 8. 실패 처리 (재시도 가능 상태 유지)
    await prisma.disclosureAnalysis.update({
      where: { id: record.id },
      data: { status: 'FAILED', failReason: error.message },
    });
    throw error;
  }
}
```

### 4-7. 재시도 전략

- `status = FAILED` 레코드는 다음 배치 실행 시 재처리 대상에 포함.
- 최대 재시도 횟수: 3회. 초과 시 `FAILED_PERMANENT` 상태로 전환 (별도 관리자 확인 대상).
- LLM API rate limit 오류(429): exponential backoff (1s, 2s, 4s).
- LLM JSON 파싱 실패: 재호출 1회 시도 후 실패 처리.
- 네트워크 타임아웃: 30초 기본값.

### 4-8. 프롬프트 버전 관리

```typescript
// backend/src/ai-analyst/prompts/versions.ts
export const PROMPT_VERSIONS = {
  SUMMARY: 'summary-v1.0',
  EVENT_CLASSIFICATION: 'event-class-v1.0',
  PERSONA_INTERPRETATION: 'persona-v1.0',
  POSITION_THESIS: 'thesis-v1.0',
} as const;
```

- 버전은 `major.minor` 형식. minor 변경(문장 수정)은 기존 DONE 레코드 유지. major 변경(스키마 변경)은 기존 레코드 무효화 후 재처리.
- 프롬프트 파일은 `backend/src/ai-analyst/prompts/` 디렉터리에 버전별 파일로 관리.
- `DisclosureAnalysis.promptVersion` 필드로 어떤 버전으로 생성된 결과인지 추적 가능.

---

## 5. 작업 분해

### 5-1. DB / 마이그레이션

- [ ] `DisclosureAnalysis` 모델 추가, `@@unique([rcpNo, task])` 인덱스 포함
- [ ] `PersonaAnalysis` 모델 추가, `@@unique([disclosureAnalysisId, persona])` 포함
- [ ] `AIUsageLog` 모델 추가 (최소 구현)
- [ ] `Prisma migrate dev` 실행 및 검증

### 5-2. NestJS 모듈

- [ ] `AiAnalystModule` 생성, `PrismaModule` 의존성 주입
- [ ] 환경변수 `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_MODEL` 검증 (startup guard)
- [ ] LLM 클라이언트 래퍼 서비스 작성 (JSON mode 강제, 토큰 카운팅)
- [ ] `AiAnalystService.isAlreadyDone()` 구현
- [ ] `buildMinimalInput()` — Task별 Phase 2·3 데이터 조합 로직

### 5-3. Task 구현

- [ ] Task 1: `DisclosureSummaryTask` — 입력 빌더, 프롬프트 적용, 출력 파싱·검증
- [ ] Task 2: `EventClassificationTask` — 입력 빌더, 프롬프트 적용, 출력 파싱·검증
- [ ] Task 3: `PersonaInterpretationTask` — 출력 파싱 후 `PersonaAnalysis` 4건 배치 저장
- [ ] Task 4: `PositionThesisTask` — 출력 파싱, Thesis 초안 저장

### 5-4. 오케스트레이션

- [ ] `AiAnalystService.runAllTasks()` — 4개 Task 순차 실행, 실패 시 다음 Task 계속 진행
- [ ] `AiAnalystService.processPendingDisclosures()` — 미처리 공시 배치 처리 (limit 옵션)
- [ ] `AiAnalystScheduler` — 30분 주기 cron, `processPendingDisclosures(20)` 호출
- [ ] 임시 호출 필터: Phase 11 완성 전까지 L0 제외 조건(관심 외 기업, 분석 대상 아닌 공시 유형) 하드코딩

### 5-5. API

- [ ] `POST /ai-analyst/trigger/:rcpNo` 엔드포인트 구현 (관리자 권한 guard)
- [ ] `POST /ai-analyst/trigger-batch` 엔드포인트 구현
- [ ] `GET /ai-analyst/analyses/:rcpNo` 엔드포인트 구현
- [ ] `GET /ai-analyst/analyses/:rcpNo/persona` 엔드포인트 구현
- [ ] `GET /ai-analyst/cost-summary` 엔드포인트 구현

### 5-6. 재시도·안전장치

- [ ] 재시도 횟수 추적 필드 (`retryCount Int @default(0)`) `DisclosureAnalysis`에 추가
- [ ] `FAILED_PERMANENT` 상태 추가
- [ ] 최대 재시도 3회 로직 구현
- [ ] LLM 429 응답 시 exponential backoff 구현

### 5-7. 프롬프트 관리

- [ ] `prompts/versions.ts` 버전 상수 파일 생성
- [ ] Task별 프롬프트 파일 4개 생성 (시스템 프롬프트 + 사용자 프롬프트 템플릿 분리)
- [ ] AI 금지 영역 문구를 모든 시스템 프롬프트에 명시적으로 포함

### 5-8. PROJECT_STRUCTURE.md 업데이트

- [ ] `backend/src/ai-analyst/` 디렉터리 트리 추가

---

## 6. AI 사용 정책

### 사용 Level (Phase 11 완성 전 임시 기준)

| 조건 | 처리 |
|------|------|
| 관심 외 기업 공시 | AI 미호출 (L0) |
| Phase 3 이벤트 미추출 공시 | AI 미호출 |
| 분석 대상 5종 외 공시 유형 | AI 미호출 |
| 분석 대상 5종 공시 (관심기업) | Task 1·2 호출 (L1~L2) |
| 긍정 판정 공시 | Task 3·4 추가 호출 (L2) |

### AI 금지 영역 (절대)

본 Phase에서 LLM은 다음 항목을 출력하지 않으며, 프롬프트에도 요청하지 않는다:

1. **최종 주문 승인** — AI가 "매수하라" "매도하라" 지시 금지
2. **손절·익절 하드 룰 수치** — 손절가, 익절가, 손절선 퍼센트 제안 금지
3. **포트폴리오 비중·한도** — 몇 % 투자하라 제안 금지
4. **주문 수량 결정** — 주식 수량 계산 금지
5. **리스크 룰 우회** — Risk Engine 판단을 AI가 대체하거나 우회하는 출력 금지

Position Thesis AI의 시스템 프롬프트에는 반드시 아래 문구를 포함한다:

> "당신은 투자 가설의 논리적 근거와 무효화 조건을 정리하는 분석가입니다. 목표가, 손절 수치, 주문 수량, 포트폴리오 비중은 절대 제안하지 마십시오."

---

## 7. 비용·성능 고려사항

### 비용 추정 (초기 기준)

| 항목 | 기준 |
|------|------|
| 일일 분석 대상 공시 추정 | 관심 종목 50개 기준 약 5~20건/일 |
| Task 당 평균 입력 토큰 | ~500 토큰 (최소화 원칙 준수 시) |
| Task 당 평균 출력 토큰 | ~300 토큰 |
| 4 Task 합계 입출력 | ~3,200 토큰/공시 |
| 일 최대 비용 추정 | 20건 × 3,200 토큰 × 가격 (모델별 상이) |

- gpt-4o-mini 기준 약 $0.001~0.003/공시 → 일 20건 = $0.02~0.06/일
- 모든 호출 후 `AIUsageLog` 기록. 일·주·월 집계로 비용 추적.
- 토큰 수 초과 시 `rawSummaryText` 길이를 500자에서 200자로 자동 축소.

### 성능 고려사항

- LLM 호출은 외부 API → 동기 처리 금지. 스케줄러 배치 처리로만 실행.
- 1회 배치 처리 limit 기본값 20. 처리 시간 초과 시 다음 cron에서 계속.
- `DisclosureAnalysis.status = PENDING` 인덱스로 미처리 공시 빠른 조회.
- PersonaAnalysis 4건은 단일 `createMany`로 배치 저장.

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| LLM이 JSON이 아닌 텍스트 반환 | JSON mode 강제. 실패 시 1회 재시도 후 `FAILED` 처리 |
| LLM이 AI 금지 영역(목표가 등) 출력 | 출력 파싱 단계에서 해당 필드 존재 시 제거 (필드 화이트리스트 검증) |
| Phase 3 미처리로 입력 데이터 부족 | `buildMinimalInput()` 단계에서 `DisclosureEvent` 없으면 호출 스킵 |
| 동일 rcpNo 중복 호출 (race condition) | `@@unique([rcpNo, task])` DB 제약 + upsert로 방지 |
| LLM API 장애 장기화 | `FAILED` 레코드 누적, 복구 후 재시도. 장애 중 알림 서비스는 영향 없음 |
| 프롬프트 버전 변경 시 기존 결과 혼재 | `promptVersion` 필드로 구분. 쿼리 시 버전 필터 옵션 제공 |
| 정정 공시(isAmendment=true) 재분석 | 원공시 rcpNo와 정정공시 rcpNo는 별개 레코드. 정정 시 원공시 분석 결과 `superseded` 상태로 표시 (향후 개선) |
| 비용 폭주 | 일일 최대 호출 건수 하드 상한 설정 (초기 50건/일). 초과 시 이후 공시는 다음 날로 지연 |

---

## 9. 완료 기준 (Definition of Done)

### 기능 DoD

- [ ] `DisclosureAnalysis`, `PersonaAnalysis`, `AIUsageLog` 테이블 마이그레이션 완료
- [ ] `POST /ai-analyst/trigger/:rcpNo` 호출 시 4개 Task 결과가 DB에 저장됨
- [ ] 동일 rcpNo + task로 두 번 호출해도 DB에 레코드 1개만 존재함 (멱등성 확인)
- [ ] `PersonaAnalysis`에 4개 Persona(`VALUE`, `GROWTH`, `MOMENTUM`, `EVENT_DRIVEN`) 레코드 생성됨
- [ ] LLM 응답이 JSON 스키마를 준수하지 않을 때 `status = FAILED`로 처리됨 (앱 중단 없음)
- [ ] `GET /ai-analyst/cost-summary` 가 일별 비용 합계를 정확히 반환함

### 품질 DoD

- [ ] 모든 프롬프트 파일에 AI 금지 영역 문구 포함 확인
- [ ] `buildMinimalInput()` 이 Phase 3 데이터 없는 공시에 대해 LLM 호출을 스킵함
- [ ] `retryCount >= 3` 인 레코드가 `FAILED_PERMANENT` 상태로 전환됨
- [ ] 비용 일일 상한(50건) 초과 시 추가 호출이 중단됨
- [ ] `PROJECT_STRUCTURE.md` 에 `ai-analyst/` 디렉터리 구조 반영됨

### 문서 DoD

- [ ] `docs/api-specification.md` 에 AI Analyst 엔드포인트 5개 추가
- [ ] `docs/database-schema.md` 에 3개 신규 모델 추가
- [ ] `NEXT_STEPS.md` 에 Phase 4 완료 체크 표시
