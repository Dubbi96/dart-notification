# M2 QA 리뷰 보고서

> 작성: QA 에이전트 · 작성일: 2026-06-03  
> 기준: [M2 기술 계약서](./00-contract.md)  
> 리뷰 범위: schema.prisma, disclosure-events/**, disclosure-documents.module.ts, extractors/**, *.spec.ts, __fixtures__

---

## 요약

M2 구현은 전반적으로 계약 구조를 충실히 따르고 있으며 핵심 파이프라인(분류 → 추출 → upsert)은 동작한다. 단, 아래 **4개 확정 버그(CONFIRMED) + 4개 유력 버그(PLAUSIBLE)**가 발견되었다.

| 심각도 | 건수 | 내용 |
|--------|------|------|
| BLOCKER | 2 | processPendingDisclosures 재처리 무한루프 / classifier 테스트-구현 불일치 (BW) |
| MAJOR | 3 | discountRate 음수 변환 오류 / computeDerivedValues 파이프라인 미연결 / service 테스트 undefined≠null 어설션 |
| MINOR | 3 | parsedJson.dilutionRate 주석 공식 오류 / refixClause 통합 미구현 / HYBRID dividendType 미도달 |

---

## 발견된 이슈

### [BLOCKER-1] processPendingDisclosures — SUCCESS/FAILED 이벤트 무한 재처리

**파일**: `backend/src/disclosure-events/disclosure-events.service.ts` (L197-210)

```typescript
const docsWithoutEvent = await this.prisma.disclosureDocument.findMany({
  where: {
    parseStatus: 'DONE',
    rcpNo: {
      notIn: pendingEvents.length > 0
        ? pendingEvents.map((e) => e.rcpNo)
        : ['_placeholder_'],
    },
  },
  ...
});
```

`notIn` 리스트는 **PENDING 상태 이벤트 rcpNo만 제외**한다. SUCCESS/FAILED/NEEDS_REVIEW 상태로 이미 처리 완료된 DisclosureEvent가 있는 rcpNo를 제외하지 않는다. 배치를 반복 호출할 때마다 동일 공시를 반복 재처리하여 불필요한 upsert가 발생한다.

**수정 방향**: `docsWithoutEvent` 쿼리에 아래 조건 추가
```typescript
disclosure: { is: null }  // DisclosureEvent가 존재하지 않는 문서만
```
또는 `rcpNo: { notIn: allExistingEventRcpNos }` 방식으로 전체 이벤트 rcpNo 제외.

---

### [BLOCKER-2] classifyEventType — docType='CB_BW_ISSUANCE' + bondType='BW' 시 항상 CB_ISSUANCE 반환

**파일**: `backend/src/disclosure-events/extractors/event-classifier.ts` (L193-195)

```typescript
CB_BW_ISSUANCE: { eventType: EventType.CB_ISSUANCE, polarity: 'NEGATIVE' },
```

docType fallback 경로의 `docTypeMapping`이 `CB_BW_ISSUANCE`를 무조건 `CB_ISSUANCE`로 매핑한다. `parsedJson.bondType`을 확인하지 않으므로 BW 공시가 CB로 잘못 분류된다.

**테스트 불일치**: `event-classifier.spec.ts` L182-189가 `CB_BW_ISSUANCE + bondType='BW'` → `BW_ISSUANCE`를 기대하지만 실제 구현은 `CB_ISSUANCE`를 반환하여 **테스트가 실패**한다.

**수정 방향**: docTypeMapping 조회 후 bondType 체크 추가
```typescript
if (mapped) {
  let resolvedEventType = mapped.eventType;
  // CB_BW_ISSUANCE일 때 bondType으로 CB/BW 구분
  if (docType === 'CB_BW_ISSUANCE' && parsedJson.bondType === 'BW') {
    resolvedEventType = EventType.BW_ISSUANCE;
  }
  return { eventType: resolvedEventType, polarity: mapped.polarity, confidence: 0.70 };
}
```

---

### [MAJOR-1] capital-increase.ts — 음수 discountRate 단위 변환 오류

**파일**: `backend/src/disclosure-events/extractors/capital-increase.ts` (L39-44)

```typescript
const discountRate =
  rawDiscount !== null
    ? rawDiscount > 0 && rawDiscount < 1
        ? round2(rawDiscount * 100)
        : round2(rawDiscount)
    : null;
```

`rawDiscount > 0` 조건은 음수 소수점 값을 처리하지 못한다. 예: M1이 `-0.05`(5% 프리미엄)를 저장했다면 조건 실패 → `round2(-0.05) = -0.05` 반환 (단위 % 미변환). 올바른 결과는 `-5.0`이어야 한다.

**수정 방향**: 절대값으로 범위 판정
```typescript
const discountRate = rawDiscount !== null
  ? Math.abs(rawDiscount) < 1 ? round2(rawDiscount * 100) : round2(rawDiscount)
  : null;
```

---

### [MAJOR-2] processDisclosure 파이프라인 — computeDerivedValues 미호출 (계약 §4-2 위반)

**파일**: `backend/src/disclosure-events/disclosure-events.service.ts` (L50-175)

계약 §4-2는 파이프라인 Step 4로 `computeDerivedValues(eventType, raw)` 호출을 명시하지만, `processDisclosure` 내부에서 **이 메서드가 호출되지 않는다**. 현재는 각 파서(supply-contract.ts 등)가 파생값을 자체 계산하므로 일부 값은 올바르게 저장된다.

그러나 parsedJson에 관련 필드가 있지만 파서가 생략한 파생값(예: `buybackRatioToTotal`, `changeRate`, `cancellationRatioToTotal`)은 서비스 레이어에서도 보정되지 않는다. `computeDerivedValues`는 공개 메서드이지만 실질적으로 데드 코드(파이프라인 외부)로 방치된다.

**수정 방향**: `processDisclosure` Step 4에서 `computeDerivedValues` 호출 추가
```typescript
const enriched = this.computeDerivedValues(eventType, data);
```

---

### [MAJOR-3] service.spec.ts — salesRatio 분모 0 테스트 어설션이 `undefined`로 계약 위반

**파일**: `backend/src/disclosure-events/disclosure-events.service.spec.ts` (L245-252)

```typescript
it('분모 0 → 파생값 null', () => {
  const result = service.computeDerivedValues(EventType.SUPPLY_CONTRACT, {
    contractAmount: 10_000_000_000,
    recentSales: 0,
  });
  expect(result['salesRatio']).toBeUndefined();  // ← undefined 기대
});
```

계약 §5 명세는 분모 0일 때 파생값을 **null**로 반환하도록 규정한다. 실제 서비스 코드에서 `recentSales = 0`이면 `result['salesRatio']`는 `undefined`가 된다(키 자체 미존재). `toBeUndefined()` 어설션은 통과하지만 계약 위반이며, 클라이언트가 `null` 체크로 파생값 누락을 판단할 경우 예기치 않은 동작을 유발한다.

**수정 방향**: `computeDerivedValues`에서 조건 미충족 시 명시적 `null` 할당 추가
```typescript
result['salesRatio'] = null;  // recentSales가 0이거나 null일 때
```
그리고 테스트 어설션도 `.toBeNull()`로 수정.

---

### [MINOR-1] parsed-json.type.ts — dilutionRate 주석 공식 오류

**파일**: `backend/src/disclosure-documents/types/parsed-json.type.ts` (L68)

```typescript
/** 희석률 = newShares / (newShares + existingShares) */
dilutionRate?: number;
```

주석 공식은 `newShares / (newShares + existingShares)`이지만 계약 §2-5·§5 및 capital-increase.ts 구현은 `newShares / existingShares * 100`을 사용한다. 공식 불일치로 인해 M1이 parsedJson.dilutionRate를 직접 저장할 경우 M2 파서의 재계산 결과와 다른 값이 저장될 수 있다(현재 capital-increase.ts는 parsedJson.dilutionRate를 읽지 않으므로 런타임 버그는 없지만 향후 혼란 유발).

---

### [MINOR-2] cb-bw.ts — REFIX_PATTERN 정의·export만 있고 실제 파서에서 미사용

**파일**: `backend/src/disclosure-events/extractors/cb-bw.ts` (L23, L48-49)

`REFIX_PATTERN`이 파일에 선언되고 export되지만 `extract()` 내부에서는 `refixClause: null`을 하드코딩한다. 계약 §2-6은 `parsedJson` 내 키워드 "리픽스"·"조정" 탐지를 명시하며, `parsedJson`에 관련 필드가 있을 수 있음에도 탐지를 전혀 시도하지 않는다. cb-bw.spec.ts의 REFIX_PATTERN 테스트도 파서 통합이 아닌 정규식 자체만 검증한다.

---

### [MINOR-3] dividend.ts — inferDividendType이 'HYBRID' 반환 불가

**파일**: `backend/src/disclosure-events/extractors/dividend.ts` (L62-66)

```typescript
function inferDividendType(docType: string | null | undefined): 'CASH' | 'STOCK' | 'HYBRID' {
  if (!docType) return 'CASH';
  if (/현물/.test(docType)) return 'STOCK';
  return 'CASH';
}
```

계약 §2-4의 `DividendData.dividendType` 타입에는 `'HYBRID'`가 포함되지만 현재 함수는 절대 `'HYBRID'`를 반환하지 않는다. 현물+현금 혼합 배당 공시에서 오분류가 발생한다.

---

## 누락된 테스트 케이스 (보강 권고)

아래 케이스는 현재 spec 파일에 없으므로 추가를 권고한다.

### capital-increase.spec.ts

```typescript
it('음수 discountRate(-0.05) → -5.0% 변환', () => {
  const parsed = makeParsedJson({ discountRate: -0.05 });
  const result = extract(parsed, '');
  expect(result.discountRate).toBe(-5.0);  // 현재 구현은 -0.05 반환 (버그)
});
```

### event-classifier.spec.ts

```typescript
it('CB_BW_ISSUANCE docType + bondType 없음 → CB_ISSUANCE', () => {
  const result = classifyEventType('주요사항보고서', makeParsedJson({ docType: 'CB_BW_ISSUANCE' }));
  expect(result.eventType).toBe(EventType.CB_ISSUANCE);
});
```

### service.spec.ts (computeDerivedValues)

```typescript
it('분모 0 → 파생값 null (undefined 아님)', () => {
  const result = service.computeDerivedValues(EventType.SUPPLY_CONTRACT, {
    contractAmount: 10_000_000_000,
    recentSales: 0,
  });
  expect(result['salesRatio']).toBeNull();  // undefined가 아닌 null이어야 함
});
```

### dividend.spec.ts

```typescript
it('HYBRID 배당 분류 케이스 (현재 inferDividendType 미구현)', () => {
  // 향후 구현 시 test 추가: docType에 "현금+현물" 포함 → HYBRID
});
```

---

## 라이브 검증 체크리스트

실제 DART 공시 parsedJson으로 추출 정확도를 검증할 때 아래 순서로 진행한다.

- [ ] **실제 단일판매·공급계약 공시** rcpNo로 `POST /disclosure-events/extract/:rcpNo` 호출 → `extractedData.salesRatio` 값이 DART 원문 계약금액/최근매출액 비율과 일치하는지 확인
- [ ] **유상증자(주주배정) 공시** → `extractedData.dilutionRate` = 신주/기존주 × 100 일치 여부 수동 대조
- [ ] **유상증자(제3자배정) 공시** → `issueType = 'THIRD_PARTY'` 분류 확인
- [ ] **전환사채 공시** → `maxDilutionShares = floor(발행금액 / 전환가액)` 수동 계산 대조
- [ ] **신주인수권부사채 공시** (reportName에 "신주인수권부사채" 포함) → `eventType = BW_ISSUANCE`, `bondType = BW` 확인
- [ ] **CB 공시** (reportName에 "CB" 영문 포함) → 대소문자 구분 없이 `CB_ISSUANCE` 분류 확인 (regex `/i` flag)
- [ ] **docType = 'CB_BW_ISSUANCE' + reportName 불명확** → bondType 체크 수정 후 BW/CB 구분 재확인
- [ ] **parsedJson = {} (SKIPPED 문서)** → `extractionStatus = NEEDS_REVIEW`(OTHER 분류) 확인 (FAILED 아님 유의)
- [ ] **정정공시** → `isAmendment = true`, `originalRcpNo` 연결 확인
- [ ] **`POST /disclosure-events/batch` 반복 호출** → SUCCESS 완료 건이 재처리되지 않도록 수정 후 재확인 (BLOCKER-1 수정 검증)
- [ ] **confidence < 0.85 공시** → `isAiAssisted = true`, `extractionStatus = NEEDS_REVIEW` 전이 확인
- [ ] **M2 전파 실패율 측정 쿼리** (계약 §6-3) → `failure_rate_pct` 10% 이하 확인

---

## 계약 이행 체크리스트 상태

| 항목 | 상태 | 비고 |
|------|------|------|
| Prisma enum EventType (17종 + OTHER) | ✅ 완료 | |
| Prisma enum ExtractionStatus | ✅ 완료 | |
| DisclosureEvent 모델 | ✅ 완료 | |
| Disclosure/Company 역참조 | ✅ 완료 | |
| DisclosureEventsModule 생성 및 app.module.ts 등록 | ✅ 완료 | |
| extractors/ 계약 경로·시그니처 | ✅ 완료 | |
| classifyEventType 시그니처 | ✅ 완료 | |
| extractEventData 시그니처 | ✅ 완료 | |
| 각 파서 extract() 시그니처 | ✅ 완료 | share-buyback.ts는 extractCancellation 별도 export (계약 준수) |
| DisclosureEventsService.processDisclosure | ⚠️ 부분 | computeDerivedValues 미호출 (MAJOR-2) |
| DisclosureEventsService.processPendingDisclosures | ⚠️ 버그 | 완료 이벤트 재처리 (BLOCKER-1) |
| DisclosureEventsService.onDocumentParsed | ✅ 완료 | |
| DisclosureEventsController 4종 엔드포인트 | ✅ 완료 | Swagger 데코레이터 포함 |
| M1 @Optional() 체이닝 | ✅ 완료 | forwardRef + @Optional 정상 적용 |
| GET /disclosures/:rcpNo event 필드 포함 | ✅ 완료 | |
| 픽스처 8종 | ✅ 완료 | share-cancellation 없지만 계약 §6-1 목록에 없음 |
| 단위 테스트 7종 | ⚠️ 버그 | CB/BW spec 테스트 실패 (BLOCKER-2), service spec 어설션 오류 (MAJOR-3) |
| M2 회귀 측정 쿼리 | ❌ 미구현 | 계약 §6-3 측정 로직 누락 |
