# M1 기술 계약서 — 공시 원문 파싱·구조화

> 작성: BE 리드 · 작성일: 2026-06-02
> 이 문서는 M1 구현 에이전트가 그대로 따를 수 있는 구현 계약이다.
> 상위 문서: [실행 로드맵](../../roadmap/01-execution-roadmap.md) · [BE 역할](../../roadmap/roles/be.md) · [Phase 02 상세 설계](../../roadmap/phase-02-document-parsing.md)

---

## 0. 전제 조건 및 핵심 원칙

### 진입 전제
- M0 수집 안정화 완료: `DisclosureCollectionLog.status = 'SUCCESS'` 수집 성공률 ≥ 95%
- `Disclosure.rcpNo` (PK) 및 `Disclosure.rmk` 데이터 적재 확인
- `Disclosure.corpCode` → `Company.corpCode` FK 정합 확인

### 불변 원칙 (위반 시 구현 에이전트는 즉시 중단하고 계약 검토 요청)
1. **AI 호출 금지**: M1 범위에서 LLM/AI API 호출 없음. Rule 기반 파서만 사용.
2. **공시 전문 미적재 원칙**: `rawText`는 태그 제거 후 순수 텍스트만 저장. AI 입력용 압축을 목표로 한다.
3. **신규 의존성 추가 금지**: 기존 `adm-zip`, `fast-xml-parser`, `axios`/`axios-retry`로만 해결. cheerio 없음 → 태그 제거는 정규식으로 구현.
4. **오프라인 픽스처 기반 개발·테스트**: DART API 키 미보유 상태. 라이브 호출 대신 `__fixtures__/` 합성 XML/HTML로 개발·단위테스트.

---

## 1. DisclosureDocument — Prisma 모델 계약

### 1-1. 추가 위치

`backend/prisma/schema.prisma`의 `DisclosureCollectionLog` 모델 블록 이후에 추가한다.

### 1-2. enum 정의

```prisma
// ====================================
// 공시 원문 파싱 상태 enum (M1 신규)
// ====================================

enum ParseStatus {
  PENDING       // 파싱 미처리 (수집 완료 직후 자동 생성)
  FETCHING      // DART 원문 다운로드 진행 중
  FETCH_FAILED  // 다운로드 실패 (retryCount 증가, 재처리 큐 대상)
  PARSING       // 텍스트·표 파싱 진행 중
  PARSE_FAILED  // 파싱 실패 (retryCount 증가, 재처리 큐 대상)
  DONE          // 파싱 완료 (rawText + parsedJson 저장됨)
  SKIPPED       // MAX_RETRY 초과 또는 단순 공시(파싱 불필요) 판정
}
```

### 1-3. DisclosureDocument 모델

```prisma
// ====================================
// 공시 원문 파싱 결과 (M1 신규)
// ====================================

model DisclosureDocument {
  // 자연키 PK — Disclosure.rcpNo와 1:1 매핑
  rcpNo        String   @id

  // 역정규화: 조회 성능을 위해 corpCode 중복 저장
  corpCode     String

  // 원문 파일 저장 위치
  // 개발: backend/storage/{rcpNo}/index.html (gitignored)
  // 프로덕션: S3 key = dart-documents/{rcpNo}/index.html (후속 M)
  rawFilePath  String?

  // 첨부 ZIP 내 추출 파일 경로 목록 (없으면 빈 배열)
  attachmentPaths String[]

  // 파싱 결과
  rawText      String?  @db.Text  // 태그 제거 후 순수 텍스트 (200KB 상한 truncate)
  tables       Json?              // 추출된 표 목록: Table[] (하단 JSON 스키마 참고)
  parsedJson   Json?              // 핵심 key-value 구조화 결과 (하단 parsedJson 스키마 참고)
  wordCount    Int?               // rawText 글자 수 (AI 입력 비용 예측, M3/M4 비용 게이트용)

  // 정정공시 관계
  isAmendment    Boolean  @default(false)  // Disclosure.rmk 기반 정정 여부
  originalRcpNo  String?                  // 원공시 rcpNo — 자기참조 (정정 시에만)
  amendmentDiff  Json?                    // 정정 전후 변경 필드 diff (FieldDiff[] 구조)

  // 상태 관리
  parseStatus  ParseStatus  @default(PENDING)
  fetchedAt    DateTime?    // DART 원문 다운로드 완료 시각
  parsedAt     DateTime?    // rawText/tables/parsedJson 저장 완료 시각
  retryCount   Int          @default(0)   // 실패 재처리 누적 횟수 (MAX = 3)
  lastError    String?      // 마지막 실패 오류 메시지 (500자 상한 truncate)

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // Relations
  disclosure   Disclosure  @relation(fields: [rcpNo], references: [rcpNo], onDelete: Cascade)
  company      Company     @relation(fields: [corpCode], references: [corpCode])

  // 인덱스 — 배치 처리·상태 조회·정정공시 연결 성능
  @@index([corpCode])
  @@index([parseStatus])
  @@index([isAmendment])
  @@index([originalRcpNo])
  @@index([fetchedAt])
  @@map("disclosure_documents")
}
```

### 1-4. 기존 모델 역방향 relation 추가

`Disclosure` 모델 Relations 블록에 아래 1줄 추가:

```prisma
  document             DisclosureDocument?
```

`Company` 모델 Relations 블록에 아래 1줄 추가:

```prisma
  disclosureDocuments  DisclosureDocument[]
```

### 1-5. 필드 상세 규칙

| 필드 | 규칙 |
|------|------|
| `rcpNo` | `@id` (자연키 PK). `@unique` 중복 선언 불필요. |
| `corpCode` | `Disclosure.corpCode`에서 복사 (upsert 시 조회). FK 정합 필수. |
| `rawFilePath` | 개발: `backend/storage/{rcpNo}/index.html`. 로컬 파일 없으면 null 허용. |
| `attachmentPaths` | 첨부 ZIP 없으면 `[]` (빈 배열). |
| `rawText` | 200,000자(약 200KB) 초과 시 truncate 후 저장. 원본은 `rawFilePath`에서만 접근. |
| `wordCount` | `rawText.length` (truncate 전 원본 길이 기준). |
| `originalRcpNo` | 항상 **최초** 원공시 `rcpNo`를 가리켜야 함 (정정의 정정인 경우도 최초 원공시). |
| `retryCount` | `MAX_RETRY = 3` 초과 시 `parseStatus = SKIPPED`로 전환하고 더 이상 재처리 안 함. |
| `lastError` | 500자 초과 시 truncate. |

### 1-6. tables JSON 스키마

```typescript
// backend/src/disclosure-documents/types/table.type.ts
export interface Table {
  tableIndex: number;      // 문서 내 표 순서 (0-based)
  headers: string[];       // 헤더 행 텍스트 배열 (없으면 빈 배열)
  rows: string[][];        // 데이터 행 배열 (각 행은 셀 텍스트 배열)
  caption?: string;        // <caption> 또는 앞 단락 제목 (선택)
}
```

예시:
```json
[
  {
    "tableIndex": 0,
    "caption": "계약 내역",
    "headers": ["항목", "금액(원)", "비고"],
    "rows": [
      ["계약금액", "120000000000", "부가세 포함"],
      ["최근 매출액", "500000000000", "2025년 연간"]
    ]
  }
]
```

### 1-7. parsedJson 스키마 (Phase 3 입력 중간 산출물)

```typescript
// backend/src/disclosure-documents/types/parsed-json.type.ts
export interface ParsedJson {
  docType: string;           // 투자이벤트 타입 (InvestmentEventType 값)
  rawTableCount: number;     // 추출된 전체 표 개수
  keyValueSource: string;    // 어느 표(tableIndex)에서 key-value 추출했는지 (예: "table_0")
  // 이하 공시 유형별 필드 (없으면 필드 자체 미포함, undefined 대신 미기재)

  // 단일판매·공급계약 (SUPPLY_CONTRACT)
  contractAmount?: number;   // 계약금액 (원)
  recentSales?: number;      // 최근 매출액 (원)
  salesRatio?: number;       // 계약금액/매출액 비율 (소수점 4자리)
  counterparty?: string;     // 거래상대방
  contractStartDate?: string; // YYYY-MM-DD
  contractEndDate?: string;   // YYYY-MM-DD

  // 자기주식 취득·소각 (SHARE_BUYBACK / SHARE_CANCELLATION)
  acquisitionShares?: number; // 취득 주식 수
  acquisitionAmount?: number; // 취득 금액 (원)
  acquisitionMethod?: string; // 취득 방법 (장내매수, 공개매수 등)
  acquisitionStartDate?: string;
  acquisitionEndDate?: string;

  // 현금·현물배당 (DIVIDEND)
  dividendTotal?: number;     // 배당금 총액 (원)
  dividendPerShare?: number;  // 주당 배당금 (원)
  dividendRecordDate?: string; // 배당기준일 YYYY-MM-DD
  dividendYield?: number;     // 배당수익률 (소수점 4자리)

  // 유상증자 (PAID_IN_CAPITAL_INCREASE)
  newShares?: number;         // 신규 발행 주식 수
  fundingAmount?: number;     // 조달 금액 (원)
  issueMethod?: string;       // 발행 방법 (주주배정, 제3자배정, 일반공모)
  discountRate?: number;      // 할인율 (소수점 4자리)
  existingShares?: number;    // 기존 발행 주식 수
  dilutionRate?: number;      // 희석률 = newShares / (newShares + existingShares)

  // 전환사채·신주인수권부사채 (CB_BW_ISSUANCE)
  issuanceAmount?: number;    // 발행 금액 (원)
  conversionPrice?: number;   // 전환가액 (원/주)
  interestRate?: number;      // 이자율 (소수점 4자리)
  maturityDate?: string;      // 만기일 YYYY-MM-DD
  bondType?: string;          // 'CB' | 'BW' | 'EB'
}
```

### 1-8. amendmentDiff JSON 스키마

```typescript
// backend/src/disclosure-documents/types/amendment-diff.type.ts
export type ChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED';

export interface FieldDiff {
  field: string;
  before: unknown;        // 원공시 값 (null이면 원공시에 해당 필드 없음)
  after: unknown;         // 정정공시 값
  changeType: ChangeType;
  changePct?: number;     // 숫자 필드만: (after - before) / before (소수점 4자리)
}

export interface AmendmentDiff {
  originalRcpNo: string;
  amendmentRcpNo: string;
  changedFields: FieldDiff[];
  summary: string;        // 예: "계약금액 1,000억 → 1,200억 (+20.0%)"
}
```

diff 계산 규칙:
- `parsedJson` 최상위 키만 비교 (1-depth flat diff)
- 숫자 필드: `changePct = (after - before) / Math.abs(before)` (before = 0이면 `changePct` 미포함)
- `rawText` diff 저장 안 함 (용량 과다) — 필요 시 on-demand 계산
- 원공시가 미파싱(parsedJson 없음) 상태면 `amendmentDiff = null`로 저장, 향후 재계산

---

## 2. 모듈 구조 계약

### 2-1. 디렉토리 레이아웃

```
backend/src/
  disclosure-documents/
    disclosure-documents.module.ts          // 모듈 정의, DartApiModule import
    disclosure-documents.service.ts         // 파이프라인 오케스트레이터
    disclosure-documents.controller.ts      // 관리자 엔드포인트
    parsers/
      html-cleaner.ts                       // HTML → rawText (정규식 기반 태그 제거)
      xml.parser.ts                         // document.xml SECTION 블록 파싱
      table.parser.ts                       // <table> → Table[] 추출
    mappers/
      key-value.mapper.ts                   // 공시유형별 Table[] → ParsedJson 변환
      amendment.detector.ts                 // rmk 필드 → isAmendment, originalRcpNo 추출
      amendment.differ.ts                   // parsedJson 두 버전 → AmendmentDiff 계산
    dto/
      parse-result.dto.ts                   // GET /document-parsing/:rcpNo 응답 DTO
      batch-result.dto.ts                   // POST /document-parsing/batch 응답 DTO
      stats.dto.ts                          // GET /document-parsing/stats 응답 DTO
    types/
      table.type.ts                         // Table 인터페이스
      parsed-json.type.ts                   // ParsedJson 인터페이스
      amendment-diff.type.ts                // AmendmentDiff, FieldDiff 인터페이스
    __fixtures__/
      supply-contract.xml                   // 단일판매공급계약 합성 픽스처
      supply-contract-amendment.xml         // 위 공시의 정정 픽스처
      share-buyback.xml                     // 자기주식취득 픽스처
      dividend.xml                          // 현금배당 픽스처
      paid-in-capital.xml                   // 유상증자 픽스처
      cb-issuance.xml                       // 전환사채 픽스처

backend/storage/                            // 개발용 로컬 원문 저장소
  .gitignore                                // * (전체 gitignore)
```

### 2-2. 모듈 의존성 규칙

- `DisclosureDocumentsModule`은 `PrismaModule`(@Global이므로 import 불필요)과 `DartApiModule`을 import한다.
- `DisclosureDocumentsModule`은 `SchedulerModule`에 export하여 수집 완료 후 파싱 트리거 연결에 사용된다.
- AI 관련 모듈(`AiAnalystModule` 등)에 대한 의존성 없음 — M1 범위에서 AI 호출 금지.

### 2-3. 스케줄러 연결점

`SchedulerService.collectByDate()` 내 신규 공시 저장 완료 직후, 저장된 `rcpNo` 목록을 `DisclosureDocumentsService.enqueueParsing(rcpNos: string[])` 으로 전달한다.

`enqueueParsing`은 `DisclosureDocument` 레코드를 `PENDING` 상태로 `upsert`한다 (이미 `DONE`이면 skip).

M1에서는 BullMQ 대신 **동기 처리 또는 즉시 비동기(`setImmediate`)** 로 구현한다. BullMQ 큐(`disclosure-parse`)는 M2 이후 도입 — M1에서는 단순 서비스 메서드 직접 호출로 충분.

---

## 3. DartApiService 확장 계약

기존 `backend/src/dart-api/dart-api.service.ts`에 아래 메서드를 추가한다. **기존 메서드 변경 금지**.

### 3-1. downloadDocument(rcpNo): Promise<Buffer>

```typescript
/**
 * DART document.xml API로 원문 ZIP 다운로드
 * URL: GET https://opendart.fss.or.kr/api/document.xml?crtfc_key=KEY&rcept_no=RCPNO
 * 응답: application/zip (binary)
 *
 * API 키 미설정(DART_API_KEY 빈 값) 또는 오프라인 환경에서는
 * DartApiUnavailableError를 throw한다 — 호출부에서 catch해 FETCH_FAILED 처리.
 */
async downloadDocument(rcpNo: string): Promise<Buffer>
```

구현 요구사항:
- `responseType: 'arraybuffer'` 로 axios GET 요청
- 응답 상태 200이 아니거나 Content-Type이 `application/zip`이 아니면 throw
- `this.apiKey`가 빈 문자열이면 `DartApiUnavailableError('DART_API_KEY가 설정되지 않았습니다')` throw (class 직접 정의)
- axios-retry 이미 설정됨 — 추가 retry 설정 불필요

### 3-2. extractDocumentFromZip(zipBuffer: Buffer): Promise<{ html?: string; xml?: string }>

```typescript
/**
 * ZIP Buffer에서 본문 HTML/XML 파일을 추출한다.
 * adm-zip 사용 (신규 의존성 추가 금지).
 *
 * 추출 우선순위:
 *   1. *.html / *.htm — 뷰어 HTML (rawText 추출 주 소스)
 *   2. DART 문서 폴더 구조: 첫 번째 .html 파일 우선
 *   3. document.xml 또는 첫 번째 .xml 파일 — XML 파싱 보조
 *
 * ZIP 내 파일이 없거나 html/xml 모두 없으면 빈 객체({}) 반환.
 */
async extractDocumentFromZip(zipBuffer: Buffer): Promise<{ html?: string; xml?: string }>
```

구현 요구사항:
- `new AdmZip(zipBuffer)` 로 ZIP 파싱 (`adm-zip` import)
- 파일명 소문자 변환 후 `.html`, `.htm` 우선 추출
- XML은 `document.xml` 우선, 없으면 첫 번째 `.xml` 파일
- 인코딩: `entry.getData().toString('utf-8')` (EUC-KR 공시는 별도 처리 불필요 — DART 최신 문서는 UTF-8)

### 3-3. 오프라인 처리 규칙

`DART_API_KEY` 미설정 상태(개발 환경)에서:
- `downloadDocument` 호출 시 `DartApiUnavailableError` throw
- 호출부(`DisclosureDocumentsService.parseDisclosure`)에서 catch해 `parseStatus = FETCH_FAILED`, `lastError = 'DART_API_KEY 미설정'` 저장 후 return
- **단위테스트에서는 `downloadDocument`를 mock**하고 `__fixtures__/` XML 파일을 Buffer로 읽어 `extractDocumentFromZip`에 직접 전달

---

## 4. 파싱 파이프라인 계약

### 4-1. 파서 함수 시그니처

#### html-cleaner.ts

```typescript
/**
 * HTML 문자열에서 순수 텍스트를 추출한다.
 * 의존성: 정규식만 사용 (cheerio 없음)
 *
 * 제거 대상 태그: <script>, <style>, <nav>, <header>, <footer>,
 *                <head>, HTML 주석 <!-- -->
 * 정규화:
 *   - &nbsp; → ' '
 *   - &amp; → '&', &lt; → '<', &gt; → '>'
 *   - 연속 공백 → 단일 공백
 *   - 연속 개행 2개 초과 → 2개로 압축
 *   - 앞뒤 공백 trim
 *
 * @returns 정규화된 순수 텍스트 (200,000자 상한 truncate 전 원본 반환 — truncate는 서비스 레이어에서)
 */
export function cleanHtml(html: string): string
```

#### xml.parser.ts

```typescript
/**
 * DART document.xml 파싱 (fast-xml-parser 사용)
 * document.xml 구조: <ROOT><SECTION-1>...</SECTION-1>...</ROOT>
 *
 * 반환값: 각 SECTION의 텍스트 내용 배열
 * SECTION 태그명 패턴: SECTION-\d+ (예: SECTION-1, SECTION-2)
 */
export function parseXmlSections(xml: string): string[]
```

#### table.parser.ts

```typescript
/**
 * HTML에서 <table> 요소를 파싱해 Table[] 반환.
 * 의존성: 정규식만 사용 (cheerio 없음)
 *
 * 헤더 감지 규칙:
 *   1. <thead> 내부 <th>/<td> → 헤더
 *   2. <thead>가 없으면 첫 번째 <tr>의 <th> 셀 → 헤더
 *   3. 헤더 감지 불가 시 headers = []
 *
 * caption 감지: <caption> 태그 내용 (없으면 undefined)
 *
 * 빈 테이블(<table>이 있으나 데이터 행 0개)은 결과에서 제외.
 */
export function parseTables(html: string): Table[]
```

#### key-value.mapper.ts

```typescript
/**
 * 공시 유형별 Table[] → ParsedJson key-value 변환
 *
 * @param tables    table.parser.ts 추출 결과
 * @param eventType classifyInvestmentEventType() 반환값 (InvestmentEventType)
 * @returns ParsedJson (매핑 실패 시 { docType, rawTableCount: N, keyValueSource: 'none' })
 *
 * 구현 원칙:
 *   - 셀 텍스트 → 숫자 변환: 콤마 제거 후 parseFloat (실패 시 undefined)
 *   - 날짜 변환: YYYY.MM.DD / YYYY년MM월DD일 → YYYY-MM-DD
 *   - 정규식 패턴은 공시 유형별 상수 파일에 분리 (하드코딩 금지)
 *   - 매핑 가능한 첫 번째 표를 사용, keyValueSource에 "table_N" 기록
 */
export function mapKeyValues(tables: Table[], eventType: InvestmentEventType): ParsedJson
```

#### amendment.detector.ts

```typescript
/**
 * Disclosure.rmk 필드를 분석해 정정공시 여부와 원공시 rcpNo를 반환한다.
 *
 * DART rmk 패턴:
 *   - "[기재정정]", "[첨부정정]", "[자진정정]", "[정정]"
 *   - 원공시 rcpNo가 rmk에 포함되는 경우: "20250101XXXXXXX"  (14자리 숫자)
 *
 * extractOriginalRcpNo: rmk 내 14자리 숫자 문자열 추출.
 * 추출 불가 시 null 반환 — 서비스 레이어에서 DB 조회로 보완 시도.
 */
export function isAmendment(rmk: string): boolean
export function extractOriginalRcpNo(rmk: string): string | null
```

#### amendment.differ.ts

```typescript
/**
 * 원공시 parsedJson vs 정정공시 parsedJson → AmendmentDiff 계산
 *
 * @param originalJson  원공시 parsedJson (null이면 diff 계산 불가 → null 반환)
 * @param amendmentJson 정정공시 parsedJson
 * @param originalRcpNo 원공시 rcpNo (diff 메타)
 * @param amendmentRcpNo 정정공시 rcpNo
 *
 * 계산 규칙:
 *   - 최상위 키만 비교 (1-depth)
 *   - 원공시에만 있는 키: REMOVED
 *   - 정정공시에만 있는 키: ADDED
 *   - 값이 다른 키: MODIFIED
 *   - 숫자 필드: changePct 계산
 *   - summary: 변경된 숫자 필드 중 첫 번째를 "필드명 전→후 (+N%)" 형식으로 생성
 */
export function computeAmendmentDiff(
  originalJson: ParsedJson | null,
  amendmentJson: ParsedJson,
  originalRcpNo: string,
  amendmentRcpNo: string,
): AmendmentDiff | null
```

### 4-2. DisclosureDocumentsService 시그니처

```typescript
// backend/src/disclosure-documents/disclosure-documents.service.ts

@Injectable()
export class DisclosureDocumentsService {
  private readonly MAX_RETRY = 3;
  private readonly MAX_RAWTEXT_LENGTH = 200_000; // 200KB 상한

  /**
   * 단건 파싱 파이프라인 (스케줄러 자동 트리거 또는 수동 트리거)
   *
   * 상태 전이: PENDING → FETCHING → PARSING → DONE
   *            실패 시: → FETCH_FAILED 또는 PARSE_FAILED
   *            MAX_RETRY 초과: → SKIPPED
   *
   * @throws 절대 throw하지 않음 — 모든 오류를 파싱 상태로 기록 후 return
   */
  async parseDisclosure(rcpNo: string): Promise<DisclosureDocument>

  /**
   * PENDING 상태 건 배치 처리
   * 동시 처리 최대 5건 (Promise.allSettled 사용)
   * 기본 limit: 50
   */
  async processPendingBatch(limit?: number): Promise<{ success: number; failed: number; durationMs: number }>

  /**
   * 수집 완료 후 파싱 큐 등록
   * - DONE 상태인 rcpNo는 skip
   * - corpCode를 Disclosure 테이블에서 조회해 함께 upsert
   * - enqueueParsing 완료 즉시 return (파싱은 비동기 처리)
   */
  async enqueueParsing(rcpNos: string[]): Promise<void>

  /**
   * 재처리 대상 조회
   * parseStatus IN [FETCH_FAILED, PARSE_FAILED] AND retryCount < MAX_RETRY
   */
  async getRetryQueue(limit?: number): Promise<DisclosureDocument[]>

  /**
   * 재처리 큐 강제 실행 (컨트롤러에서 호출)
   */
  async runRetryQueue(limit?: number): Promise<{ queued: number }>

  /**
   * 파싱 상태 현황 집계
   */
  async getStats(): Promise<Record<ParseStatus, number>>

  /**
   * 정정공시 감지 및 diff 연결 (parseDisclosure 내부에서 호출)
   * - isAmendment = true인 경우만 실행
   * - 원공시 parsedJson 없으면 amendmentDiff = null 저장
   */
  private async detectAndLinkAmendment(doc: DisclosureDocument): Promise<void>
}
```

### 4-3. 파이프라인 의사코드 (구현 에이전트 참고)

```
async parseDisclosure(rcpNo):
  // 0. 재처리 여부 확인
  doc = await prisma.disclosureDocument.upsert({
    where: { rcpNo },
    create: { rcpNo, corpCode: disclosure.corpCode, parseStatus: FETCHING },
    update: { parseStatus: FETCHING }
  })
  if doc.parseStatus === DONE: return doc  // 이미 완료
  if doc.retryCount >= MAX_RETRY:
    await prisma.disclosureDocument.update({ parseStatus: SKIPPED })
    return doc

  // 1. 원문 다운로드
  try:
    zipBuffer = await dartApiService.downloadDocument(rcpNo)
    { html, xml } = await dartApiService.extractDocumentFromZip(zipBuffer)

    // 로컬 파일 저장 (개발 환경, 프로덕션은 S3 후속 M에서)
    if STORAGE_DRIVER === 'local':
      rawFilePath = saveLocalFile(rcpNo, html ?? xml)
      doc.rawFilePath = rawFilePath

    doc.fetchedAt = new Date()
  catch DartApiUnavailableError:
    // API 키 미설정 → FETCH_FAILED, 재처리 큐
    update doc: { parseStatus: FETCH_FAILED, lastError: e.message, retryCount: +1 }
    return doc
  catch error:
    update doc: { parseStatus: FETCH_FAILED, lastError: truncate(e.message, 500), retryCount: +1 }
    return doc

  // 2. 텍스트 추출 (HTML 우선, 없으면 XML sections)
  update doc: { parseStatus: PARSING }
  try:
    rawText = html ? cleanHtml(html) : parseXmlSections(xml).join('\n')
    doc.wordCount = rawText.length
    doc.rawText = rawText.slice(0, MAX_RAWTEXT_LENGTH)  // 200KB 상한

    // 3. 표 추출
    doc.tables = html ? parseTables(html) : []

    // 4. 투자이벤트 1차 게이트 + key-value 매핑
    disclosure = await prisma.disclosure.findUnique({ where: { rcpNo } })
    eventType = classifyInvestmentEventType(disclosure.reportName)
    doc.parsedJson = mapKeyValues(doc.tables, eventType)

    // 5. 정정공시 판별 및 diff 연결
    await this.detectAndLinkAmendment(doc)  // doc 직접 수정

    // 6. 완료
    doc.parseStatus = DONE
    doc.parsedAt = new Date()
    await prisma.disclosureDocument.update(doc fields)
    return doc

  catch error:
    update doc: { parseStatus: PARSE_FAILED, lastError: truncate(e.message, 500), retryCount: +1 }
    return doc
```

---

## 5. 엔드포인트 계약

### 5-1. 컨트롤러 — `DisclosureDocumentsController`

파일: `backend/src/disclosure-documents/disclosure-documents.controller.ts`

라우트 prefix: `/document-parsing`

**가드**: 모든 엔드포인트에 `@UseGuards(JwtAuthGuard)` 적용. 이미 구현된 JWT 가드를 재사용한다.

**Swagger**: `@ApiTags('document-parsing')`, `@ApiBearerAuth()` 클래스 레벨 적용. 각 엔드포인트에 `@ApiOperation({ summary: '...' })` 추가.

### 5-2. 엔드포인트 목록

#### POST /document-parsing/parse/:rcpNo

```typescript
@Post('parse/:rcpNo')
@ApiOperation({ summary: '단건 공시 원문 파싱 (수동 트리거)' })
// 응답
{ rcpNo: string, parseStatus: ParseStatus, parsedAt: Date | null }
```

- `rcpNo`에 해당하는 `Disclosure`가 없으면 404
- `parseStatus === DONE`이면 재파싱 없이 현재 상태 반환 (멱등)
- `parseDisclosure(rcpNo)` 호출 후 결과 반환

#### POST /document-parsing/batch

```typescript
@Post('batch')
@ApiOperation({ summary: 'PENDING 상태 배치 파싱' })
// Query: ?limit=50 (기본값 50, 최대 200)
// 응답
{ success: number, failed: number, durationMs: number }
```

#### GET /document-parsing/stats

```typescript
@Get('stats')
@ApiOperation({ summary: '파싱 상태 현황 집계' })
// 응답 (ParseStatus별 건수)
{
  PENDING: number,
  FETCHING: number,
  FETCH_FAILED: number,
  PARSING: number,
  PARSE_FAILED: number,
  DONE: number,
  SKIPPED: number
}
```

**주의**: GET /document-parsing/stats 라우트를 GET /document-parsing/:rcpNo 보다 **앞에** 선언해야 한다. NestJS 라우팅 우선순위 때문에 `:rcpNo`가 `stats`를 먼저 캡처하는 충돌 방지.

#### GET /document-parsing/:rcpNo

```typescript
@Get(':rcpNo')
@ApiOperation({ summary: '파싱 결과 조회' })
// 응답: ParseResultDto (rawText 제외, parsedJson + tables + 상태 포함)
```

`DisclosureDocument`가 없으면 404.

응답 DTO (`ParseResultDto`):

```typescript
export class ParseResultDto {
  rcpNo: string;
  corpCode: string;
  parseStatus: ParseStatus;
  wordCount: number | null;
  isAmendment: boolean;
  originalRcpNo: string | null;
  tables: Table[] | null;
  parsedJson: ParsedJson | null;
  amendmentDiff: AmendmentDiff | null;
  rawFilePath: string | null;
  fetchedAt: Date | null;
  parsedAt: Date | null;
  retryCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  // rawText 필드 의도적 제외 — 응답 크기 제어
}
```

#### POST /document-parsing/retry

```typescript
@Post('retry')
@ApiOperation({ summary: '재처리 큐 강제 실행' })
// Query: ?limit=20 (기본값 20)
// 응답
{ queued: number }
```

`getRetryQueue(limit)` 대상 건에 대해 `parseDisclosure`를 순차 실행. 응답에는 실행 시작 건수만 포함 (완료 여부 불포함).

---

## 6. 스토리지 전략 계약

### 6-1. 개발 환경 (기본)

| 항목 | 내용 |
|------|------|
| 저장 경로 | `backend/storage/{rcpNo}/index.html` |
| 환경 변수 | `STORAGE_DRIVER=local` (미설정 시 기본값 `local`) |
| gitignore | `backend/storage/` 전체 gitignore (`.gitignore` 추가) |
| rawText 우선 | rawText는 항상 DB에 저장 (파일 유실 시 재파싱 없이 접근 가능) |

### 6-2. 프로덕션 환경 (후속 M에서 구현)

| 항목 | 내용 |
|------|------|
| 저장 위치 | S3 버킷 (환경 변수 `S3_BUCKET_NAME`) |
| S3 key 규칙 | `dart-documents/{rcpNo}/index.html` |
| 전환 방법 | `STORAGE_DRIVER=s3` 환경 변수 전환, `StorageService` 추상화 인터페이스 구현 (M1에서 인터페이스만 정의, 구현체는 local만) |

### 6-3. StorageService 인터페이스 (M1에서 인터페이스 정의, LocalStorageService 구현)

```typescript
// backend/src/disclosure-documents/storage/storage.service.ts
export abstract class StorageService {
  abstract save(rcpNo: string, filename: string, content: string): Promise<string>  // returns path/key
  abstract read(path: string): Promise<string>
  abstract exists(path: string): Promise<boolean>
}
```

M1에서는 `LocalStorageService extends StorageService` 만 구현. 의존성 주입은 `STORAGE_DRIVER`에 따라 분기.

---

## 7. 오프라인 픽스처 전략 계약

### 7-1. 픽스처 위치

`backend/src/disclosure-documents/__fixtures__/`

### 7-2. 필수 픽스처 파일 (최소 5종 × 2 = 10개 — 공시원문 + 정정공시)

| 파일명 | 공시 유형 | 내용 |
|--------|----------|------|
| `supply-contract.xml` | SUPPLY_CONTRACT | 계약금액 1,200억, 최근매출 5,000억, 거래상대방, 계약기간 포함 |
| `supply-contract-amendment.xml` | SUPPLY_CONTRACT 정정 | 계약금액 1,500억으로 수정, rmk에 "[기재정정]" 포함 |
| `share-buyback.xml` | SHARE_BUYBACK | 취득주식수, 취득금액, 취득방법, 기간 포함 |
| `dividend.xml` | DIVIDEND | 배당총액, 주당배당금, 배당기준일 포함 |
| `paid-in-capital.xml` | PAID_IN_CAPITAL_INCREASE | 발행주식수, 조달금액, 발행방법, 할인율, 기존주식수 포함 |
| `cb-issuance.xml` | CB_BW_ISSUANCE | 발행금액, 전환가액, 이자율, 만기일 포함 |

### 7-3. 픽스처 XML 구조 (DART document.xml 모사)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <SECTION-1>
    <TITLE>공시 제목</TITLE>
    <BODY>
      <TABLE>
        <TR><TH>항목</TH><TH>내용</TH></TR>
        <TR><TD>계약금액</TD><TD>120,000,000,000원</TD></TR>
      </TABLE>
    </BODY>
  </SECTION-1>
</ROOT>
```

### 7-4. 단위테스트 커버리지 요건

다음 파일에 대해 `*.spec.ts` 단위테스트 필수 작성:

| 테스트 파일 | 검증 내용 |
|-------------|----------|
| `html-cleaner.spec.ts` | script/style/nav 제거, &nbsp; 정규화, 연속 공백 압축 |
| `table.parser.spec.ts` | thead 헤더 감지, th 헤더 감지, 빈 테이블 제외, caption 추출 |
| `xml.parser.spec.ts` | SECTION 블록 추출, 여러 SECTION 처리 |
| `key-value.mapper.spec.ts` | 5종 공시 각 픽스처로 parsedJson 정확도 검증 |
| `amendment.detector.spec.ts` | "[기재정정]", "[첨부정정]", "[자진정정]" rmk 패턴 전수, originalRcpNo 추출 |
| `amendment.differ.spec.ts` | MODIFIED/ADDED/REMOVED, changePct 계산, summary 생성 |

테스트에서 `DartApiService.downloadDocument`는 mock 처리 — 픽스처 파일을 `fs.readFileSync`로 직접 읽어 Buffer로 제공.

---

## 8. M0 회귀 체크 계약 (M1 완료 기준)

M1 구현 완료 후 아래 항목을 **필수 확인**한다:

### 8-1. 수집→파싱 큐 연결 정합

- `SchedulerService.collectByDate()` 완료 후 새로 저장된 `rcpNo` 목록이 `DisclosureDocumentsService.enqueueParsing(rcpNos)`로 전달되는지 확인
- `enqueueParsing` 호출 후 `DisclosureDocument` 레코드가 `PENDING` 상태로 생성되는지 확인
- 기존 `DONE` 상태 레코드는 `PENDING`으로 되돌아가지 않는지 확인

### 8-2. CollectionLog ↔ DisclosureDocument 건수 정합

```sql
-- 정합 확인 쿼리 (개발자가 직접 실행)
SELECT
  (SELECT COUNT(*) FROM disclosures WHERE created_at > NOW() - INTERVAL '1 day') AS total_disclosures,
  (SELECT COUNT(*) FROM disclosure_documents) AS total_documents,
  (SELECT COUNT(*) FROM disclosure_documents WHERE parse_status = 'DONE') AS done_count,
  (SELECT COUNT(*) FROM disclosure_documents WHERE parse_status IN ('FETCH_FAILED','PARSE_FAILED')) AS failed_count;
```

- 기대: `total_documents >= total_disclosures` (수집 후 파싱 레코드 누락 없음)
- 허용 오차: `SKIPPED` 건수만큼 차이 가능

### 8-3. 기존 기능 회귀 확인

- 카카오 로그인, 관심목록, 알림 발송 기능이 새 마이그레이션 후에도 정상 동작하는지 확인
- `Disclosure` 모델에 `document DisclosureDocument?` relation 추가 후 기존 쿼리 영향 없는지 확인

### 8-4. 재처리 스케줄러 동작 확인

- `parse-retry.scheduler.ts` Cron (`@Cron('*/30 * * * *')`) 등록 확인
- `FETCH_FAILED`/`PARSE_FAILED` 건이 30분 후 재처리 대상에 포함되는지 확인
- `retryCount >= MAX_RETRY(3)` 건이 `SKIPPED`로 전환되는지 확인

---

## 9. 재처리 스케줄러 계약

### 파일: `backend/src/disclosure-documents/parse-retry.scheduler.ts`

```typescript
@Injectable()
export class ParseRetryScheduler {
  private readonly MAX_RETRY_BATCH = 20; // 1회 재처리 최대 건수

  @Cron('*/30 * * * *')  // 매 30분마다
  async retryFailedDocuments(): Promise<void>
  // 내부: disclosureDocumentsService.runRetryQueue(MAX_RETRY_BATCH) 호출
  // 오류 발생 시 Logger.error 후 throw하지 않음 (Cron 스케줄 유지)
}
```

---

## 10. 환경 변수 추가 목록

`backend/.env.example` 및 실제 `.env`에 아래 항목 추가:

```
# M1 신규
STORAGE_DRIVER=local          # 'local' | 's3' (현재 local만 지원)
LOCAL_STORAGE_PATH=./storage  # STORAGE_DRIVER=local일 때 저장 루트 (상대 경로)
```

---

## 11. 완료 기준 체크리스트

구현 에이전트는 아래 항목을 모두 충족해야 M1 완료로 간주한다:

### DB/스키마
- [ ] `ParseStatus` enum 정의 추가 (`schema.prisma`)
- [ ] `DisclosureDocument` 모델 추가 (`schema.prisma`)
- [ ] `Disclosure` 모델에 `document DisclosureDocument?` relation 추가
- [ ] `Company` 모델에 `disclosureDocuments DisclosureDocument[]` relation 추가
- [ ] `npx prisma migrate dev --name add-disclosure-document` 실행 (오케스트레이터 담당)

### 코드 구조
- [ ] `backend/src/disclosure-documents/` 디렉토리 구조 생성 (§2-1 레이아웃)
- [ ] `backend/storage/.gitignore` 생성 (내용: `*`)
- [ ] `__fixtures__/` 5종 픽스처 XML 파일 생성

### DartApiService 확장
- [ ] `downloadDocument(rcpNo)` 메서드 추가
- [ ] `extractDocumentFromZip(zipBuffer)` 메서드 추가
- [ ] `DartApiUnavailableError` 클래스 정의

### 파서 구현
- [ ] `html-cleaner.ts`: `cleanHtml()` 구현
- [ ] `xml.parser.ts`: `parseXmlSections()` 구현
- [ ] `table.parser.ts`: `parseTables()` 구현
- [ ] `key-value.mapper.ts`: `mapKeyValues()` 5종 구현
- [ ] `amendment.detector.ts`: `isAmendment()`, `extractOriginalRcpNo()` 구현
- [ ] `amendment.differ.ts`: `computeAmendmentDiff()` 구현

### 서비스/컨트롤러
- [ ] `DisclosureDocumentsService` 구현 (§4-2 시그니처)
- [ ] `DisclosureDocumentsController` 구현 (§5 엔드포인트)
- [ ] `ParseRetryScheduler` 구현 (§9)
- [ ] `DisclosureDocumentsModule` 등록 및 `AppModule` import

### 스케줄러 연결
- [ ] `SchedulerService.collectByDate()` 완료 후 `enqueueParsing()` 호출 추가

### 단위테스트
- [ ] 6개 파서/매퍼/검출기 spec 파일 작성 (§7-4)
- [ ] 픽스처 기반 단위테스트 그린

### 환경 변수
- [ ] `.env.example`에 M1 신규 항목 추가

### 문서 갱신
- [ ] `docs/database-schema.md` — `DisclosureDocument`, `ParseStatus` 추가
- [ ] `docs/api-specification.md` — `/document-parsing/*` 5개 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` — `disclosure-documents/` 모듈 트리 추가
- [ ] `NEXT_STEPS.md` — M1 관련 항목 완료 체크

---

## 부록 A. 키 숫자 상수 요약

| 상수명 | 값 | 용도 |
|--------|-----|------|
| `MAX_RETRY` | `3` | 파싱 실패 재처리 최대 횟수 |
| `MAX_RAWTEXT_LENGTH` | `200_000` | rawText 저장 상한 (자) |
| `MAX_LAST_ERROR_LENGTH` | `500` | lastError 저장 상한 (자) |
| `BATCH_CONCURRENCY` | `5` | processPendingBatch 동시 처리 건수 |
| `DEFAULT_BATCH_LIMIT` | `50` | processPendingBatch 기본 처리 건수 |
| `MAX_BATCH_LIMIT` | `200` | processPendingBatch 최대 처리 건수 |
| `RETRY_BATCH_LIMIT` | `20` | 재처리 스케줄러 1회 처리 건수 |
| `DART_API_RATE_LIMIT_MS` | `500` | DART API 요청 간 최소 지연 (ms) |
| `RETRY_CRON` | `'*/30 * * * *'` | 재처리 스케줄러 cron 표현식 |
