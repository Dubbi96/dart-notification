> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 3 — 이벤트 타입 및 핵심 수치 추출

> 최종 수정일: 2026-06-02  
> 상태: 설계 완료 (구현 전)  
> 선행 Phase: Phase 2 (공시 원문 파싱 · `DisclosureDocument`)

---

## 1. 목적 & 범위

### 목적

`Disclosure.reportName`(보고서명) 수준의 분류(7종)로는 투자 판단이 불가능하다.  
"단일판매·공급계약체결"과 "단일판매·공급계약해제"는 같은 분류지만 주가 방향이 정반대다.  
이 Phase는 공시 하나를 **단일 이벤트 단위**로 분해하고, 이벤트별 핵심 수치를 구조화된 JSON으로 저장한다.

- 숫자와 날짜 등 정형 데이터 → **Rule / Parser(정규식·표 파싱)**
- "계약 목적이 신규 사업인가, 기존 유지인가" 같은 의미 해석 → **AI 보조 (Phase 4에서 심화)**
- 이 단계에서 AI는 `eventType` 결정이 불분명할 때 보조 확인에만 사용 (L1 수준)

### 포함 범위

- `DisclosureEvent` 모델 설계 및 마이그레이션
- `EventType` enum 15종 정의
- `reportName` → `eventType` 1차 매핑 규칙 (정규식 테이블)
- 이벤트별 `extractedData` JSON 스키마 (공급계약, 유상증자 포함 8종)
- 파생값 계산 함수 (`salesRatio`, `dilutionRate` 등)
- NestJS `EventExtractionModule` 설계
- `confidence` 점수 및 검증 플래그

### 제외 범위

- AI를 이용한 정성 해석 → Phase 4
- 이벤트 기반 Buy Score 산출 → Phase 6
- 과거 유사 이벤트 통계 → Phase 9

---

## 2. 현재 코드베이스 연결점

| 현존 자산 | 활용 방법 |
|-----------|-----------|
| `Disclosure` (rcpNo PK, reportName, corpCode) | DisclosureEvent의 부모. `rcpNo` FK로 연결 |
| `Company` (corpCode PK, stockCode, market) | 시가총액·매출 기준 파생값 계산 시 조인 |
| `DisclosureDocument` (Phase 2 산출) | `parsedJson`의 표·key-value에서 수치 추출 |
| `disclosure.service.ts` + scheduler | 수집 완료 이벤트에 후처리 훅 추가 |
| `disclosures` 모듈 (`GET /disclosures/:rcpNo`) | 이벤트 정보를 상세 응답에 포함 |

---

## 3. 선행 조건 & 의존성

| 조건 | 필수 여부 | 비고 |
|------|-----------|------|
| Phase 2 `DisclosureDocument` 저장 완료 | 필수 | `parsedJson` 없으면 수치 추출 불가 |
| `Disclosure.rcpNo` 자연키 PK 유지 | 필수 | FK 정합 기준 |
| `Company.corpCode` 자연키 PK 유지 | 필수 | 매출액·주식수 조회 시 |
| Phase 4 AI 분석 | 불필요 (선행 불필요) | 이 Phase는 Rule 우선, AI는 보조만 |
| 외부 재무 데이터 (매출액, 발행주식수) | 권장 | 없으면 `salesRatio`/`dilutionRate` null 처리 |

---

## 4. 상세 설계

### 4-1. EventType Enum

```typescript
// backend/src/event-extraction/enums/event-type.enum.ts
export enum EventType {
  // 계약
  SUPPLY_CONTRACT          = 'SUPPLY_CONTRACT',           // 단일판매·공급계약 체결
  CONTRACT_CANCELLATION    = 'CONTRACT_CANCELLATION',     // 단일판매·공급계약 해제·취소
  // 자기주식
  SHARE_BUYBACK            = 'SHARE_BUYBACK',             // 자기주식 취득
  SHARE_CANCELLATION       = 'SHARE_CANCELLATION',        // 자기주식 소각
  // 배당
  DIVIDEND_INCREASE        = 'DIVIDEND_INCREASE',         // 배당 확대
  DIVIDEND_CUT             = 'DIVIDEND_CUT',              // 배당 축소·중단
  // 증자/CB/BW
  PAID_IN_CAPITAL_INCREASE = 'PAID_IN_CAPITAL_INCREASE',  // 유상증자 (주주배정/일반공모)
  THIRD_PARTY_ALLOTMENT    = 'THIRD_PARTY_ALLOTMENT',     // 제3자배정 유상증자
  CB_ISSUANCE              = 'CB_ISSUANCE',               // 전환사채 발행
  BW_ISSUANCE              = 'BW_ISSUANCE',               // 신주인수권부사채 발행
  // 실적
  EARNINGS_SURPRISE        = 'EARNINGS_SURPRISE',         // 실적 서프라이즈 (예상 상회)
  EARNINGS_SHOCK           = 'EARNINGS_SHOCK',            // 실적 쇼크 (예상 하회)
  // 지분·리스크
  MAJOR_SHAREHOLDER_CHANGE = 'MAJOR_SHAREHOLDER_CHANGE',  // 최대주주 변경
  LAWSUIT                  = 'LAWSUIT',                   // 소송·횡령·배임
  AUDIT_OPINION_RISK       = 'AUDIT_OPINION_RISK',        // 감사의견 거절·한정·강조사항
  TRADING_SUSPENSION       = 'TRADING_SUSPENSION',        // 거래정지
  DELISTING_RISK           = 'DELISTING_RISK',            // 상장폐지 위험·관리종목
}
```

### 4-2. Prisma 모델 스케치

```prisma
// DisclosureEvent — Phase 3 신규 모델
model DisclosureEvent {
  id              String    @id @default(cuid())

  // FK: Disclosure (rcpNo 자연키)
  rcpNo           String                          // → Disclosure.rcpNo
  // FK: Company (corpCode 자연키)
  corpCode        String                          // → Company.corpCode

  eventType       String    // EventType enum 값
  polarity        String    // "POSITIVE" | "NEGATIVE" | "MIXED" | "UNKNOWN"

  // 정형 수치 (이벤트별 스키마, 아래 §4-3 참조)
  extractedData   Json                            // 이벤트별 핵심 수치 JSON

  // 신뢰도 및 검증
  confidence      Float     @default(0.0)         // 0.0~1.0 (Rule: 0.9+, AI보조: 0.7~0.9)
  isAiAssisted    Boolean   @default(false)       // AI가 eventType 결정에 개입했는지
  extractionStatus String   @default("PENDING")  // PENDING | SUCCESS | FAILED | NEEDS_REVIEW
  failReason      String?                         // 추출 실패 사유

  // 정정공시 연결
  isAmendment     Boolean   @default(false)
  originalRcpNo   String?                         // 정정 전 원공시 rcpNo

  extractedAt     DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relations
  disclosure      Disclosure @relation(fields: [rcpNo],      references: [rcpNo])
  company         Company    @relation(fields: [corpCode],   references: [corpCode])

  @@unique([rcpNo])  // 공시 1건 = 이벤트 1건 (복수 이벤트 시 배열로 처리)
  @@index([corpCode])
  @@index([eventType])
  @@index([polarity])
  @@index([extractedAt])
  @@index([extractionStatus])
  @@map("disclosure_events")
}
```

> 복수 이벤트 공시(예: 유상증자+CB 동시 발행)는 `extractedData.events[]` 배열로 처리하고 `eventType`은 우선순위 높은 것으로 단일 지정한다. 향후 `DisclosureEventItem` 1:N 분리 검토.

### 4-3. 이벤트별 extractedData JSON 스키마

#### SUPPLY_CONTRACT / CONTRACT_CANCELLATION
```json
{
  "eventType": "SUPPLY_CONTRACT",
  "contractAmount": 120000000000,
  "recentSales": 500000000000,
  "salesRatio": 24.0,
  "counterparty": "거래상대방명",
  "counterpartyType": "DOMESTIC_LARGE" | "DOMESTIC_SME" | "FOREIGN" | "UNKNOWN",
  "contractStartDate": "2026-06-01",
  "contractEndDate": "2027-05-31",
  "contractDurationMonths": 12,
  "productOrService": "제품·서비스 설명",
  "isAmendment": false,
  "amendmentType": null
}
```

**파생값 계산식:**
```
salesRatio = (contractAmount / recentSales) * 100
  - recentSales: DisclosureDocument.parsedJson 내 "최근 매출액" 항목
  - 없으면 null, 이후 외부 재무 API 보완
```

#### PAID_IN_CAPITAL_INCREASE / THIRD_PARTY_ALLOTMENT
```json
{
  "eventType": "PAID_IN_CAPITAL_INCREASE",
  "issueType": "RIGHTS_OFFERING" | "PUBLIC_OFFERING" | "THIRD_PARTY",
  "fundingAmount": 50000000000,
  "purpose": ["운영자금", "시설자금"],
  "newShares": 10000000,
  "existingShares": 50000000,
  "dilutionRate": 20.0,
  "issuePrice": 5000,
  "referencePrice": 5556,
  "discountRate": 10.0,
  "thirdPartyName": "제3자 배정 대상자명 (해당시)",
  "subscriptionDate": "2026-07-01",
  "listingDate": "2026-07-15"
}
```

**파생값 계산식:**
```
dilutionRate = (newShares / existingShares) * 100
discountRate = ((referencePrice - issuePrice) / referencePrice) * 100
```

#### CB_ISSUANCE / BW_ISSUANCE
```json
{
  "eventType": "CB_ISSUANCE",
  "totalAmount": 30000000000,
  "interestRate": 0.0,
  "maturityDate": "2029-06-01",
  "conversionPrice": 4500,
  "conversionPremiumRate": -10.0,
  "refixClause": true,
  "earlyRedemptionDate": "2027-06-01",
  "allottee": "발행 대상자",
  "allotteeType": "INSTITUTIONAL" | "INDIVIDUAL" | "RELATED_PARTY" | "UNKNOWN",
  "maxDilutionShares": 6666666,
  "maxDilutionRate": 13.3
}
```

#### SHARE_BUYBACK / SHARE_CANCELLATION
```json
{
  "eventType": "SHARE_BUYBACK",
  "buybackAmount": 10000000000,
  "buybackShares": 2000000,
  "buybackRatioToTotal": 4.0,
  "buybackPriceMax": 5500,
  "buybackPriceMin": 4500,
  "buybackPeriodStart": "2026-06-01",
  "buybackPeriodEnd": "2026-08-31",
  "purpose": "주가 안정" | "소각" | "스톡옵션" | "기타"
}
```

#### DIVIDEND_INCREASE / DIVIDEND_CUT
```json
{
  "eventType": "DIVIDEND_INCREASE",
  "dividendPerShare": 500,
  "previousDividendPerShare": 300,
  "changeRate": 66.7,
  "dividendYield": 2.5,
  "recordDate": "2026-12-31",
  "paymentDate": "2027-04-01",
  "dividendType": "CASH" | "STOCK" | "HYBRID"
}
```

#### EARNINGS_SURPRISE / EARNINGS_SHOCK
```json
{
  "eventType": "EARNINGS_SURPRISE",
  "period": "2026Q1",
  "actualRevenue": 1000000000000,
  "actualOperatingProfit": 120000000000,
  "actualNetProfit": 90000000000,
  "consensusRevenue": 950000000000,
  "consensusOperatingProfit": 100000000000,
  "revenueBeatsRatio": 5.3,
  "opBeatsRatio": 20.0,
  "yoyRevenueGrowth": 12.0,
  "yoyOpGrowth": 35.0
}
```

#### MAJOR_SHAREHOLDER_CHANGE
```json
{
  "eventType": "MAJOR_SHAREHOLDER_CHANGE",
  "newHolder": "신규 최대주주명",
  "previousHolder": "기존 최대주주명",
  "newHolderShareRatio": 35.2,
  "transactionType": "TRANSFER" | "INHERITANCE" | "CONVERSION" | "OTHER",
  "changeDate": "2026-06-01"
}
```

#### LAWSUIT / AUDIT_OPINION_RISK / TRADING_SUSPENSION / DELISTING_RISK
```json
{
  "eventType": "LAWSUIT",
  "claimAmount": 5000000000,
  "claimAmountToAssets": 3.2,
  "plaintiff": "원고명",
  "subject": "소송 원인 요약",
  "filingDate": "2026-05-15",
  "courtLevel": "1심" | "2심" | "대법원"
}
```

### 4-4. reportName → eventType 1차 매핑 규칙

Rule 엔진은 `Disclosure.reportName` 문자열에 정규식을 순서대로 적용한다.  
매칭 실패 시 AI 보조 확인(L1), 그래도 불확실하면 `extractionStatus = NEEDS_REVIEW`.

```typescript
// backend/src/event-extraction/rules/report-name-mapping.rules.ts

export const REPORT_NAME_RULES: Array<{
  pattern: RegExp;
  eventType: EventType;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
}> = [
  // 계약 체결
  { pattern: /단일판매.*공급계약.*체결|공급계약.*체결/,
    eventType: EventType.SUPPLY_CONTRACT, polarity: 'POSITIVE', confidence: 0.92 },
  // 계약 해제·취소
  { pattern: /단일판매.*공급계약.*(해제|취소|종료)|공급계약.*(해제|취소)/,
    eventType: EventType.CONTRACT_CANCELLATION, polarity: 'NEGATIVE', confidence: 0.93 },
  // 자기주식 취득
  { pattern: /자기주식.*취득|자사주.*취득/,
    eventType: EventType.SHARE_BUYBACK, polarity: 'POSITIVE', confidence: 0.95 },
  // 자기주식 소각
  { pattern: /자기주식.*소각|자사주.*소각/,
    eventType: EventType.SHARE_CANCELLATION, polarity: 'POSITIVE', confidence: 0.95 },
  // 유상증자 (주주배정/일반공모)
  { pattern: /유상증자.*(주주배정|일반공모)/,
    eventType: EventType.PAID_IN_CAPITAL_INCREASE, polarity: 'NEGATIVE', confidence: 0.93 },
  // 제3자배정 유상증자
  { pattern: /유상증자.*제3자배정|제3자배정.*증자/,
    eventType: EventType.THIRD_PARTY_ALLOTMENT, polarity: 'NEGATIVE', confidence: 0.93 },
  // 전환사채
  { pattern: /전환사채.*발행|CB.*발행/i,
    eventType: EventType.CB_ISSUANCE, polarity: 'NEGATIVE', confidence: 0.94 },
  // 신주인수권부사채
  { pattern: /신주인수권부사채.*발행|BW.*발행/i,
    eventType: EventType.BW_ISSUANCE, polarity: 'NEGATIVE', confidence: 0.94 },
  // 최대주주 변경
  { pattern: /최대주주.*(변경|교체)/,
    eventType: EventType.MAJOR_SHAREHOLDER_CHANGE, polarity: 'MIXED', confidence: 0.90 },
  // 소송·횡령·배임
  { pattern: /소송.*제기|횡령|배임|소제기/,
    eventType: EventType.LAWSUIT, polarity: 'NEGATIVE', confidence: 0.91 },
  // 감사의견 리스크
  { pattern: /감사의견.*(거절|한정|부적정)|강조사항/,
    eventType: EventType.AUDIT_OPINION_RISK, polarity: 'NEGATIVE', confidence: 0.95 },
  // 거래정지
  { pattern: /거래정지|매매거래.*정지/,
    eventType: EventType.TRADING_SUSPENSION, polarity: 'NEGATIVE', confidence: 0.97 },
  // 상장폐지·관리종목
  { pattern: /상장폐지|관리종목.*지정|투자경고|투자위험/,
    eventType: EventType.DELISTING_RISK, polarity: 'NEGATIVE', confidence: 0.97 },
];
```

**우선순위:** 위에서 아래로 순서 적용, 첫 매칭 선택. `confidence < 0.75`이면 `isAiAssisted = true` 플래그 후 Phase 4 AI에 재확인 요청.

### 4-5. NestJS 모듈 설계

```
backend/src/event-extraction/
├── event-extraction.module.ts
├── event-extraction.service.ts       // 진입점: processDisclosure(rcpNo)
├── enums/
│   └── event-type.enum.ts
├── rules/
│   ├── report-name-mapping.rules.ts  // reportName → eventType 정규식 테이블
│   └── event-parser.base.ts          // 파서 추상 클래스
├── parsers/
│   ├── supply-contract.parser.ts
│   ├── capital-increase.parser.ts
│   ├── cb-bw.parser.ts
│   ├── share-buyback.parser.ts
│   ├── dividend.parser.ts
│   ├── earnings.parser.ts
│   ├── shareholder-change.parser.ts
│   └── risk-event.parser.ts
├── validators/
│   └── event-data.validator.ts       // 필수 필드 누락·비정상값 검증
└── event-extraction.controller.ts    // 관리자 수동 트리거용
```

**핵심 서비스 시그니처:**

```typescript
// event-extraction.service.ts

@Injectable()
export class EventExtractionService {
  // 공시 1건 처리 (scheduler hook에서 호출)
  async processDisclosure(rcpNo: string): Promise<DisclosureEvent>

  // 배치: 미처리 공시 일괄 처리
  async processPendingDisclosures(limit = 100): Promise<{ success: number; failed: number }>

  // 단일 파서 선택 및 실행
  private selectParser(eventType: EventType): EventParserBase

  // reportName 기반 1차 분류
  private classifyByReportName(reportName: string): {
    eventType: EventType | null;
    polarity: string;
    confidence: number;
  }

  // parsedJson에서 이벤트별 수치 추출
  private extractNumerics(
    eventType: EventType,
    parsedJson: Record<string, unknown>
  ): Record<string, unknown>

  // 파생값 계산 (salesRatio, dilutionRate 등)
  private computeDerivedValues(
    eventType: EventType,
    raw: Record<string, unknown>,
    company: Company
  ): Record<string, unknown>
}
```

**엔드포인트:**

```
POST /event-extraction/process/:rcpNo    // 단건 수동 처리 (관리자)
POST /event-extraction/batch             // 미처리 일괄 (관리자)
GET  /event-extraction/:rcpNo            // 결과 조회
GET  /disclosures/:rcpNo                 // 기존 엔드포인트 응답에 event 필드 추가
```

### 4-6. 추출 파이프라인 의사코드

```
processDisclosure(rcpNo):
  1. Disclosure 조회 (reportName 포함)
  2. DisclosureDocument 조회 (parsedJson 필수)
     → 없으면 extractionStatus = FAILED, failReason = "NO_PARSED_DOC"
  3. classifyByReportName(reportName)
     → eventType: null이면 AI L1 분류 요청 (isAiAssisted = true)
     → 여전히 null이면 extractionStatus = NEEDS_REVIEW
  4. selectParser(eventType).extract(parsedJson)
     → 필수 수치 파싱 (정규식 + 표 매칭)
  5. computeDerivedValues(eventType, raw, company)
     → salesRatio, dilutionRate 등 계산
     → 재무 데이터 없으면 해당 필드 null + derivedDataMissing: true
  6. validate(extractedData)
     → 필수 필드 누락 시 confidence -= 0.2, extractionStatus = NEEDS_REVIEW
  7. upsert DisclosureEvent
  8. (비동기) Phase 4 AI 분석 큐에 rcpNo 전달 (AI 적용 기준 통과 시)
```

### 4-7. AI 적용 기준 (이 Phase 한정)

Phase 3에서 AI 사용은 **이벤트 타입 분류 보조(L1)** 에만 허용한다.

| 조건 | 처리 |
|------|------|
| `confidence >= 0.85` | AI 미사용. Rule 결과 그대로 저장 |
| `0.60 <= confidence < 0.85` | AI L1: reportName + 공시 제목만 입력, eventType 확인 요청 |
| `confidence < 0.60` | AI L1 + `extractionStatus = NEEDS_REVIEW`. 관리자 검토 대기 |

**AI 금지 (Phase 3):**  
- 수치 계산 결정 (salesRatio, dilutionRate 등은 반드시 Rule로만)  
- 매수·매도 판단 입력 생성  
- 최종 eventType 결정 (AI는 제안만, 최종은 confidence 임계값 Rule이 결정)

---

## 5. 작업 분해 (체크리스트)

### 백엔드 — 모델 & 마이그레이션
- [ ] `EventType` enum 정의 (`event-type.enum.ts`)
- [ ] `DisclosureEvent` Prisma 모델 추가
- [ ] `Disclosure` 모델에 `events DisclosureEvent[]` 관계 필드 추가
- [ ] `Company` 모델에 `events DisclosureEvent[]` 관계 필드 추가
- [ ] `npx prisma migrate dev --name add-disclosure-event` 실행

### 백엔드 — Rule 엔진
- [ ] `report-name-mapping.rules.ts` 작성 (15종 정규식 패턴)
- [ ] `event-parser.base.ts` 추상 클래스 작성
- [ ] `supply-contract.parser.ts` 구현 (contractAmount, counterparty, 날짜)
- [ ] `capital-increase.parser.ts` 구현 (newShares, issuePrice, purpose)
- [ ] `cb-bw.parser.ts` 구현 (conversionPrice, refixClause, maturityDate)
- [ ] `share-buyback.parser.ts` 구현 (buybackAmount, period)
- [ ] `dividend.parser.ts` 구현 (dps, changeRate)
- [ ] `earnings.parser.ts` 구현 (actual vs consensus)
- [ ] `shareholder-change.parser.ts` 구현
- [ ] `risk-event.parser.ts` 구현 (LAWSUIT, AUDIT_OPINION_RISK 등)
- [ ] `event-data.validator.ts` 구현 (필수 필드 검증, 비정상값 탐지)

### 백엔드 — 서비스 & API
- [ ] `EventExtractionService` 구현 (processDisclosure, processPendingDisclosures)
- [ ] `computeDerivedValues` 함수 구현 (salesRatio, dilutionRate, discountRate 등)
- [ ] `EventExtractionController` 구현 (수동 트리거 엔드포인트)
- [ ] 공시 수집 완료 후 자동 처리 훅 추가 (`disclosure.service.ts` → EventExtractionService 호출)
- [ ] `GET /disclosures/:rcpNo` 응답에 `event` 필드 포함

### 백엔드 — AI 보조 연동 (L1)
- [ ] AI 분류 요청 인터페이스 정의 (`AiEventClassifier`)
- [ ] confidence 임계값 기반 AI 호출 분기 로직 구현
- [ ] AI 응답 → confidence 갱신 로직 구현
- [ ] `AIUsageLog` 연동 (Phase 11 선제 준비: rcpNo, level, inputTokens, cost)

### 모바일 — UI (최소 범위)
- [ ] 공시 상세 화면에 이벤트 타입 배지 및 핵심 수치 표시
- [ ] `salesRatio`, `dilutionRate` 등 파생값 강조 표시
- [ ] `extractionStatus = NEEDS_REVIEW` 공시에 "분석 중" 표시

### 테스트
- [ ] `report-name-mapping.rules.ts` 단위 테스트 (15종 패턴별 샘플 공시명)
- [ ] 각 파서 단위 테스트 (실제 DART HTML 샘플 사용)
- [ ] `computeDerivedValues` 단위 테스트 (salesRatio 경계값 포함)
- [ ] `EventExtractionService.processDisclosure` 통합 테스트

---

## 6. AI 사용 정책

| 항목 | 정책 |
|------|------|
| 사용 레벨 | L1 (저비용: 이벤트 타입 분류 보조) |
| 입력 | `reportName` + `disclosureType` + 공시 본문 첫 500자 |
| 출력 | `{ eventType, confidence, polarity }` JSON |
| 호출 조건 | Rule confidence < 0.85 인 경우만 |
| 호출 금지 | 수치 계산, 매수/매도 판단, 최종 분류 결정 |
| 비용 로그 | `AIUsageLog` (rcpNo, level="L1", inputTokens, outputTokens, costKrw) |
| 예상 비율 | 전체 공시의 10~20%만 AI 호출 (나머지는 Rule 처리) |

**AI 금지 영역 (3대 원칙 §4 준수):**  
- 최종 주문 승인 / 손익 하드룰 / 포트폴리오 한도 / 주문 수량 결정 → 이 Phase 범위 아님  
- 수치 추출(salesRatio, dilutionRate 등) → 반드시 Rule/Parser 전용

---

## 7. 비용 · 성능 고려사항

| 항목 | 기준 |
|------|------|
| Rule 파싱 처리 시간 | 공시 1건당 목표 < 200ms |
| 일 평균 신규 공시 수 | 평일 200~500건 (DART 전체 기준) |
| 관심 종목 필터 후 | 5~50건 (초기 50개 관심 종목 기준) |
| AI 호출 비율 | Rule 처리율 80% 이상 유지 목표 |
| AI 호출당 예상 비용 | 약 $0.001~0.003 (L1, gpt-4o-mini 등 저비용 모델) |
| DB 인덱스 | `eventType`, `corpCode`, `extractedAt`, `extractionStatus` 4개 복합 커버 |
| `extractedData` JSON 크기 | 이벤트당 평균 < 2KB 목표 |
| 미처리 적체 감시 | `extractionStatus = PENDING` 건수 모니터링 알림 설정 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 처리 방법 |
|--------|-----------|
| `DisclosureDocument.parsedJson`이 null | extractionStatus = FAILED, Phase 2 재파싱 요청 |
| 수치 단위 혼재 (억원/원/백만원) | 파서 내 단위 정규화 (→ 원 단위 통일) 필수 |
| 정정공시가 원공시 수치를 뒤집는 경우 | `isAmendment = true`, `originalRcpNo` 연결, 원공시 `isSuperseded = true` 플래그 |
| reportName이 불명확 ("주요사항보고서") | AI L1 보조 + NEEDS_REVIEW |
| 동일 공시에 복수 이벤트 (CB + 유상증자 동시) | `extractedData.events[]` 배열로 저장, 주요 이벤트 `eventType`으로 단일 분류 |
| 재무 데이터(매출액) 미확보 | `salesRatio = null`, `derivedDataMissing = true` 플래그 후 외부 API 연동 시 보완 |
| 매우 큰 계약금액 (수조원) | Float precision 이슈 방지 → DB에 `BigInt` 또는 `Decimal` 사용 검토 |
| 파서 미지원 eventType | `extractionStatus = NEEDS_REVIEW`, `extractedData = {}` 빈 JSON |
| DELISTING_RISK / TRADING_SUSPENSION | **즉시 알림 플래그 설정** — 모바일 긴급 알림으로 별도 처리 |

---

## 9. 완료 기준 (DoD)

- [ ] `DisclosureEvent` 테이블이 DB에 존재하고 `Disclosure.rcpNo`, `Company.corpCode` FK가 정상 연결됨
- [ ] 15종 `EventType` 모두 정규식 매핑 규칙이 존재하며 단위 테스트 통과
- [ ] 공급계약 샘플 공시 10건에 대해 `salesRatio` 자동 계산 및 저장 확인
- [ ] 유상증자 샘플 공시 10건에 대해 `dilutionRate`, `discountRate` 자동 계산 및 저장 확인
- [ ] Rule confidence < 0.85인 공시에서 AI L1 호출 발생, `isAiAssisted = true` 저장 확인
- [ ] `extractionStatus` 4종 (PENDING / SUCCESS / FAILED / NEEDS_REVIEW) 전이가 정상 동작
- [ ] 정정공시 시 `isAmendment = true`, `originalRcpNo` 연결 확인
- [ ] `GET /disclosures/:rcpNo` 응답에 `event` 필드(eventType, extractedData, confidence) 포함
- [ ] 모바일 공시 상세 화면에 이벤트 타입 배지 및 주요 수치(salesRatio 또는 dilutionRate) 표시
- [ ] Rule 처리 속도 공시 1건 < 200ms (DB I/O 제외 순수 파싱 시간)
- [ ] `AIUsageLog`에 L1 호출 기록 저장 (비용 추적 선제 준비)
- [ ] `DELISTING_RISK` / `TRADING_SUSPENSION` 이벤트 발생 시 긴급 알림 플래그 설정 확인
