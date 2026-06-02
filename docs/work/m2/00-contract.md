# M2 기술 계약서 — 이벤트 타입·핵심 수치 추출

> 작성: BE 리드 · 작성일: 2026-06-03  
> 이 문서는 M2 구현 에이전트(BE·DQ)가 그대로 따를 수 있는 구현 계약이다.  
> 상위 문서: [실행 로드맵](../../roadmap/01-execution-roadmap.md) · [BE 역할](../../roadmap/roles/be.md) · [Phase 03 상세 설계](../../roadmap/phase-03-event-extraction.md)

---

## 0. 불변 원칙 (위반 시 즉시 중단 후 계약 검토 요청)

1. **Rule/Parser 전용**: 숫자·이벤트 분류는 정규식·표 파싱으로만 추출. LLM/AI 호출 금지 (confidence < 0.85 시 AI L1 보조는 허용하되 수치 계산에는 절대 미사용).
2. **AI 금지 영역**: `salesRatio`, `dilutionRate`, `discountRate` 등 파생값 계산은 Rule 함수만. AI가 이 값을 생성하는 코드 경로 금지.
3. **parsedJson 입력 전제**: M1 `DisclosureDocument.parsedJson` (`ParsedJson` 타입, `backend/src/disclosure-documents/types/parsed-json.type.ts`)이 존재하는 공시만 추출 처리. `parsedJson`이 null이면 즉시 FAILED 처리.
4. **npm·prisma migrate·nest build·docker·git 실행 금지**: 오케스트레이터가 수행.
5. **한국어 주석**: 기존 코드 스타일 유지.

---

## 1. Prisma 스키마 계약

### 1-1. 추가 위치

`backend/prisma/schema.prisma`의 `DisclosureDocument` 모델 블록 이후, `DisclosureCollectionLog` 블록 이전에 추가한다.

### 1-2. EventType Prisma enum

```prisma
// ====================================
// 이벤트 타입 enum (M2 신규)
// ====================================

enum EventType {
  // ── 우선 추출 5종 ──────────────────────────────
  SUPPLY_CONTRACT           // 단일판매·공급계약 체결
  SHARE_BUYBACK             // 자기주식 취득
  SHARE_CANCELLATION        // 자기주식 소각
  DIVIDEND_INCREASE         // 배당 확대 (현금·현물)
  PAID_IN_CAPITAL_INCREASE  // 유상증자 (주주배정·일반공모)
  CB_ISSUANCE               // 전환사채 발행
  BW_ISSUANCE               // 신주인수권부사채 발행

  // ── enum 포함 (추출 구현은 후속 이터레이션) ──────
  CONTRACT_CANCELLATION     // 단일판매·공급계약 해제·취소
  DIVIDEND_CUT              // 배당 축소·중단
  THIRD_PARTY_ALLOTMENT     // 제3자배정 유상증자
  EARNINGS_SURPRISE         // 실적 서프라이즈
  EARNINGS_SHOCK            // 실적 쇼크
  MAJOR_SHAREHOLDER_CHANGE  // 최대주주 변경
  LAWSUIT                   // 소송·횡령·배임
  AUDIT_OPINION_RISK        // 감사의견 거절·한정
  TRADING_SUSPENSION        // 거래정지
  DELISTING_RISK            // 상장폐지 위험·관리종목

  OTHER                     // 분류 불가 (NEEDS_REVIEW 대상)
}
```

> **구현 범위 명확화**: `EventType` enum에는 17종 + OTHER 전부 선언. 추출 파서(`extractors/`)는 우선 5종(SUPPLY_CONTRACT, SHARE_BUYBACK, SHARE_CANCELLATION, DIVIDEND_INCREASE, PAID_IN_CAPITAL_INCREASE) + CB_ISSUANCE + BW_ISSUANCE 7종만 구현. 나머지 eventType은 `extractedData = {}`, `extractionStatus = NEEDS_REVIEW`로 저장.

### 1-3. ExtractionStatus Prisma enum

```prisma
// ====================================
// 추출 상태 enum (M2 신규)
// ====================================

enum ExtractionStatus {
  PENDING       // 추출 미처리
  SUCCESS       // 추출 완료
  FAILED        // 추출 실패 (parsedJson 없음 또는 파서 오류)
  NEEDS_REVIEW  // confidence 낮거나 필수 필드 누락 — 관리자 검토 대기
}
```

### 1-4. DisclosureEvent 모델

```prisma
// ====================================
// 공시 이벤트 추출 결과 (M2 신규)
// ====================================

model DisclosureEvent {
  id String @id @default(cuid())

  // ── FK: Disclosure (rcpNo 자연키, 1:1) ──────────────────────
  // 공시 1건 = 이벤트 1건 원칙.
  // 복수 이벤트 공시(CB + 유상증자 동시)는 extractedData.events[] 배열로 처리하고
  // eventType은 우선순위 높은 것으로 단일 지정한다.
  rcpNo    String @unique
  corpCode String // 역정규화 — 조회 성능용. Disclosure.corpCode와 항상 동일

  // ── 이벤트 분류 ──────────────────────────────────────────────
  eventType EventType

  // ── 이벤트별 핵심 수치 JSON ────────────────────────────────────
  // 이벤트 타입별 스키마는 §2 참고. 추출 실패 시 빈 JSON `{}` 저장.
  extractedData Json @default("{}")

  // ── 극성 ──────────────────────────────────────────────────────
  // Rule 매핑 테이블의 polarity 값으로 초기 설정. AI 보정은 M3.
  polarity String @default("UNKNOWN") // "POSITIVE" | "NEGATIVE" | "MIXED" | "UNKNOWN"

  // ── 신뢰도 및 검증 ────────────────────────────────────────────
  confidence       Float           @default(0.0)   // 0.0~1.0. Rule ≥ 0.85, AI보조 0.6~0.85
  isAiAssisted     Boolean         @default(false) // confidence < 0.85 시 AI L1 개입 여부
  extractionStatus ExtractionStatus @default(PENDING)
  failReason       String?                         // 실패 사유 (500자 상한)

  // ── 정정공시 연결 ────────────────────────────────────────────
  isAmendment    Boolean @default(false)
  originalRcpNo  String? // 정정 대상 원공시 rcpNo

  extractedAt DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // Relations
  disclosure Disclosure @relation(fields: [rcpNo],      references: [rcpNo])
  company    Company    @relation(fields: [corpCode],   references: [corpCode])

  @@index([corpCode])
  @@index([eventType])
  @@index([polarity])
  @@index([extractionStatus])
  @@index([extractedAt])
  @@index([isAmendment])
  @@map("disclosure_events")
}
```

> **1:1 vs 1:N 결정**: `rcpNo @unique`로 1:1 강제. 향후 복수 이벤트 분리 필요 시 `DisclosureEventItem` 1:N 모델로 분리 예정 (현재 계약 범위 외).

### 1-5. Disclosure·Company 모델 역참조 추가

```prisma
// Disclosure 모델에 추가
disclosureEvent DisclosureEvent?

// Company 모델에 추가
disclosureEvents DisclosureEvent[]
```

---

## 2. extractedData JSON 스키마 (이벤트별)

### 2-1. SUPPLY_CONTRACT

```typescript
interface SupplyContractData {
  contractAmount: number | null;       // 계약금액 (원 단위 정규화)
  recentSales: number | null;          // 최근 매출액 (원, parsedJson.recentSales)
  salesRatio: number | null;           // 파생값: contractAmount / recentSales * 100
  counterparty: string | null;         // 거래상대방 (parsedJson.counterparty)
  counterpartyType: 'DOMESTIC_LARGE' | 'DOMESTIC_SME' | 'FOREIGN' | 'UNKNOWN';
  contractStartDate: string | null;    // YYYY-MM-DD
  contractEndDate: string | null;      // YYYY-MM-DD
  contractDurationMonths: number | null; // 파생값: 날짜 차이 (월)
  productOrService: string | null;     // 공시 본문 rawText에서 추출 (없으면 null)
  isAmendment: boolean;                // parsedJson.isAmendment 또는 Disclosure.rmk
  derivedDataMissing: boolean;         // recentSales null 시 true
}
```

**파생값 계산식:**
```
salesRatio = contractAmount / recentSales * 100   (recentSales null → salesRatio = null)
contractDurationMonths = (Date(contractEndDate) - Date(contractStartDate))를 월로 환산 (소수점 반올림)
```

### 2-2. SHARE_BUYBACK

```typescript
interface ShareBuybackData {
  buybackAmount: number | null;        // 취득 금액 (원, parsedJson.acquisitionAmount)
  buybackShares: number | null;        // 취득 주식 수 (parsedJson.acquisitionShares)
  buybackRatioToTotal: number | null;  // 파생값: buybackShares / totalIssuedShares * 100
  buybackPriceMax: number | null;      // 취득 단가 상한 (표에서 추출)
  buybackPriceMin: number | null;      // 취득 단가 하한 (표에서 추출)
  buybackPeriodStart: string | null;   // YYYY-MM-DD (parsedJson.acquisitionStartDate)
  buybackPeriodEnd: string | null;     // YYYY-MM-DD (parsedJson.acquisitionEndDate)
  acquisitionMethod: string | null;    // 취득 방법 (parsedJson.acquisitionMethod)
  purpose: string | null;             // 목적 (표에서 추출: "주가 안정" | "소각" | "스톡옵션" | 기타)
  derivedDataMissing: boolean;         // totalIssuedShares 미확보 시 true
}
```

**파생값 계산식:**
```
buybackRatioToTotal = buybackShares / totalIssuedShares * 100
  (totalIssuedShares: Company 또는 parsedJson에서 조회. 없으면 null)
```

### 2-3. SHARE_CANCELLATION

```typescript
interface ShareCancellationData {
  cancellationShares: number | null;   // 소각 주식 수 (parsedJson.cancellationShares)
  cancellationAmount: number | null;   // 소각 금액 (원, parsedJson.cancellationAmount)
  cancellationRatioToTotal: number | null; // 파생값: cancellationShares / totalIssuedShares * 100
  purpose: string | null;             // 소각 목적
  derivedDataMissing: boolean;
}
```

**파생값 계산식:**
```
cancellationRatioToTotal = cancellationShares / totalIssuedShares * 100
```

### 2-4. DIVIDEND_INCREASE

```typescript
interface DividendData {
  dividendPerShare: number | null;         // 주당 배당금 (원, parsedJson.dividendPerShare)
  previousDividendPerShare: number | null; // 전년 주당 배당금 (표에서 추출, 없으면 null)
  changeRate: number | null;               // 파생값: YoY 성장률
  dividendYield: number | null;            // 배당수익률 (parsedJson.dividendYield * 100)
  dividendTotal: number | null;            // 배당금 총액 (원, parsedJson.dividendTotal)
  recordDate: string | null;               // 배당기준일 YYYY-MM-DD (parsedJson.dividendRecordDate)
  paymentDate: string | null;              // 배당지급일 YYYY-MM-DD (표에서 추출)
  dividendType: 'CASH' | 'STOCK' | 'HYBRID'; // parsedJson.docType 기반 판별
  derivedDataMissing: boolean;
}
```

**파생값 계산식:**
```
changeRate = (dividendPerShare - previousDividendPerShare) / previousDividendPerShare * 100
  (previousDividendPerShare null → changeRate = null)
dividendYield 표시: parsedJson.dividendYield는 소수점 4자리(예: 0.025) → * 100 → 2.5%
```

### 2-5. PAID_IN_CAPITAL_INCREASE

```typescript
interface CapitalIncreaseData {
  issueType: 'RIGHTS_OFFERING' | 'PUBLIC_OFFERING' | 'THIRD_PARTY' | 'UNKNOWN';
  fundingAmount: number | null;        // 조달 금액 (원, parsedJson.fundingAmount)
  purpose: string[];                   // 자금 사용 목적 (표에서 배열 추출, 없으면 [])
  newShares: number | null;            // 신주 수 (parsedJson.newShares)
  existingShares: number | null;       // 기존 발행 주식 수 (parsedJson.existingShares)
  dilutionRate: number | null;         // 파생값: newShares / existingShares * 100
  issuePrice: number | null;           // 발행가액 (표에서 추출)
  referencePrice: number | null;       // 기준주가 (표에서 추출)
  discountRate: number | null;         // 파생값: (referencePrice - issuePrice) / referencePrice * 100
  thirdPartyName: string | null;       // 제3자배정 대상자 (해당 시)
  subscriptionDate: string | null;     // 청약일 YYYY-MM-DD
  listingDate: string | null;          // 상장 예정일 YYYY-MM-DD
  derivedDataMissing: boolean;
}
```

**파생값 계산식:**
```
dilutionRate = newShares / existingShares * 100
discountRate = (referencePrice - issuePrice) / referencePrice * 100
  (분모 0 또는 null → 해당 파생값 null)
```

### 2-6. CB_ISSUANCE / BW_ISSUANCE

```typescript
interface CbBwData {
  bondType: 'CB' | 'BW';              // parsedJson.bondType
  totalAmount: number | null;         // 발행 금액 (원, parsedJson.issuanceAmount)
  interestRate: number | null;        // 이자율 (parsedJson.interestRate — 소수점 4자리)
  maturityDate: string | null;        // 만기일 YYYY-MM-DD (parsedJson.maturityDate)
  conversionPrice: number | null;     // 전환가액 (원/주, parsedJson.conversionPrice)
  conversionPremiumRate: number | null; // 파생값: (conversionPrice - referencePrice) / referencePrice * 100
  refixClause: boolean | null;        // 리픽싱 조항 여부 (표 키워드 "리픽스" | "조정" 탐지)
  earlyRedemptionDate: string | null; // 조기상환 청구 가능일 (표에서 추출)
  allottee: string | null;            // 발행 대상자
  allotteeType: 'INSTITUTIONAL' | 'INDIVIDUAL' | 'RELATED_PARTY' | 'UNKNOWN';
  maxDilutionShares: number | null;   // 파생값: totalAmount / conversionPrice
  maxDilutionRate: number | null;     // 파생값: maxDilutionShares / existingShares * 100
  derivedDataMissing: boolean;
}
```

**파생값 계산식:**
```
conversionPremiumRate = (conversionPrice - referencePrice) / referencePrice * 100
maxDilutionShares     = floor(totalAmount / conversionPrice)
maxDilutionRate       = maxDilutionShares / existingShares * 100
  (분모 0 또는 null → 해당 파생값 null)
```

---

## 3. 추출기 인터페이스 — DQ 구현, BE import (공유 계약)

> DQ가 아래 시그니처로 구현하고, BE `DisclosureEventsService`가 그대로 import한다.  
> **파일 경로·함수명·파라미터 타입을 변경하지 않는다.**

### 3-1. 이벤트 분류기

**파일**: `backend/src/disclosure-events/extractors/event-classifier.ts`

```typescript
import { EventType } from '@prisma/client';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

/**
 * 보고서명 + parsedJson 기반 1차 이벤트 타입 분류
 *
 * 1. reportName 정규식 룰 테이블 순차 적용 (첫 매칭 채택)
 * 2. 매칭 실패 시 parsedJson.docType 활용 2차 보완
 * 3. 여전히 null → EventType.OTHER, confidence 낮음
 *
 * @returns { eventType, polarity, confidence }
 *   confidence: Rule 직접 매칭 ≥ 0.85, docType 보완 0.70, 미매칭 0.40
 */
export function classifyEventType(
  reportName: string,
  parsedJson: ParsedJson,
): {
  eventType: EventType;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
}
```

> `REPORT_NAME_RULES` 배열은 동일 파일에 위치. 기존 `classifyInvestmentEventType` (`disclosure-types.constant.ts`)와의 차이: M0 함수는 5종만 구분하고 polarity/confidence 없음. M2는 17종 + OTHER + polarity + confidence 반환.

### 3-2. 통합 추출기 진입점

**파일**: `backend/src/disclosure-events/extractors/index.ts`

```typescript
import { EventType } from '@prisma/client';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

/**
 * eventType에 맞는 파서를 선택해 수치를 추출한다.
 *
 * - 우선 7종(SUPPLY_CONTRACT, SHARE_BUYBACK, SHARE_CANCELLATION,
 *   DIVIDEND_INCREASE, PAID_IN_CAPITAL_INCREASE, CB_ISSUANCE, BW_ISSUANCE)만 파서 보유
 * - 나머지 EventType: data = {}, confidence = 0.0
 *
 * @returns { data: Record<string, unknown>; confidence: number }
 *   confidence: 필수 필드 모두 추출 시 0.90, 일부 누락 시 0.60~0.89, 전체 누락 시 0.0
 */
export function extractEventData(
  eventType: EventType,
  parsedJson: ParsedJson,
  reportName: string,
): {
  data: Record<string, unknown>;
  confidence: number;
}
```

### 3-3. 이벤트별 파서 파일 (DQ 구현)

각 파일은 `extract` 함수 하나만 export한다.

**`backend/src/disclosure-events/extractors/supply-contract.ts`**
```typescript
export function extract(parsedJson: ParsedJson, reportName: string): SupplyContractData
```

**`backend/src/disclosure-events/extractors/share-buyback.ts`**
```typescript
export function extract(parsedJson: ParsedJson, reportName: string): ShareBuybackData
```

**`backend/src/disclosure-events/extractors/dividend.ts`**
```typescript
export function extract(parsedJson: ParsedJson, reportName: string): DividendData
```

**`backend/src/disclosure-events/extractors/capital-increase.ts`**
```typescript
export function extract(parsedJson: ParsedJson, reportName: string): CapitalIncreaseData
```

**`backend/src/disclosure-events/extractors/cb-bw.ts`**
```typescript
export function extract(parsedJson: ParsedJson, reportName: string): CbBwData
```

> **각 파서 공통 규칙:**
> 1. `parsedJson` 필드 직접 매핑 우선 → 값 없으면 `parsedJson` 내 표 키워드 탐색 → 없으면 null
> 2. 금액 단위 정규화: `억원 × 1_0000_0000`, `백만원 × 1_000_000`, `천원 × 1_000`, `원` 그대로
> 3. 날짜 정규화: `YYYY.MM.DD`, `YYYY/MM/DD`, `YYYYMMDD` → `YYYY-MM-DD`
> 4. 분모 0 또는 null → 파생값 null (나누기 전 방어 체크 필수)
> 5. 예외 throw 금지 — try/catch로 감싸고 오류 시 해당 필드 null 반환

---

## 4. BE 영속 모듈

### 4-1. 디렉터리 구조

```
backend/src/disclosure-events/
├── disclosure-events.module.ts
├── disclosure-events.service.ts      // 진입점: 분류 + 추출 + upsert
├── disclosure-events.controller.ts   // HTTP 엔드포인트
├── dto/
│   ├── disclosure-event-response.dto.ts
│   └── batch-extract.dto.ts
└── extractors/                       // DQ 구현, BE import
    ├── event-classifier.ts
    ├── index.ts
    ├── supply-contract.ts
    ├── share-buyback.ts
    ├── dividend.ts
    ├── capital-increase.ts
    └── cb-bw.ts
```

### 4-2. DisclosureEventsService 시그니처

**파일**: `backend/src/disclosure-events/disclosure-events.service.ts`

```typescript
@Injectable()
export class DisclosureEventsService {

  /**
   * 공시 1건 처리 파이프라인
   * 1. DisclosureDocument 조회 (parsedJson 필수)
   * 2. classifyEventType(reportName, parsedJson)
   * 3. extractEventData(eventType, parsedJson, reportName)
   * 4. computeDerivedValues(eventType, raw)
   * 5. validateExtractedData(eventType, data)
   * 6. upsert DisclosureEvent
   *
   * 절대 throw하지 않음 — 오류는 extractionStatus 전이로 기록
   */
  async processDisclosure(rcpNo: string): Promise<DisclosureEvent>

  /**
   * 미처리(PENDING) 공시 일괄 처리
   * extractionStatus = PENDING인 건 최대 limit건 처리
   */
  async processPendingDisclosures(
    limit?: number,
  ): Promise<{ success: number; failed: number; needsReview: number }>

  /**
   * M1 DisclosureDocument 파싱 완료 후 자동 체이닝 진입점
   * disclosure-documents.service.ts에서 @Optional() 주입 후 호출
   * (M1 서비스가 M2 서비스를 선택적으로 호출하는 구조 — 순환 의존 방지)
   */
  async onDocumentParsed(rcpNo: string): Promise<void>

  /** 파생값 계산 (유닛 테스트 대상) */
  computeDerivedValues(
    eventType: EventType,
    raw: Record<string, unknown>,
  ): Record<string, unknown>

  /** 추출 결과 confidence 검증 (필수 필드 누락 시 confidence -= 0.2) */
  private validateExtractedData(
    eventType: EventType,
    data: Record<string, unknown>,
  ): { data: Record<string, unknown>; confidenceAdjustment: number; needsReview: boolean }
}
```

**M1 체이닝 방법:**

`backend/src/disclosure-documents/disclosure-documents.service.ts`에 아래 추가:

```typescript
// 생성자에 추가 (순환 참조 방지를 위해 @Optional() 사용)
constructor(
  ...,
  @Optional() private readonly disclosureEventsService: DisclosureEventsService | undefined,
) {}

// parseDisclosure 완료 직후 (parseStatus = DONE 저장 후) 비동기 호출
if (this.disclosureEventsService) {
  // await 없음 — M2 실패가 M1 결과에 영향을 주지 않도록
  this.disclosureEventsService.onDocumentParsed(rcpNo).catch((err) =>
    this.logger.warn(`M2 체이닝 실패 rcpNo=${rcpNo}: ${err.message}`),
  );
}
```

### 4-3. DisclosureEventsController 엔드포인트

```
GET    /disclosure-events                   // 목록 조회 (corpCode·eventType·status 필터, 페이지네이션)
GET    /disclosure-events/:rcpNo            // 단건 조회
POST   /disclosure-events/extract/:rcpNo    // 단건 수동 추출 트리거 (JwtAuthGuard)
POST   /disclosure-events/batch             // 미처리 일괄 추출 트리거 (JwtAuthGuard)
```

> `GET /disclosures/:rcpNo` 기존 응답에 `event` 필드 포함은 `disclosures.service.ts` 수정으로 처리 (`DisclosureEventsService` 주입).

**Swagger 데코레이터**: 모든 엔드포인트에 `@ApiTags('disclosure-events')`, `@ApiOperation`, `@ApiResponse` 필수.

**JwtAuthGuard**: POST 엔드포인트에 `@UseGuards(JwtAuthGuard)` 적용. GET은 공개.

---

## 5. 파생값 계산식 명세

| 파생값 | 공식 | 분모 null/0 처리 |
|--------|------|-----------------|
| `salesRatio` | `contractAmount / recentSales * 100` | → `null`, `derivedDataMissing = true` |
| `contractDurationMonths` | `(Date(end) - Date(start))` 월 환산, `Math.round` | 날짜 파싱 실패 → `null` |
| `buybackRatioToTotal` | `buybackShares / totalIssuedShares * 100` | → `null`, `derivedDataMissing = true` |
| `cancellationRatioToTotal` | `cancellationShares / totalIssuedShares * 100` | → `null`, `derivedDataMissing = true` |
| `changeRate` (배당) | `(current - previous) / previous * 100` | `previous = 0 or null` → `null` |
| `dilutionRate` | `newShares / existingShares * 100` | → `null`, `derivedDataMissing = true` |
| `discountRate` | `(referencePrice - issuePrice) / referencePrice * 100` | → `null` |
| `conversionPremiumRate` | `(conversionPrice - referencePrice) / referencePrice * 100` | → `null` |
| `maxDilutionShares` | `Math.floor(totalAmount / conversionPrice)` | → `null` |
| `maxDilutionRate` | `maxDilutionShares / existingShares * 100` | → `null`, `derivedDataMissing = true` |

> **단위 정규화는 파서 내에서 선수 처리**: 파생값 계산 함수에 들어오는 값은 반드시 원(원화) 단위.

---

## 6. 픽스처 및 테스트 대상

### 6-1. 픽스처 위치

```
backend/src/disclosure-events/__fixtures__/
├── supply-contract-sample.json       // parsedJson 합성 (contractAmount, recentSales 포함)
├── supply-contract-missing-sales.json // recentSales null → salesRatio = null 케이스
├── capital-increase-rights.json      // 주주배정 유상증자
├── capital-increase-third-party.json // 제3자배정
├── share-buyback-sample.json
├── dividend-increase-sample.json
├── cb-issuance-sample.json
└── bw-issuance-sample.json
```

픽스처 형식은 `ParsedJson` 타입과 동일 (실제 DART 공시 샘플 기반 합성).

### 6-2. 필수 단위 테스트 파일

| 파일 | 테스트 대상 |
|------|------------|
| `event-classifier.spec.ts` | reportName 17종 + OTHER 패턴, confidence 반환값 범위 |
| `supply-contract.spec.ts` | salesRatio 계산, recentSales null 경계값, 단위 변환 (억원) |
| `capital-increase.spec.ts` | dilutionRate·discountRate 계산, issueType 분류 |
| `cb-bw.spec.ts` | maxDilutionRate 계산, refixClause 키워드 탐지, bondType 분류 |
| `share-buyback.spec.ts` | buybackRatioToTotal null 처리 |
| `dividend.spec.ts` | changeRate 계산, dividendType 분류 |
| `disclosure-events.service.spec.ts` | processDisclosure 파이프라인 (픽스처 기반, DB mock) |

### 6-3. M2 회귀 측정 포인트 (↩︎M1 체크)

**parsedJson 표 누락이 추출 실패로 전파되는 비율** 측정 방법:

```typescript
// DisclosureEventsService 내 측정 로직
// processDisclosure 실행 후 다음 조건으로 카운트:
//   - parsedJson이 DONE 상태임에도 extractionStatus = FAILED → "M1→M2 전파 실패"

// 측정 쿼리 (로그·관리 API에서 노출)
const propagationFailureRate = await prisma.$queryRaw`
  SELECT
    COUNT(*) FILTER (WHERE de.extraction_status = 'FAILED') AS failed_count,
    COUNT(*) AS total_count,
    ROUND(
      COUNT(*) FILTER (WHERE de.extraction_status = 'FAILED')::NUMERIC
      / NULLIF(COUNT(*), 0) * 100, 2
    ) AS failure_rate_pct
  FROM disclosure_events de
  JOIN disclosure_documents dd ON de.rcp_no = dd.rcp_no
  WHERE dd.parse_status = 'DONE'
    AND de.fail_reason = 'NO_PARSED_FIELD'  -- 파서 미지원 필드 누락 케이스만 집계
`;
```

> **임계치**: `failure_rate_pct > 10%`이면 M1 파서 보강 요청. `DisclosureEventsService.processPendingDisclosures` 반환값에 `failureRate` 포함.

---

## 7. 상태 전이 다이어그램

```
PENDING
  │
  ▼ processDisclosure 호출
  ├─ DisclosureDocument 없음 또는 parsedJson null
  │    → FAILED (failReason = "NO_PARSED_DOC")
  │
  ├─ classifyEventType → OTHER 또는 confidence < 0.60
  │    → NEEDS_REVIEW
  │
  ├─ extractEventData → 필수 필드 전부 누락 (confidence = 0.0)
  │    → FAILED (failReason = "NO_PARSED_FIELD")
  │
  ├─ extractEventData → 일부 누락 (0.0 < confidence < 0.85)
  │    → NEEDS_REVIEW (isAiAssisted = true)
  │
  └─ extractEventData → confidence ≥ 0.85
       → SUCCESS
```

---

## 8. 구현 에이전트 체크리스트

구현 시작 전 반드시 확인:

- [ ] `backend/prisma/schema.prisma`에 `EventType`, `ExtractionStatus` enum 추가
- [ ] `DisclosureEvent` 모델 추가 (`Disclosure`, `Company` 역참조 포함)
- [ ] `backend/src/disclosure-events/` 디렉터리 생성
- [ ] `DisclosureEventsModule` 생성 및 `app.module.ts` 등록
- [ ] `extractors/` 인터페이스 파일 3-1~3-3 시그니처대로 생성 (구현은 DQ 담당, BE는 타입·인터페이스 파일 생성 후 대기)
- [ ] `DisclosureEventsService.processDisclosure` 파이프라인 구현
- [ ] `DisclosureEventsService.computeDerivedValues` 구현 (§5 계산식)
- [ ] `DisclosureEventsController` 4엔드포인트 구현 (Swagger 포함)
- [ ] `disclosure-documents.service.ts`에 `@Optional()` 체이닝 추가
- [ ] `disclosures.service.ts` GET /:rcpNo 응답에 `event` 필드 포함
- [ ] `__fixtures__/` 픽스처 파일 8종 생성 (§6-1)
- [ ] 단위 테스트 7종 생성 (§6-2)
- [ ] M2 회귀 측정 쿼리 및 로그 추가 (§6-3)

---

## 9. 핵심 결정 사항

1. **1:1 rcpNo @unique 강제**: 공시 1건 = 이벤트 레코드 1건. 복수 이벤트는 `extractedData.events[]` 배열로 내부 처리. 향후 1:N 분리 시 마이그레이션 가능하도록 `id` cuid PK 유지.
2. **@Optional() 체이닝**: M2 서비스가 M1 서비스에 의존하지 않고, M1 서비스가 M2 서비스를 `@Optional()`로 선택적 호출. M2 미배포 상태에서도 M1 파이프라인 무중단 동작 보장.
3. **parsedJson 직접 매핑 우선**: DQ 파서는 `ParsedJson` 필드 직접 참조를 최우선으로 하고, 해당 필드가 null일 때만 `parsedJson` 내 표/rawText 키워드 탐색으로 fallback. AI 사용 없음.
