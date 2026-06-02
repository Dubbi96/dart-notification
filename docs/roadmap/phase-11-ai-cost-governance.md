> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 11 — AI 비용 통제 구조 (AI Cost Governance)

> 작성일: 2026-06-02 · 상태: 설계 초안
> **생존 조건.** 이 문서는 Phase 4 이후 모든 AI 호출의 **상위 정책**이다.  
> AI를 쓰는 모든 Phase(4·6·7·8·9·12·13·14)는 여기서 정의한 게이트·로그 모델·예산 룰을 따른다.

---

## 1. 목적 & 범위

### 목적

공시 기반 투자 시스템에서 AI 호출은 분석 품질을 높이지만 **무제한 호출은 수익보다 비용이 커지는 역전**을 일으킨다.  
이 Phase는 다음을 정의한다:

- **4단계 비용 게이트(L0~L3):** 공시를 어느 레벨로 라우팅할지 판단 로직
- **AIUsageLog 모델:** 모든 AI 호출의 입출력 토큰·비용·연관 공시/시그널/거래를 기록
- **비용 지표 체계:** Cost Per Disclosure / Signal / Trade, 비용/수익 비율, 손실 회피 기여
- **예산 가드레일:** 비용/순수익 임계값, 자동 호출 축소, 자체 서빙 전환 검토 기준

### 포함

- L0~L3 게이트 분기 조건 및 모델 선택 로직
- `AIUsageLog` Prisma 모델 전체 필드 설계
- 비용 지표 공식(Cost Per Disclosure, Signal, Trade, Gross/Net Profit 대비, False Positive/Negative 비용)
- 예산 초과 시 자동 호출 축소 로직
- 자체 서빙(self-hosted LLM) 전환 검토 기준

### 제외

- 개별 AI Task의 프롬프트 설계 → 각 Phase 문서(4·7·8 등)
- 증권사 API 연동 → Phase 13·14
- 자동매매 로직 → Phase 14

---

## 2. 현재 코드베이스 연결점

| 요소 | 현재 상태 | Phase 11 에서 추가·변경 |
|------|-----------|------------------------|
| `Disclosure` (rcpNo PK) | ✅ 존재 | `AIUsageLog.rcpNo` FK 연결 |
| `Company` (corpCode PK) | ✅ 존재 | `AIUsageLog.corpCode` 참조 |
| NestJS 모듈 구조 | ✅ 인증·공시·스케줄러 모듈 | `AiCostModule` 신규 추가 |
| Phase 4 AI Analyst Engine | 설계 문서 존재, 미구현 | Phase 4 구현 시 이 정책 적용 |
| `TradingSignal` (Phase 6) | 미구현 | `AIUsageLog.signalId` FK 예정 |
| `OrderExecution` (Phase 13) | 미구현 | `AIUsageLog.tradeId` FK 예정 |

> **의존 방향:** Phase 4 구현 전에 `AIUsageLog` 모델과 `AiCostModule`을 먼저 만들어야 한다.  
> Phase 4 AI 호출 코드가 항상 `AiCostService.log()` 를 호출하도록 강제한다.

---

## 3. 선행 조건 & 의존성

| 항목 | 선행 Phase | 이유 |
|------|-----------|------|
| `DisclosureEvent` 이벤트 타입·수치 | Phase 3 | L0/L1 게이트가 이벤트 타입과 수치를 기반으로 분기 |
| `DisclosureDocument` 파싱 상태 | Phase 2 | 원문 파싱 성공 여부가 L2/L3 라우팅 전제조건 |
| 외부 LLM API 키 (OpenAI / Anthropic 등) | 운영 환경 | L1~L3 실제 호출 |
| `TradingSignal` (Phase 6) | Phase 6 | Cost Per Signal 지표 계산 |
| `OrderExecution` (Phase 13) | Phase 13 | Cost Per Trade 지표 계산 |
| 예산 설정 환경 변수 | 운영 배포 | `AI_MONTHLY_BUDGET_KRW`, `AI_COST_REVENUE_RATIO_LIMIT` |

---

## 4. 상세 설계

### 4-1. 4단계 비용 게이트 (L0~L3)

```
공시 수신
  │
  ▼
[L0 필터: 규칙 기반, AI 비용 0원]
  ├─ PASS → L0 미사용으로 종료
  └─ NEXT
       │
       ▼
  [L1 필터: 경량 모델, ~$0.001/건]
       ├─ 매매 무관 → L1 결과만 저장, 종료
       └─ 매매 관련 → L2 또는 L3 상향
              │
              ▼
        [L2: 중간 모델, ~$0.01/건]
              ├─ 일반 매매 관련 공시 → L2 분석 저장
              └─ 고가치 조건 → L3 상향
                      │
                      ▼
               [L3: 고성능 모델, ~$0.05~0.10/건]
                      └─ 상세 분석 저장
```

#### L0 — 미사용 (AI 호출 없음)

**조건 (하나라도 해당되면 L0):**

```typescript
function isL0(ctx: DisclosureContext): boolean {
  // 1) 관심 기업도 아니고 포지션 보유 기업도 아닌 경우
  if (!ctx.isWatched && !ctx.hasPosition) return true;

  // 2) 공시 유형이 단순 정기공시 (사업보고서·반기·분기보고서) 이면서
  //    이벤트 타입이 ROUTINE_REPORT인 경우
  if (ctx.disclosureType === 'REGULAR' && ctx.eventType === 'ROUTINE_REPORT') return true;

  // 3) 거래정지·관리종목·투자위험 종목 (진입 불가 상태)
  if (['TRADING_HALT', 'MANAGED', 'INVESTMENT_ALERT'].includes(ctx.stockStatus)) return true;

  // 4) 거래대금 30일 평균 < 5억 원 (유동성 부족, 매매 실익 없음)
  if (ctx.avgTradingValue30d < 500_000_000) return true;

  // 5) 이미 같은 rcpNo로 L1 이상 분석이 완료된 경우 (중복 방지)
  if (ctx.existingAnalysisLevel >= 1) return true;

  return false;
}
```

**처리:** 게이트 통과 기록만 남기고 AI 호출 없이 종료.

---

#### L1 — 저비용 (경량 모델: GPT-4o-mini / Claude Haiku 급)

**목적:** 매매 관련 공시 여부 판별 + 이벤트 대략 분류 + L2/L3 상향 여부 결정

**입력 토큰 제한:** ~500토큰 (공시 제목 + 이벤트 타입 + 핵심 수치 요약만)

**입력 예시:**
```json
{
  "reportName": "단일판매·공급계약체결",
  "corpName": "삼성전자",
  "eventType": "SUPPLY_CONTRACT",
  "keyFigures": { "contractAmount": 120000000000, "salesRatio": 24.0 }
}
```

**출력 (JSON, ~200토큰):**
```json
{
  "isTradingRelevant": true,
  "roughSentiment": "POSITIVE",
  "suggestedLevel": "L2",
  "reason": "매출 대비 계약금액 24%, 세부 분석 필요"
}
```

**L1 → L2 상향 조건 (suggestedLevel = L2 또는 아래 조건):**
- `isTradingRelevant = true` AND `roughSentiment != "NEUTRAL"`
- 이벤트 타입이 Phase 0 초기 5종(SUPPLY_CONTRACT, SHARE_BUYBACK, SHARE_CANCELLATION, DIVIDEND_CHANGE, PAID_IN_CAPITAL_INCREASE, CB_ISSUANCE, BW_ISSUANCE) 중 하나

**L1 → L3 직접 상향 조건:**
- 포지션 보유 종목의 악재성 공시 (CORRECTION, CANCELLATION, LAWSUIT, AUDIT_OPINION_RISK 등)
- `isTradingRelevant = true` AND 관심 기업 중 거래대금 상위 10종목

---

#### L2 — 중간급 (중간 모델: GPT-4o / Claude Sonnet 급)

**목적:** 공시 요약 · 긍정/부정 요인 추출 · Persona 해석 · 매수 Thesis 초안

**입력 토큰 제한:** ~2,000토큰 (파싱된 본문 핵심 단락 + 표 데이터 + 핵심 수치)

**수행 AI Task (Phase 4 연동):**
1. Disclosure Summary AI — 요약, 핵심 포인트, 리스크 요인
2. Event Classification AI — 이벤트 타입/하위타입/긍정·부정·혼재
3. Persona Interpretation AI — 4 Persona 해석

**L2 → L3 상향 조건:**
- 실제 주문 후보 공시로 TradingSignal Buy Score ≥ 60 도달
- 보유 종목에서 ExitSignal 이 30 이상 트리거된 공시
- 정정공시 (CORRECTION) 로 원공시와 비교 분석이 필요한 경우
- 유상증자/CB/BW 공시로 희석률·전환 조건 등 복잡 수치 분석 필요

---

#### L3 — 고성능 (강력 모델: GPT-4o / Claude Opus 급, 또는 긴 컨텍스트 버전)

**목적:** 실제 주문 후보 최종 분석 · 보유 종목 악재 심층 분석 · Position Thesis 생성 · 정정공시 비교

**입력 토큰 제한:** ~6,000토큰 (원문 전문 핵심 섹션 + 이전 Thesis + 과거 유사 공시 요약)

**수행 AI Task (Phase 4·7·8 연동):**
1. Position Thesis AI — 진입 사유·훼손 조건 생성
2. 정정공시 비교 AI — 원공시 vs 정정 내용 변경사항 분류
3. 매도 판단 보조 AI — ExitSignal 생성에 정성 근거 추가

> **AI 금지선 (절대 위반 불가):**  
> L3 AI 출력이 아무리 긍정적이어도 다음은 AI가 결정하지 않는다:
> - 최종 주문 승인 (→ Risk Engine + 사용자 승인, Phase 13)
> - 손절·익절 하드 룰 수치 (→ Rule Engine 고정값)
> - 포트폴리오 한도·종목 비중 (→ Risk Engine 고정값)
> - 주문 수량·금액 결정 (→ Trading & Risk Engine)
> - 리스크 룰 우회 (→ 절대 불가)

---

### 4-2. 라우팅 로직 요약 의사코드

```typescript
// backend/src/ai-cost/ai-router.service.ts

async function routeDisclosure(rcpNo: string): Promise<AiLevel> {
  const ctx = await buildDisclosureContext(rcpNo);

  if (isL0(ctx)) {
    await logGateDecision(rcpNo, 'L0', 'skipped');
    return 'L0';
  }

  const l1Result = await callL1(ctx);       // 경량 모델 호출
  await aiUsageLog.save({ rcpNo, level: 'L1', ...l1Result.usage });

  if (!l1Result.isTradingRelevant) return 'L1';

  const targetLevel = resolveUpgradeLevel(ctx, l1Result);  // 'L2' | 'L3'

  if (targetLevel === 'L2') {
    const l2Result = await callL2(ctx, l1Result);
    await aiUsageLog.save({ rcpNo, level: 'L2', ...l2Result.usage });
    if (shouldUpgradeToL3(ctx, l2Result)) {
      const l3Result = await callL3(ctx, l2Result);
      await aiUsageLog.save({ rcpNo, level: 'L3', ...l3Result.usage });
      return 'L3';
    }
    return 'L2';
  }

  // targetLevel === 'L3' (직접 상향)
  const l3Result = await callL3(ctx, l1Result);
  await aiUsageLog.save({ rcpNo, level: 'L3', ...l3Result.usage });
  return 'L3';
}
```

---

### 4-3. AIUsageLog Prisma 모델

```prisma
model AIUsageLog {
  id              String   @id @default(cuid())

  // 어떤 작업인가
  taskType        String   // "DISCLOSURE_SUMMARY" | "EVENT_CLASSIFICATION"
                           // | "PERSONA_INTERPRETATION" | "POSITION_THESIS"
                           // | "EXIT_SIGNAL_ASSIST" | "CORRECTION_DIFF"
                           // | "GATE_L1" | "CUSTOM"
  level           String   // "L1" | "L2" | "L3"
  model           String   // 실제 사용 모델명 (예: "gpt-4o-mini", "claude-haiku-3")

  // 연관 엔티티 (모두 nullable — 호출 시점에 일부만 확정)
  rcpNo           String?  // FK → Disclosure.rcpNo (공시 분석 태스크)
  corpCode        String?  // 참조 (Company.corpCode, 집계용)
  signalId        String?  // FK → TradingSignal.id (Phase 6 이후)
  tradeId         String?  // FK → OrderExecution.id (Phase 13 이후)

  // 토큰 & 비용
  inputTokens     Int      // 입력 토큰 수
  outputTokens    Int      // 출력 토큰 수
  totalTokens     Int      // inputTokens + outputTokens
  costUsd         Decimal  @db.Decimal(12, 8)  // 달러 기준 실제 비용
  costKrw         Decimal  @db.Decimal(12, 2)  // 원화 환산 (저장 시점 환율)
  exchangeRate    Decimal  @db.Decimal(8, 2)   // USD/KRW 환율

  // 품질 추적 (사후 기입 가능)
  isUseful        Boolean? // 분석 결과가 실제 의사결정에 쓰였는가 (수동/자동 기입)
  outcomeType     String?  // "HIT" | "MISS" | "FALSE_POSITIVE" | "FALSE_NEGATIVE" | null
  linkedPnlKrw    Decimal? @db.Decimal(14, 2)  // 연관 손익 (Phase 13+ 이후 기입)

  // 메타
  latencyMs       Int?     // API 응답 시간
  errorCode       String?  // 실패 시 에러 코드
  isSuccess       Boolean  @default(true)
  calledAt        DateTime @default(now())

  // Relations
  disclosure      Disclosure? @relation(fields: [rcpNo], references: [rcpNo])

  @@index([rcpNo])
  @@index([corpCode])
  @@index([signalId])
  @@index([tradeId])
  @@index([calledAt])
  @@index([level, calledAt])    // 레벨별 일간·월간 집계용
  @@index([taskType, calledAt]) // 태스크별 비용 집계용
  @@map("ai_usage_logs")
}
```

> **FK 정합 원칙:**
> - `rcpNo` → `Disclosure.rcpNo` (자연키 PK, 기존 스키마 유지)
> - `corpCode` → `Company.corpCode` (자연키 PK, 집계 쿼리 효율화)
> - `signalId`, `tradeId` 는 Phase 6·13 모델 추가 후 마이그레이션으로 FK 제약 추가

---

### 4-4. NestJS 모듈 설계

```
backend/src/ai-cost/
├── ai-cost.module.ts          // AiCostModule (전역 등록 권장)
├── ai-cost.service.ts         // 비용 로깅·집계·가드레일 체크
├── ai-router.service.ts       // L0~L3 라우팅 결정 로직
├── ai-cost.controller.ts      // 관리자 조회 API
└── dto/
    ├── log-ai-usage.dto.ts
    └── ai-cost-summary.dto.ts
```

**AiCostService 주요 시그니처:**

```typescript
// backend/src/ai-cost/ai-cost.service.ts

@Injectable()
export class AiCostService {
  /** AI 호출 직후 반드시 호출 — Phase 4·6·7·8 등 모든 AI 호출 지점에서 의무 */
  async log(dto: LogAiUsageDto): Promise<AIUsageLog>;

  /** 일간/월간 비용 집계 */
  async getDailySummary(date: string): Promise<AiCostSummary>;
  async getMonthlySummary(yearMonth: string): Promise<AiCostSummary>;

  /** 예산 가드레일 체크 — 라우터 호출 전 실행 */
  async checkBudgetGate(): Promise<BudgetGateResult>;
  // BudgetGateResult: { allowed: boolean; currentRatio: number; reason?: string }

  /** 비용/수익 비율 계산 (Phase 13+ 이후 유효) */
  async getCostRevenueRatio(period: 'daily' | 'monthly'): Promise<number>;
}
```

**AiCostController 엔드포인트:**

```
GET  /admin/ai-cost/summary?period=monthly&ym=2026-06
     → AiCostSummary (레벨별·태스크별 비용, 총 호출 수, 평균 비용/건)

GET  /admin/ai-cost/ratio?period=monthly&ym=2026-06
     → { costKrw, netProfitKrw, ratio, isOverBudget }

GET  /admin/ai-cost/logs?rcpNo=&level=&from=&to=&page=&limit=
     → AIUsageLog[] (관리자 감사 로그)

POST /admin/ai-cost/budget
     → 월 예산 목표값 갱신 (환경 변수 대신 DB 설정으로 전환 시)
```

---

### 4-5. 비용 지표 체계

모든 지표는 `AIUsageLog` 테이블 집계로 계산한다.

#### 핵심 지표 공식

```
── 호출 단위 비용 ──

Cost Per Disclosure  = Σ costKrw (해당 rcpNo 전체 레벨)
                       ÷ 분석된 공시 건수

Cost Per Signal      = Σ costKrw (signalId IS NOT NULL)
                       ÷ 생성된 TradingSignal 건수

Cost Per Trade       = Σ costKrw (tradeId IS NOT NULL)
                       ÷ 체결된 OrderExecution 건수


── 수익 대비 비용 ──

AI Cost / Gross Profit = Σ costKrw (기간)
                         ÷ Σ grossPnlKrw (동기간 체결 거래)

AI Cost / Net Profit   = Σ costKrw (기간)
                         ÷ Σ netPnlKrw (세후·수수료 후)


── 손실 회피 기여 ──

Avoided Loss           = Σ |linkedPnlKrw| where outcomeType = 'HIT' AND linkedPnlKrw < 0
  (AI가 EXIT_SIGNAL_ASSIST 등으로 손실을 막은 것으로 추정되는 금액)


── 오류 비용 ──

False Positive Cost    = Σ costKrw where outcomeType = 'FALSE_POSITIVE'
  (AI가 긍정 신호를 냈으나 실제 손실이 발생한 건의 AI 비용)

False Negative Cost    = 기회비용 (정량화 어려움 — 별도 수동 추정)
  (AI가 관련 없다고 판단했으나 실제로는 좋은 공시였던 건 수 × 평균 수익 추정)
```

#### 지표 적용 예시 (월간 리포트 형식)

```
[2026-06 AI 비용 리포트]
총 비용                  ₩ 48,200
  ├─ L1 (게이트)          ₩  3,100  (1,240건 × ₩2.5)
  ├─ L2 (일반 분석)       ₩ 28,400  (284건 × ₩100)
  └─ L3 (심층 분석)       ₩ 16,700  (33건 × ₩506)

Cost Per Disclosure      ₩     31  (분석 공시 1,557건 기준)
Cost Per Signal          ₩    320  (생성 시그널 151건 기준)
Cost Per Trade           ₩  2,410  (체결 거래 20건 기준 — Phase 13 이후)

AI Cost / Net Profit       8.3%    ← 목표 10% 이하 ✅
Avoided Loss             ₩ 180,000  (추정)
False Positive Cost      ₩  4,200
```

---

### 4-6. 예산 가드레일

#### 임계값 설정

| 환경 변수 | 기본값 | 설명 |
|-----------|--------|------|
| `AI_MONTHLY_BUDGET_KRW` | `100000` (10만 원) | 월 AI 비용 절대 상한 |
| `AI_COST_REVENUE_RATIO_LIMIT` | `0.10` | AI비용/순수익 정상 임계 |
| `AI_COST_REVENUE_RATIO_WARN` | `0.20` | 경고 임계 (초기 검증기 허용) |
| `AI_BUDGET_CHECK_INTERVAL_MIN` | `30` | 가드레일 체크 주기(분) |

#### 예산 초과 시 자동 호출 축소 로직

```typescript
// AiCostService.checkBudgetGate()

async checkBudgetGate(): Promise<BudgetGateResult> {
  const thisMonthCost = await this.getMonthlyTotalCost();       // 원화
  const budget        = Number(process.env.AI_MONTHLY_BUDGET_KRW);
  const ratio         = await this.getCostRevenueRatio('monthly');
  const warnLimit     = Number(process.env.AI_COST_REVENUE_RATIO_WARN);
  const hardLimit     = Number(process.env.AI_COST_REVENUE_RATIO_LIMIT);

  // 절대 예산 초과 → L3 중단
  if (thisMonthCost > budget * 0.9) {
    await this.disableLevel('L3');
    this.alert('AI L3 비용 월 예산 90% 초과 — L3 호출 중단');
  }
  if (thisMonthCost > budget) {
    await this.disableLevel('L2');
    this.alert('AI 월 예산 초과 — L2 이상 호출 중단. L1만 허용.');
    return { allowed: false, currentRatio: ratio, reason: 'MONTHLY_BUDGET_EXCEEDED' };
  }

  // 비용/수익 비율 초과 (Phase 13+ 이후 유효)
  if (ratio > warnLimit) {
    this.alert(`AI 비용/순수익 ${(ratio * 100).toFixed(1)}% — 경고 임계 초과`);
  }
  if (ratio > hardLimit * 1.5) {
    // hardLimit의 1.5배 초과 시 L3 중단
    await this.disableLevel('L3');
    return { allowed: true, currentRatio: ratio, reason: 'RATIO_L3_DISABLED' };
  }

  return { allowed: true, currentRatio: ratio };
}
```

**레벨 비활성화 효과:**
- L3 비활성 → L3 대상 공시는 L2로 강등 처리
- L2 비활성 → L2·L3 대상 공시는 L1 결과만 저장 (매수 후보 생성 중단)
- L1만 허용 → 포지션 보유 종목의 L3 태스크(EXIT_SIGNAL_ASSIST)는 예외 허용 (손실 방어 우선)

> **포지션 보유 종목 EXIT_SIGNAL_ASSIST 예외:**  
> 예산 초과로 L3가 비활성화되어도, **보유 포지션의 악재 공시에 대한 L3 EXIT_SIGNAL_ASSIST 호출은 허용**한다.  
> 매수 기회 손실보다 **보유 손실 방어**가 우선이다 (3대 원칙 ②).

---

### 4-7. 자체 서빙 전환 검토 기준

초기에는 외부 LLM API(OpenAI, Anthropic 등)를 사용한다. 이후 다음 기준이 충족되면 자체 서빙(self-hosted) 전환을 검토한다.

| 검토 항목 | 전환 검토 임계 | 비고 |
|-----------|---------------|------|
| 월 AI 비용 | ≥ ₩500,000/월 지속 3개월 | 서버 임대 비용과 손익 분기점 분석 필요 |
| 월 AI 호출 건수 | ≥ 5,000건/월 | 배치 추론 효율화 가능 시점 |
| L2 태스크 품질 검증 | 오픈소스 모델 F1 ≥ 0.75 달성 | Phase 10 백테스트로 품질 검증 선행 필수 |
| 인프라 운영 역량 | GPU 서버 운영 경험 확보 | 초기에는 외부 API가 TCO 유리 |

**전환 우선 순위:**
1. L1 게이트 태스크 → 경량 모델(Llama 3 8B 급) 자체 서빙 검토
2. L2 태스크 → 검증 후 오픈소스 모델 전환
3. L3 태스크 → 복잡도·품질 요구 높음, 외부 API 유지 권장

---

## 5. 작업 분해

### 5-1. DB & 모델

- [ ] `AIUsageLog` Prisma 모델 추가
- [ ] `Disclosure` ↔ `AIUsageLog` relation 연결 (`rcpNo` FK)
- [ ] `npx prisma migrate dev --name add-ai-usage-log` 실행
- [ ] (Phase 6 완료 후) `AIUsageLog.signalId` FK 마이그레이션
- [ ] (Phase 13 완료 후) `AIUsageLog.tradeId` FK 마이그레이션

### 5-2. 모듈 & 서비스

- [ ] `backend/src/ai-cost/` 디렉터리 생성
- [ ] `AiCostModule` 작성 (`@Global()` 등록)
- [ ] `AiCostService.log()` 구현 — USD→KRW 환율 변환 포함
- [ ] `AiRouterService.routeDisclosure()` 구현 — L0~L3 분기 로직
- [ ] `AiCostService.checkBudgetGate()` 구현
- [ ] `AiCostService.getDailySummary()` / `getMonthlySummary()` 구현
- [ ] `AiCostController` 관리자 API 3종 구현

### 5-3. 환경 변수 & 설정

- [ ] `.env.example` 에 `AI_MONTHLY_BUDGET_KRW`, `AI_COST_REVENUE_RATIO_LIMIT`, `AI_COST_REVENUE_RATIO_WARN`, `AI_BUDGET_CHECK_INTERVAL_MIN` 추가
- [ ] ECS task definition 환경 변수 업데이트

### 5-4. Phase 4 연동 (선행 구현)

- [ ] Phase 4 AI 호출 코드(Disclosure Summary, Event Classification, Persona Interpretation, Position Thesis) 각 지점에 `AiCostService.log()` 호출 의무화
- [ ] Phase 4 AI 호출 전 `AiRouterService.routeDisclosure()` 게이트 통과 확인 로직 추가

### 5-5. 모니터링 & 알림

- [ ] 월 예산 90% 도달 시 슬랙/이메일 알림
- [ ] 비용/수익 비율 경고 임계 초과 시 알림
- [ ] `GET /admin/ai-cost/summary` 관리자 대시보드 응답 확인

### 5-6. 문서

- [ ] `docs/api-specification.md` 에 `/admin/ai-cost/*` 엔드포인트 추가
- [ ] `docs/database-schema.md` 에 `AIUsageLog` 모델 추가
- [ ] `PROJECT_STRUCTURE.md` 에 `backend/src/ai-cost/` 디렉터리 추가

---

## 6. AI 사용 정책

Phase 11 자체는 **비용 통제 인프라**이므로 AI를 직접 사용하지 않는다.  
단, 다음 두 가지 예외가 있다:

| 상황 | AI 허용 여부 | 비고 |
|------|-------------|------|
| 비용 집계 쿼리·리포트 생성 | 금지 | Rule 기반 SQL 집계 |
| 자체 서빙 모델 품질 평가 | 허용 (오프라인) | 외부 LLM으로 정답 레이블 생성 후 비교 |

**이 Phase가 정의하는 전체 AI 금지 영역 (모든 하위 Phase 적용):**

> 1. 최종 주문 승인 — Risk Engine + 사용자 승인 필수
> 2. 손절·익절 하드 룰 수치 결정 — Rule Engine 고정값
> 3. 포트폴리오 종목 한도·섹터 한도 — Risk Engine 고정값
> 4. 주문 수량·금액 결정 — Trading & Risk Engine
> 5. 리스크 룰 우회 — 절대 불가. AI 출력으로 Risk Engine 재정의 금지

---

## 7. 비용·성능 고려사항

| 항목 | 수치 | 비고 |
|------|------|------|
| L1 예상 비용/건 | ~$0.001 (₩1.3) | 500토큰 입출력, GPT-4o-mini 기준 |
| L2 예상 비용/건 | ~$0.008 (₩10) | 2,000토큰 입출력, GPT-4o 기준 |
| L3 예상 비용/건 | ~$0.05 (₩65) | 6,000토큰 입출력, GPT-4o/Opus 기준 |
| 일 공시 수집량 | ~300~500건 (관심 50종목 기준) | 대부분 L0 처리 예상 |
| L1 처리 예상 비중 | ~30% (90~150건/일) | 매매 관련 공시 비율 |
| L2 처리 예상 비중 | ~5% (15~25건/일) | 이벤트 5종 필터 |
| L3 처리 예상 비중 | ~0.5% (1~3건/일) | 실제 주문 후보·보유 종목 악재 |
| 예상 일 비용 | ~₩300~600 | L1×150×₩1.3 + L2×20×₩10 + L3×2×₩65 |
| 예상 월 비용 | ~₩7,000~15,000 | 초기 검증 단계 기준 |

**성능 SLA:**
- L1 응답: 3초 이내 (비동기 처리, 수집 후 큐 적재)
- L2 응답: 10초 이내 (백그라운드 워커)
- L3 응답: 30초 이내 (비동기, 완료 후 알림)
- `AIUsageLog.log()` 저장 실패 시 재시도 3회 → 실패 알림 (AI 분석 결과는 보존)

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| **외부 LLM API 장애** | 재시도 3회(exponential backoff) → 실패 시 `isSuccess=false` 기록, 하위 레벨 결과로 대체. L3 실패 시 L2 결과 사용. |
| **토큰 계산 오류** | 외부 API 응답의 `usage` 필드 우선 사용, 없으면 tiktoken 추정값으로 fallback. 오차 허용 ±5%. |
| **환율 변동** | 호출 시점 환율을 `exchangeRate` 에 저장. 집계 시 당일 평균 환율 사용 옵션 제공. |
| **동일 공시 중복 호출** | `AIUsageLog` 에 `(rcpNo, taskType, level)` 복합 유니크 제약 추가 고려. 중복 시 기존 결과 재사용. |
| **비용/수익 비율 — 초기 수익 0** | Phase 13 이전에는 순수익이 0이므로 비율 계산 무의미. 초기에는 절대 비용(월 예산)만 기준으로 가드레일 적용. |
| **L3 응답 지연 중 공시 오래됨** | L3 큐 처리 시 공시 시각 기준으로 TTL 설정(장 시작 후 2시간 초과 시 L3 스킵, L2 결과 사용). |
| **포지션 없는 초기 단계** | Avoided Loss, Cost Per Trade 등 Phase 13 이전에는 null/0 처리. 지표 계산 시 분모 0 방어 로직 필수. |
| **모델 명칭·가격 변경** | `model` 컬럼에 실제 모델 ID 저장. 비용 단가 테이블을 DB 또는 환경 변수로 분리하여 재계산 가능하도록 설계. |

---

## 9. 완료 기준 (DoD)

다음 항목이 모두 충족되어야 Phase 11 완료로 간주한다.

### 필수 (Must)

- [ ] `AIUsageLog` 테이블이 DB에 생성되고 마이그레이션이 git에 커밋됨
- [ ] `AiCostModule`이 전역 등록되어 모든 AI 호출 모듈에서 `AiCostService` 주입 가능
- [ ] `AiCostService.log()` 호출 시 `AIUsageLog` 레코드가 정확히 1건 저장됨 (단위 테스트 포함)
- [ ] `AiRouterService.routeDisclosure()` 가 L0 조건 5종, L1→L3 직접 상향 조건 2종을 올바르게 분기함 (단위 테스트 포함)
- [ ] `checkBudgetGate()` 가 월 예산 100% 초과 시 `allowed: false` 반환, L3 90% 초과 시 L3 비활성화 동작 확인
- [ ] Phase 4 구현 코드의 모든 AI 호출 지점에서 `AiCostService.log()` 가 호출됨
- [ ] `GET /admin/ai-cost/summary` API 응답이 레벨별 비용 집계를 정확히 반환
- [ ] 포지션 보유 종목의 EXIT_SIGNAL_ASSIST 는 L3 비활성화 상태에서도 호출 허용됨 (예외 로직 테스트 포함)

### 권장 (Should)

- [ ] 월 예산 90% 도달 시 관리자 알림(슬랙 또는 이메일) 발송 확인
- [ ] `AIUsageLog` 집계 쿼리(일간·월간 Cost Per Disclosure) 실행 계획이 인덱스 스캔으로 처리됨 (`EXPLAIN ANALYZE` 확인)
- [ ] `.env.example` 에 AI 비용 관련 환경 변수 4종 문서화
- [ ] `docs/database-schema.md`, `docs/api-specification.md` 업데이트

### 선택 (Could)

- [ ] 자체 서빙 전환 ROI 계산 스프레드시트 또는 스크립트 작성
- [ ] False Positive/Negative 수동 레이블링 관리자 UI (Phase 12 이후)
