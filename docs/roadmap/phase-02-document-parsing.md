> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 2 — 공시 원문 파싱·구조화

> 작성일: 2026-06-02 · 상태: 설계 준비 완료(미착수)

---

## 1. 목적 & 범위

### 목적
공시 제목만으로는 주가 영향을 판단할 수 없다. `rcpNo` 기준으로 DART 원문을 다운로드하고, HTML/XML/첨부 문서를 파싱해 **본문 텍스트·표 데이터·핵심 key-value**를 구조화된 JSON으로 저장한다. 이 출력이 Phase 3(이벤트 수치 추출)·Phase 4(AI 분석)의 입력이 된다.

### 핵심 원칙 (반드시 준수)
> **공시 전문을 AI에 통째로 넣지 않는다.** 표·수치를 먼저 Rule 기반으로 추출한 뒤, 최소 입력만 AI에 전달한다. 비용 통제의 출발점.

### 포함 범위
- DART `document.xml` 및 문서 뷰어 HTML 다운로드
- 첨부파일 ZIP 다운로드 및 대상 파일 식별
- HTML/XML 본문 텍스트 추출 (불필요 태그 제거)
- 표(table) 데이터 → 2차원 배열 추출
- 핵심 항목 key-value 변환 (공시 유형별 템플릿 매핑)
- 정정공시(rmk 필드 기준) 판별 및 원공시-정정 diff 구조 저장
- 파싱 실패 시 재처리 큐 관리

### 제외 범위
- AI 기반 의미 해석 → Phase 4
- 이벤트 타입 분류·수치 계산 → Phase 3
- 첨부 PDF 이미지 OCR (1차 구현 제외, 리스크 항목에 기록)

---

## 2. 현재 코드베이스 연결점

| 연결 대상 | 위치 | 설명 |
|-----------|------|------|
| `Disclosure` 모델 | `backend/prisma/schema.prisma` | `rcpNo` (PK) · `corpCode` (FK) · `rmk` (정정 여부 힌트) 이미 존재 |
| `Company` 모델 | 동일 파일 | `corpCode` (PK) — `DisclosureDocument.corpCode` FK 연결 기준 |
| `DisclosureSchedulerService` | `backend/src/scheduler/` | 수집 후 `rcpNo` 목록 확보됨 → 파싱 트리거 연결 지점 |
| DART API 연동 모듈 | `backend/src/dart/` (추정) | `apiKey` 주입 패턴 재사용 |
| `POST /scheduler/collect` | 수동 수집 엔드포인트 | 이 엔드포인트 완료 후 파싱 파이프라인을 체이닝하거나 이벤트 발행 |

---

## 3. 선행 조건 & 의존성

| 항목 | 이유 |
|------|------|
| **Phase 1 완료** | 안정적인 `rcpNo` 목록 없이 원문 다운로드 불가 |
| DART OpenAPI 키 (`DART_API_KEY` 환경 변수) | 원문 다운로드 API 호출 필수 |
| S3 또는 로컬 스토리지 경로 확정 | `rawFilePath` 저장 위치 결정 필요 |
| 스토리지 접근 설정 (AWS S3 or EFS) | 원문 파일을 컨테이너 외부에 영속 저장 |
| `disclosures` 테이블에 `rmk` 데이터 적재 완료 | 정정공시 판별 기준 |

---

## 4. 상세 설계

### 4-1. Prisma 모델 스케치

```prisma
// DisclosureDocument — 원문 파싱 결과 저장
model DisclosureDocument {
  id           String   @id @default(cuid())

  // 자연키 연결 (Disclosure.rcpNo → PK)
  rcpNo        String   @unique
  corpCode     String                       // Company.corpCode FK (조회 성능)

  // 원문 파일
  rawFilePath  String?                      // S3 key 또는 로컬 경로 (HTML/XML 원본)
  attachmentPaths String[]                  // 첨부 ZIP 내 추출 파일 경로 목록

  // 파싱 결과
  rawText      String?  @db.Text           // 태그 제거 후 순수 텍스트
  tables       Json?                        // 추출된 표 목록: Table[]
  parsedJson   Json?                        // 핵심 key-value 구조화 결과
  wordCount    Int?                         // rawText 글자 수 (AI 입력 비용 예측용)

  // 정정공시 관계
  isAmendment        Boolean  @default(false)  // rmk 기반 정정 여부
  originalRcpNo      String?                   // 원공시 rcpNo (정정 시에만)
  amendmentDiff      Json?                     // 정정 전후 변경 필드 diff

  // 상태 관리
  parseStatus  ParseStatus  @default(PENDING)
  fetchedAt    DateTime?
  parsedAt     DateTime?
  retryCount   Int          @default(0)
  lastError    String?

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // Relations
  disclosure   Disclosure  @relation(fields: [rcpNo], references: [rcpNo])
  company      Company     @relation(fields: [corpCode], references: [corpCode])

  @@index([corpCode])
  @@index([parseStatus])
  @@index([isAmendment])
  @@index([originalRcpNo])
  @@index([fetchedAt])
  @@map("disclosure_documents")
}

enum ParseStatus {
  PENDING        // 미처리
  FETCHING       // 다운로드 중
  FETCH_FAILED   // 다운로드 실패
  PARSING        // 파싱 중
  PARSE_FAILED   // 파싱 실패
  DONE           // 완료
  SKIPPED        // 파싱 불필요(단순 공시 등) 판단
}
```

**기존 스키마와의 정합 규칙**
- `DisclosureDocument.rcpNo` → `Disclosure.rcpNo` (1:1, onDelete: Cascade)
- `DisclosureDocument.corpCode` → `Company.corpCode` (N:1, denormalize로 조회 성능 확보)
- `DisclosureDocument.originalRcpNo`는 같은 테이블의 다른 행(`rcpNo`)을 가리키는 자기 참조(nullable)

**`tables` JSON 스키마 예시**
```json
[
  {
    "tableIndex": 0,
    "headers": ["항목", "금액(원)", "비고"],
    "rows": [
      ["계약금액", "120000000000", "부가세 포함"],
      ["최근 매출액", "500000000000", "2025년 연간"]
    ]
  }
]
```

**`parsedJson` 구조 (Phase 3로 전달되는 중간 산출물)**
```json
{
  "docType": "SUPPLY_CONTRACT",
  "contractAmount": 120000000000,
  "recentSales": 500000000000,
  "counterparty": "거래상대방명",
  "contractStartDate": "2026-06-01",
  "contractEndDate": "2027-05-31",
  "rawTableCount": 3,
  "keyValueSource": "table_0"
}
```

---

### 4-2. NestJS 모듈·서비스·엔드포인트 시그니처

**모듈 구조**
```
backend/src/
  document-parsing/
    document-parsing.module.ts
    document-parsing.service.ts       // 파이프라인 오케스트레이터
    document-parsing.controller.ts    // 관리자 수동 트리거 엔드포인트
    fetcher/
      dart-document.fetcher.ts        // DART API 다운로드
    parser/
      html.parser.ts                  // HTML → 텍스트 + 표
      xml.parser.ts                   // document.xml 파싱
      table.extractor.ts              // <table> → 2D 배열
      key-value.mapper.ts             // 공시 유형별 템플릿 매핑
    diff/
      amendment.detector.ts           // rmk 기반 정정 판별
      disclosure.diff.ts              // 원공시 vs 정정공시 필드 diff
    retry/
      parse-retry.scheduler.ts        // 실패 건 재처리 스케줄러
```

**서비스 시그니처**
```typescript
// document-parsing.service.ts
class DocumentParsingService {
  // 단건 파이프라인 실행 (스케줄러 or 수동 트리거)
  async parseDisclosure(rcpNo: string): Promise<DisclosureDocument>

  // 배치: PENDING 상태 N건 처리
  async processPendingBatch(limit: number): Promise<{ success: number; failed: number }>

  // 정정공시 감지 후 diff 저장
  async detectAndLinkAmendment(doc: DisclosureDocument): Promise<void>

  // 재처리 대상 조회 (retryCount < MAX_RETRY && parseStatus IN [FETCH_FAILED, PARSE_FAILED])
  async getRetryQueue(limit: number): Promise<DisclosureDocument[]>
}

// dart-document.fetcher.ts
class DartDocumentFetcher {
  // DART 문서 뷰어 URL: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=...
  async fetchDocumentHtml(rcpNo: string): Promise<string>         // 뷰어 HTML

  // DART document.xml: https://opendart.fss.or.kr/api/document.xml?...
  async fetchDocumentXml(rcpNo: string): Promise<string>         // XML 원문

  // 첨부 ZIP 다운로드 및 압축 해제
  async fetchAttachmentZip(rcpNo: string): Promise<string[]>     // 추출 파일 경로 목록
}

// html.parser.ts
class HtmlParser {
  // HTML → rawText (script/style/nav 제거, &nbsp; 정규화)
  parseText(html: string): string

  // HTML <table> 전체 추출
  extractTables(html: string): Table[]
}

// key-value.mapper.ts
class KeyValueMapper {
  // 공시 유형별 템플릿으로 표 데이터 → key-value 변환
  map(tables: Table[], disclosureType: string): Record<string, unknown>
}

// amendment.detector.ts
class AmendmentDetector {
  // rmk 필드 패턴: "[기재정정]", "[첨부정정]" 등
  isAmendment(rmk: string): boolean
  extractOriginalRcpNo(rmk: string): string | null  // rmk 내 원공시 rcpNo 파싱
}
```

**컨트롤러 엔드포인트**
```typescript
// document-parsing.controller.ts
// 전체: 관리자 전용 (Guard 적용)

// 단건 파싱 수동 트리거
POST /document-parsing/parse/:rcpNo
→ 200 { rcpNo, parseStatus, parsedAt }

// 배치 파싱 (PENDING 건 처리)
POST /document-parsing/batch?limit=50
→ 200 { success: number, failed: number, durationMs: number }

// 파싱 결과 조회
GET /document-parsing/:rcpNo
→ 200 DisclosureDocumentDto (rawText 제외, parsedJson + tables 포함)

// 파싱 상태 현황
GET /document-parsing/stats
→ 200 { PENDING, DONE, PARSE_FAILED, FETCH_FAILED, SKIPPED: number }

// 재처리 큐 강제 실행
POST /document-parsing/retry?limit=20
→ 200 { queued: number }
```

---

### 4-3. 파싱 파이프라인 단계 (의사코드)

```
function parseDisclosure(rcpNo):
  doc = upsert DisclosureDocument(rcpNo, status=FETCHING)

  // Step 1: 원문 다운로드
  try:
    html = fetchDocumentHtml(rcpNo)
    xmlRaw = fetchDocumentXml(rcpNo)
    attachPaths = fetchAttachmentZip(rcpNo)   // 없으면 []
    doc.rawFilePath = saveToStorage(rcpNo, html)
    doc.attachmentPaths = attachPaths
    doc.fetchedAt = now()
  catch e:
    doc.parseStatus = FETCH_FAILED
    doc.lastError = e.message
    doc.retryCount += 1
    return save(doc)

  // Step 2: 텍스트 추출
  doc.parseStatus = PARSING
  doc.rawText = htmlParser.parseText(html)
  doc.wordCount = len(doc.rawText)

  // Step 3: 표 추출
  doc.tables = tableExtractor.extractTables(html)

  // Step 4: key-value 매핑 (Rule 기반, 공시 유형별 템플릿)
  disclosure = getDisclosure(rcpNo)
  doc.parsedJson = keyValueMapper.map(doc.tables, disclosure.disclosureType)

  // Step 5: 정정공시 판별 및 diff 연결
  if amendmentDetector.isAmendment(disclosure.rmk):
    doc.isAmendment = true
    originalRcpNo = amendmentDetector.extractOriginalRcpNo(disclosure.rmk)
    if originalRcpNo:
      doc.originalRcpNo = originalRcpNo
      originalDoc = getDocument(originalRcpNo)
      if originalDoc?.parsedJson:
        doc.amendmentDiff = computeDiff(originalDoc.parsedJson, doc.parsedJson)

  doc.parseStatus = DONE
  doc.parsedAt = now()
  save(doc)
  return doc
```

---

### 4-4. 정정공시 diff 구조

```typescript
// amendment.diff.ts
type FieldDiff = {
  field: string
  before: unknown   // 원공시 값
  after: unknown    // 정정공시 값
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED'
}

type AmendmentDiff = {
  originalRcpNo: string
  amendmentRcpNo: string
  changedFields: FieldDiff[]
  summary: string   // 예: "계약금액 100억 → 120억 (+20%)"
}
```

**diff 계산 규칙**
- `parsedJson`의 최상위 키 비교 (deep diff, 1레벨)
- 숫자 필드는 변화율(%) 함께 기록
- 날짜 필드는 before/after 그대로 기록
- `rawText` diff는 저장 안 함 (용량 과다) — 필요 시 on-demand 계산

---

### 4-5. AI 입력 최소화 규칙

| 입력 후보 | 크기 | 판단 |
|-----------|------|------|
| rawText 전체 | 수천 토큰 | **금지** — Phase 4에서도 전체 전달 금지 |
| parsedJson (key-value) | ~수백 토큰 | Phase 4 기본 입력 |
| tables[0].rows (핵심 표만) | ~수백 토큰 | Phase 4 보조 입력 |
| rawText 앞 500자 + parsedJson | 제한적 | Phase 4 예외 허용 (단순 정보 부족 시) |

Phase 2 단계에서는 AI를 호출하지 않는다. **파싱 결과를 AI가 처리하기 적합한 최소 구조로 만드는 것**이 이 Phase의 전부다.

---

## 5. 작업 분해 (체크리스트)

### 5-1. DB / 스키마
- [ ] `DisclosureDocument` 모델 `schema.prisma`에 추가 (`ParseStatus` enum 포함)
- [ ] `Disclosure` 모델에 `document DisclosureDocument?` 역방향 relation 추가
- [ ] `Company` 모델에 `disclosureDocuments DisclosureDocument[]` 역방향 relation 추가
- [ ] `npx prisma migrate dev --name add-disclosure-document` 실행
- [ ] 마이그레이션 파일 git 커밋 확인

### 5-2. 스토리지 설정
- [ ] S3 버킷 경로 규칙 확정: `dart-documents/{rcpNo}/index.html`, `dart-documents/{rcpNo}/document.xml`
- [ ] 로컬 개발용 폴백 경로 설정 (`STORAGE_DRIVER=local` 환경 변수)
- [ ] `StorageService` 추상화 인터페이스 작성 (S3 / 로컬 전환 가능)

### 5-3. Fetcher 구현
- [ ] DART 문서 뷰어 HTML 다운로드 (`dart-document.fetcher.ts`)
- [ ] DART `document.xml` 다운로드
- [ ] 첨부 ZIP 다운로드 + 압축 해제 (`.hwp`, `.pdf`, `.xlsx` 식별)
- [ ] 다운로드 실패 시 `FETCH_FAILED` + `retryCount` 증가 로직
- [ ] DART API Rate Limit 대응 (요청 간 지연 설정, 기본 500ms)

### 5-4. Parser 구현
- [ ] `html.parser.ts`: `cheerio` 또는 `node-html-parser` 기반 텍스트 추출
- [ ] `table.extractor.ts`: `<table>` → `Table[]` (헤더 자동 감지)
- [ ] `xml.parser.ts`: `document.xml` `<SECTION>` 블록 처리
- [ ] `key-value.mapper.ts`: 초기 5종 공시 템플릿 구현
  - [ ] 단일판매·공급계약: 계약금액, 최근 매출액, 거래상대방, 계약기간
  - [ ] 자기주식 취득·소각: 취득 주식 수, 취득 금액, 취득 방법, 기간
  - [ ] 현금·현물배당: 배당금 총액, 주당 배당금, 배당기준일, 전기 대비
  - [ ] 유상증자: 발행 주식 수, 발행 금액, 발행 방법, 할인율, 기존 주식 수
  - [ ] 전환사채·신주인수권부사채(CB/BW): 발행 금액, 전환가액, 이자율, 만기

### 5-5. 정정공시 처리
- [ ] `amendment.detector.ts`: `rmk` 패턴 매칭 (`[기재정정]`, `[첨부정정]`, `[자진정정]` 등)
- [ ] `disclosure.diff.ts`: `parsedJson` 필드 diff 계산 및 변화율 산출
- [ ] 원공시가 미파싱 상태일 때 diff 지연 처리 로직 (큐 기반)

### 5-6. 파이프라인 오케스트레이션
- [ ] `document-parsing.service.ts`: 단건 파이프라인 `parseDisclosure(rcpNo)` 구현
- [ ] 배치 처리 `processPendingBatch(limit)` (Promise.allSettled, 동시 5건 상한)
- [ ] 수집 완료 이벤트 → 자동 파싱 트리거 (`EventEmitter2` 연동)
- [ ] `parse-retry.scheduler.ts`: 매 30분 실패 건 재처리 (MAX_RETRY = 3)

### 5-7. 컨트롤러 & 엔드포인트
- [ ] `DocumentParsingController` 구현 (관리자 Guard 필수)
- [ ] `GET /document-parsing/stats` 상태 현황 엔드포인트
- [ ] `POST /document-parsing/parse/:rcpNo` 단건 수동 트리거
- [ ] `POST /document-parsing/batch` 배치 트리거
- [ ] `POST /document-parsing/retry` 재처리 강제 실행
- [ ] Swagger 데코레이터 (`@ApiTags`, `@ApiOperation`) 적용

### 5-8. 테스트
- [ ] `html.parser.spec.ts`: 실제 DART HTML 샘플 파싱 단위 테스트
- [ ] `table.extractor.spec.ts`: 다양한 표 구조 케이스 커버
- [ ] `key-value.mapper.spec.ts`: 5종 공시 매핑 검증
- [ ] `amendment.detector.spec.ts`: `rmk` 패턴 케이스 전수 검증
- [ ] E2E: 실제 rcpNo로 전체 파이프라인 통합 테스트 (목 DART API 사용)

---

## 6. AI 사용 정책

**이 Phase에서 AI 호출 없음.** Phase 2는 전적으로 Rule 기반 파싱이다.

| 항목 | 정책 |
|------|------|
| AI 호출 여부 | **금지** (Phase 2 범위 내) |
| AI 관련 준비 사항 | `wordCount` 저장으로 Phase 4 비용 예측 기반 마련 |
| parsedJson 설계 원칙 | Phase 4에서 AI가 최소 토큰으로 핵심만 받을 수 있도록 key-value 압축 |

**AI 금지 영역 명시 (전체 시스템 공통 — Phase 2와 무관하지만 기록)**
- 최종 주문 승인 / 손익 하드 룰 / 포트폴리오 한도 / 주문 수량 결정 / 리스크 룰 우회
- Phase 2에서 생성된 `parsedJson`을 이용해 자동 매수 판단을 내리는 것 → 절대 금지

---

## 7. 비용·성능 고려사항

| 항목 | 수치 목표 | 비고 |
|------|-----------|------|
| 단건 파싱 소요 시간 | < 3초 (p95) | 다운로드 + 파싱 합산 |
| 배치 처리 속도 | 50건 < 5분 | 동시 5건, I/O 병렬 |
| rawText 저장 크기 | 평균 < 50KB | 장문 공시 최대 200KB |
| 재처리 최대 횟수 | MAX_RETRY = 3 | 초과 시 SKIPPED 처리 + 운영자 알림 |
| S3 스토리지 비용 | 초기 < $5/월 | 관심 기업 50개 × 일 5건 × 365일 |
| DART API Rate Limit | 요청 간 500ms 지연 | IP 차단 방지 |
| 정정공시 diff 연산 | < 100ms | 메모리 내 JSON 비교 |

**인덱스 전략**
- `parseStatus` 인덱스: 배치 처리 시 `WHERE parseStatus = 'PENDING'` 성능
- `corpCode` 인덱스: 종목별 파싱 현황 조회
- `fetchedAt` 인덱스: 날짜 범위 재처리 쿼리

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 영향 | 대응 |
|--------|------|------|
| DART 뷰어 HTML 구조 변경 | 파싱 전체 실패 | `PARSE_FAILED` 감지 + 모니터링 알림, 파서 격리 설계 |
| 첨부 HWP/PDF 이미지 스캔본 | key-value 추출 불가 | 1차 제외, `rawFilePath`에 경로만 저장. Phase 후속에서 OCR 검토 |
| 정정공시 rcpNo가 rmk에 없는 경우 | diff 연결 불가 | `originalRcpNo = null`로 저장, diff는 null. 이후 수동 연결 API 제공 |
| 같은 rcpNo로 중복 파싱 요청 | DB 충돌 | `upsert` 사용, status가 DONE이면 재처리 스킵 |
| rawText 과도하게 큰 공시 (>500KB) | DB 부하 | 200KB 상한 truncate 후 `wordCount` 기록, 원본은 S3에만 보관 |
| DART API 일시 장애 | 다운로드 전체 실패 | `FETCH_FAILED` + 재처리 큐. 장애 지속 시 운영자 Slack 알림 |
| 관심 기업 외 공시 파싱 | 비용 낭비 | 배치 처리 시 WatchList 기준 필터 우선 적용 |
| 동일 원공시에 정정이 여러 건 | diff 체인 복잡 | `originalRcpNo` 항상 **최초** 원공시를 가리키도록 통일 |

---

## 9. 완료 기준 (DoD)

### 기능 완료
- [ ] DART `rcpNo` 기준 원문 HTML/XML 다운로드 및 S3(또는 로컬) 저장 동작
- [ ] `rawText` 추출 — 스크립트·스타일 제거, 공백 정규화 완료
- [ ] `tables` 추출 — 주요 5종 공시 기준 핵심 표 1개 이상 추출 검증
- [ ] `parsedJson` 생성 — 5종 공시 각 1건 이상 key-value 정확도 수동 확인
- [ ] 정정공시(`rmk` 기반) 판별 및 `originalRcpNo` 연결 동작
- [ ] `amendmentDiff` 정상 생성 (정정 전후 수치 변화 확인 가능)
- [ ] `parseStatus` 전이 정상 동작 (`PENDING → FETCHING → PARSING → DONE` 또는 `*_FAILED`)
- [ ] 실패 재처리: `FETCH_FAILED`/`PARSE_FAILED` 건이 30분 후 재처리 대상에 포함됨
- [ ] `MAX_RETRY(3)` 초과 건이 `SKIPPED`로 전환됨
- [ ] 관리자 엔드포인트 5개 동작 + Swagger 문서화

### 품질 기준
- [ ] 단위 테스트 커버리지: parser/mapper/detector 80% 이상
- [ ] 실제 DART 공시 샘플 10건 파싱 통과 (5종 × 2건)
- [ ] 단건 파싱 p95 < 3초 (로컬 환경 기준)
- [ ] `DisclosureDocument` 모델 Prisma migration 파일 커밋 및 `docs/database-schema.md` 업데이트

### Phase 3 진입 조건
- `parsedJson` 출력 스키마가 Phase 3 `DisclosureEvent` 입력 스펙과 합의됨
- 관심 기업 기준 최소 100건 `parseStatus = DONE` 누적
