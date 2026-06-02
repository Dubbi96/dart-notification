> 상위 문서: [Phase 2 상세 설계](../../roadmap/phase-02-document-parsing.md) · 역할: 데이터·Quant(파싱 전략 기여 C)
> 최종 수정일: 2026-06-02

# M1 파싱 전략 — DART 원문 구조화 규칙 명세

> 구현 에이전트(`html.parser.ts`, `table.extractor.ts`, `key-value.mapper.ts`, `amendment.detector.ts`)가 이 문서의 규칙만 보고 파서를 만들 수 있도록 작성한다.
> AI는 이 단계에서 호출하지 않는다 — Rule/Parser만 사용.

---

## 1. DART document.xml 내부 문서 형식 특성

### 1-1. 취득 방법
```
GET https://opendart.fss.or.kr/api/document.xml?crtfc_key=KEY&rcept_no=RCPNO
→ ZIP 바이너리 응답 (Content-Type: application/zip 또는 octet-stream)
```
- ZIP 내부에는 파일 1개 이상이 존재한다.
- 대표 본문 파일 식별 규칙 (우선순위 순):
  1. 파일명이 `{rcpNo}.xml` 또는 `{rcpNo}.html` 인 파일
  2. 확장자 `.xml` 중 가장 파일 크기가 큰 파일
  3. 확장자 `.html` / `.htm` 중 가장 파일 크기가 큰 파일
  4. 위 모두 없으면 첫 번째 파일 (이름순 정렬)

### 1-2. 인코딩
- **기본 가정: EUC-KR** (DART 공시 원문 대부분이 EUC-KR로 인코딩됨)
- XML 선언에 `<?xml ... encoding="EUC-KR"?>` 또는 HTML `<meta charset="euc-kr">` 포함 시 EUC-KR로 확정
- `<?xml ... encoding="UTF-8"?>` 또는 `<meta charset="utf-8">` 선언이 있으면 UTF-8로 처리
- 선언이 없을 경우: `iconv-lite` 또는 `Buffer.toString('utf8')` 디코딩 시 깨짐 여부로 판단 — 깨지면 EUC-KR 재시도
- adm-zip에서 꺼낸 `Buffer`를 직접 `iconv-lite.decode(buffer, 'euc-kr')` 로 디코딩

### 1-3. 마크업 형식 특성
DART 공시 원문은 순수 HTML이 아닌 **SGML/HTML 혼합** 구조를 가진다.

| 특성 | 설명 |
|------|------|
| 태그 대소문자 혼재 | `<TABLE>`, `<table>`, `<Table>` 모두 등장. fast-xml-parser 파싱 시 `ignoreAttributes: false`로 설정하고 태그명을 소문자 정규화 후 처리 |
| 닫힘 태그 누락 | `<P>`, `<BR>`, `<TD>` 등이 닫힘 태그 없이 등장하는 경우 흔함. 태그 제거 시 정규식으로 처리 |
| 자체 SGML 선언 | `<!DOCTYPE SGML ...>` 또는 커스텀 DTD 선언이 포함될 수 있음. 파싱 전 이 선언 블록을 통째로 제거 |
| HTML 엔터티 | `&nbsp;`, `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#xA0;` 혼재 |
| 인라인 CSS/스타일 | `style="..."` 속성, `<FONT>`, `<SPAN>` 태그가 많음. 내용에는 영향 없으므로 태그만 제거 |
| 주석 | `<!-- ... -->` 형태의 HTML 주석 포함 |

### 1-4. 표 구조 특성
DART 공시의 표는 **표준 HTML `<table>` 태그**를 기반으로 하며, 추가로 DART 전용 태그가 혼재한다.

| 태그 | 의미 | 처리 방법 |
|------|------|----------|
| `<TABLE>` / `<table>` | 표 루트 | 표 추출 단위 |
| `<TR>` / `<tr>` | 행 | 행 구분 기준 |
| `<TH>` / `<th>` | 헤더 셀 | `isHeader: true` 마킹 |
| `<TD>` / `<td>` | 데이터 셀 | 일반 셀 |
| `<TE>` | DART 전용 표 엔트리 (일부 구형 문서) | `<TD>`와 동일하게 처리 |
| `<TU>` | DART 전용 표 유닛 (일부 구형 문서) | `<TR>`과 동일하게 처리 |
| `colspan` / `rowspan` | 병합 셀 속성 | 아래 규칙 적용 |

---

## 2. rawText 추출 규칙 (html.parser.ts)

rawText는 **순수 텍스트**로, AI 입력 최소화와 wordCount 산출에 사용된다.

### 2-1. 제거 대상 (순서대로 적용)

**규칙 R-01: SGML/DOCTYPE 선언 제거**
```
패턴: /<!DOCTYPE[^>]*>/gi
패턴: /<!SGML[^>]*>/gi
처리: 빈 문자열로 대체
```

**규칙 R-02: HTML 주석 제거**
```
패턴: /<!--[\s\S]*?-->/g
처리: 빈 문자열로 대체
주의: 중첩 주석 없음을 가정 (non-greedy 매칭으로 처리)
```

**규칙 R-03: script 블록 제거**
```
패턴: /<script[\s\S]*?<\/script>/gi
처리: 빈 문자열로 대체
```

**규칙 R-04: style 블록 제거**
```
패턴: /<style[\s\S]*?<\/style>/gi
처리: 빈 문자열로 대체
```

**규칙 R-05: XML 처리 명령 제거**
```
패턴: /<\?[\s\S]*?\?>/g
처리: 빈 문자열로 대체
```

**규칙 R-06: 모든 HTML/XML 태그 제거**
```
패턴: /<[^>]+>/g
처리: 공백 1개로 대체 (단어 붙음 방지)
```

### 2-2. HTML 엔터티 정규화

**규칙 R-07: 엔터티 → 문자 변환 (적용 순서 중요)**
```
&amp;   → &   (반드시 가장 먼저 처리)
&lt;    → <
&gt;    → >
&quot;  → "
&apos;  → '
&nbsp;  → 공백 1개 (U+0020)
&#xA0;  → 공백 1개
&#160;  → 공백 1개
&#[0-9]+; → String.fromCharCode(parseInt(match, 10)) 로 변환
&#x[0-9a-fA-F]+; → String.fromCharCode(parseInt(match, 16)) 로 변환
```

### 2-3. 공백 정리

**규칙 R-08: 공백 정규화**
```
1. \r\n 또는 \r → \n (줄바꿈 정규화)
2. 탭(\t) → 공백 1개
3. 연속 공백(2개 이상) → 공백 1개
4. 연속 빈 줄(3줄 이상) → 빈 줄 2줄로 축소
5. 앞뒤 공백 trim()
```

### 2-4. wordCount 산출

**규칙 R-09: wordCount = rawText.length**
```
글자 수(문자 수) 기준. 한국어는 띄어쓰기 기준 단어 수보다 글자 수가 적합.
rawText 200KB 상한 초과 시 200 * 1024 글자에서 truncate.
truncate 여부를 DisclosureDocument.lastError에 'TRUNCATED_AT_200KB' 로 기록.
```

---

## 3. 표(table) 추출 규칙 (table.extractor.ts)

### 3-1. 표 추출 결과 타입

```typescript
interface ExtractedTable {
  tableIndex: number;       // 문서 내 표 순서 (0-based)
  headers: string[];        // 헤더 행 텍스트 배열 (없으면 빈 배열)
  rows: string[][];         // 데이터 행×열 2차원 배열
  rawRowCount: number;      // 원본 행 수 (병합 전)
  rawColCount: number;      // 최대 열 수 (병합 전)
  hasColspan: boolean;      // colspan 사용 여부
  hasRowspan: boolean;      // rowspan 사용 여부
}
```

### 3-2. 표 탐지 규칙

**규칙 T-01: 표 탐지 패턴**
```
정규식: /<table[\s\S]*?<\/table>/gi
DART 전용: <TABLE>...</TABLE> (대소문자 무관)
중첩 표: 외부 table 하나만 추출 단위로 사용 (내부 중첩 table은 별도 tableIndex로 분리)
```

**규칙 T-02: 최소 표 조건 (이 조건을 충족하지 않으면 표 목록에서 제외)**
```
- 행 수 >= 1
- 열 수 >= 1
- 모든 셀이 빈 문자열이면 제외 (레이아웃용 표로 간주)
```

### 3-3. 헤더 행 자동 감지

**규칙 T-03: 헤더 행 판정 (우선순위 순)**
```
1. <TH> 태그를 포함한 행 → 해당 행을 headers로 사용
2. <TH> 없이 첫 번째 행이 다음 조건 중 하나를 만족하면 headers로 사용:
   a. 행의 모든 셀 텍스트 길이가 20자 이하
   b. 행의 모든 셀이 숫자를 포함하지 않음
   c. 셀 배경색 속성(bgcolor, style="background") 이 존재함
3. 위 조건 불만족 → headers = [] (빈 배열), 첫 행도 rows에 포함
```

### 3-4. 병합 셀 처리

**규칙 T-04: colspan 처리**
```
<td colspan="N"> 또는 <TD COLSPAN="N">
→ 해당 셀 텍스트를 N개의 열에 복제하지 않고, 해당 셀만 1개로 저장
→ 대신 hasColspan: true 플래그 기록
→ 구현 에이전트는 이 플래그를 보고 key-value 매핑 시 주의 처리 가능
```

**규칙 T-05: rowspan 처리**
```
<td rowspan="N"> 또는 <TD ROWSPAN="N">
→ 해당 셀 텍스트를 아래 N-1행의 해당 열 위치에 빈 문자열("")로 채움
→ 빈 문자열 셀 위치는 위 행의 rowspan 셀 값으로 논리적 복원 필요 시 hasRowspan: true 플래그로 표시
→ 1차 구현에서는 빈 문자열("")로만 처리 (복원 로직 생략)
```

### 3-5. 단위 행 처리 (금액/수량 단위 표시 행)

**규칙 T-06: 단위 행 판정**
```
행의 셀 전체가 하나의 병합 셀이고, 텍스트가 다음 패턴에 해당:
  /(단위\s*[:：]?\s*(원|주|천원|백만원|억원|천주|만주))/
  또는 /\(단위\s*:.*?\)/
→ 이 행을 rows에서 제외하지 않되 ExtractedTable.unitNote 필드에 저장
→ unitNote: string | null  (예: "단위: 원", "단위: 백만원")
```

### 3-6. 셀 텍스트 정규화

**규칙 T-07: 셀 내용 정규화**
```
1. 내부 <br>, <br/>, <BR> → '\n' 으로 대체 (줄바꿈 보존)
2. 기타 인라인 태그 (<span>, <font>, <b>, <strong>, <i>, <em>) → 태그 제거, 내용 유지
3. 엔터티 정규화 (R-07 규칙과 동일)
4. 앞뒤 공백 trim(), 연속 공백 → 공백 1개
5. 빈 셀 → ""
```

---

## 4. 핵심 key-value 후보 (key-value.mapper.ts)

> 이 섹션은 **위치·라벨 패턴**만 정의한다. 수치 계산·검증은 M2(이벤트·수치 추출)에서 수행.
> mapper는 표와 본문에서 패턴을 찾아 raw 값을 추출하는 것이 목적이다.

### 4-1. SUPPLY_CONTRACT (단일판매·공급계약)

**표에서 찾을 라벨 패턴:**
```
계약금액        → labelPatterns: [/계약\s*금액/, /총\s*계약\s*금액/, /계약\s*규모/]
최근 매출액     → labelPatterns: [/최근\s*매출액/, /직전\s*년도\s*매출/, /전년도\s*매출/]
계약 상대방     → labelPatterns: [/계약\s*상대방/, /거래\s*상대방/, /계약\s*체결\s*회사/]
계약 기간 시작  → labelPatterns: [/계약\s*(기간|시작일?)/, /납품\s*기간/, /계약\s*시작/]
계약 기간 종료  → labelPatterns: [/계약\s*종료일?/, /납품\s*완료일?/]
계약 목적물     → labelPatterns: [/계약\s*목적물/, /공급\s*품목/, /제품명/]
```

**본문 문장에서 찾을 패턴:**
```
계약금액: /계약\s*금액은?\s*(약\s*)?([\d,]+)\s*(원|억원|백만원|천만원)/
매출 비율: /최근\s*매출액의?\s*([\d.]+)\s*%/ 또는 /매출\s*대비\s*([\d.]+)\s*%/
```

**추출 우선순위:** 표 > 본문 문장 (표가 있으면 표 값 우선)

---

### 4-2. SHARE_BUYBACK / SHARE_CANCELLATION (자기주식 취득·소각)

**표에서 찾을 라벨 패턴:**
```
취득 방법       → labelPatterns: [/취득\s*방법/, /취득\s*방식/]
취득 예정 주식수 → labelPatterns: [/취득\s*예정\s*(주식\s*)?수/, /취득\s*수량/, /취득\s*주식\s*수/]
취득 예정 금액  → labelPatterns: [/취득\s*예정\s*금액/, /취득\s*총액/, /취득\s*금액/]
취득 기간 시작  → labelPatterns: [/취득\s*예정\s*기간/, /취득\s*시작일?/]
취득 기간 종료  → labelPatterns: [/취득\s*종료일?/, /처분\s*기간/]
소각 예정 주식수 → labelPatterns: [/소각\s*예정\s*(주식\s*)?수/, /소각\s*주식수/, /소각\s*수량/]
소각 예정 금액  → labelPatterns: [/소각\s*예정\s*금액/, /소각\s*총액/]
목적             → labelPatterns: [/취득\s*목적/, /소각\s*목적/]
취득 전 자사주수 → labelPatterns: [/취득\s*전\s*(보유|자사주)/, /현재\s*(보유\s*)?자사주/]
발행 주식 총수  → labelPatterns: [/발행\s*(주식\s*)?총\s*수/, /총\s*발행\s*주식/]
```

---

### 4-3. DIVIDEND (현금·현물배당)

**표에서 찾을 라벨 패턴:**
```
배당 구분       → labelPatterns: [/배당\s*구분/, /배당\s*종류/]
1주당 배당금    → labelPatterns: [/주당\s*배당금/, /1주당\s*배당금/, /배당금\s*\(주당\)/]
배당금 총액     → labelPatterns: [/배당금\s*총액/, /배당\s*총액/, /현금배당금액/]
배당 기준일     → labelPatterns: [/배당\s*기준일/, /기준일/]
배당 지급 예정일 → labelPatterns: [/지급\s*(예정\s*)?일/, /배당\s*지급일/]
배당 성향       → labelPatterns: [/배당\s*성향/, /배당\s*수익률/]
전년 배당금     → labelPatterns: [/전년\s*(도\s*)?(동기)?배당금/, /전기\s*배당금/, /직전\s*배당금/]
주식 수         → labelPatterns: [/배당\s*주식\s*수/, /대상\s*주식\s*수/]
```

**본문 문장에서 찾을 패턴:**
```
주당 배당금: /주당\s*([\d,]+)\s*원/
배당 기준일: /(배당\s*기준일|기준일)[은는이가]?\s*(\d{4}[.\-년]\s*\d{1,2}[.\-월]\s*\d{1,2}[일]?)/
```

---

### 4-4. PAID_IN_CAPITAL_INCREASE (유상증자)

**표에서 찾을 라벨 패턴:**
```
증자 방식       → labelPatterns: [/증자\s*방식/, /발행\s*방법/, /모집\s*방법/]
신주 발행 수    → labelPatterns: [/신주\s*발행\s*(주식\s*)?수/, /발행\s*주식\s*수/, /모집\s*주식\s*수/]
발행 금액       → labelPatterns: [/발행\s*금액/, /증자\s*금액/, /조달\s*금액/]
1주 발행 가액   → labelPatterns: [/발행가(액)?/, /1주\s*(당\s*)?발행가/, /신주\s*발행가/]
기존 발행 주식수 → labelPatterns: [/기존\s*발행\s*주식\s*수/, /현재\s*발행\s*총\s*주식\s*수/]
할인율          → labelPatterns: [/할인율/, /청약\s*가격\s*할인/]
납입일          → labelPatterns: [/납입일/, /청약\s*납입일/]
배정 기준일     → labelPatterns: [/배정\s*기준일/, /신주\s*배정\s*기준일/]
자금 사용 목적  → labelPatterns: [/자금\s*사용\s*목적/, /조달\s*목적/, /사용\s*계획/]
제3자 배정 상대방 → labelPatterns: [/제3자\s*배정\s*(대상)?/, /배정\s*상대방/]
```

---

### 4-5. CB_BW_ISSUANCE (전환사채·신주인수권부사채)

**표에서 찾을 라벨 패턴:**
```
발행 총액       → labelPatterns: [/발행\s*(총)?금액/, /사채\s*금액/, /발행\s*규모/]
표면 이자율     → labelPatterns: [/표면\s*이자율/, /쿠폰\s*금리/, /이자율/]
만기 이자율     → labelPatterns: [/만기\s*이자율/, /수익률/, /YTM/]
전환가액        → labelPatterns: [/전환가(액)?/, /전환\s*가격/, /행사\s*가격/]   (CB 전용)
신주인수권 행사가액 → labelPatterns: [/행사가(액)?/, /신주\s*인수권\s*행사가/, /워런트\s*행사가/]  (BW 전용)
만기일          → labelPatterns: [/만기일?/, /상환\s*기일/, /만기\s*일자/]
발행일          → labelPatterns: [/발행일?/, /납입일?/]
전환 청구 기간  → labelPatterns: [/전환\s*청구\s*기간/, /행사\s*기간/]
매수청구 조건   → labelPatterns: [/조기상환\s*(청구)?조건/, /풋옵션/, /Put\s*option/i]
리픽싱 조건     → labelPatterns: [/리픽싱/, /전환가\s*조정/, /Refixing/i]
```

**CB/BW 구분 규칙:**
```
reportName 또는 본문 첫 500자에 다음 패턴이 있으면:
  /전환사채|CB[\s(]/ → type: 'CB'
  /신주인수권부사채|BW[\s(]/ → type: 'BW'
  /교환사채|EB[\s(]/ → type: 'EB'
  둘 다 있으면 reportName 기준 우선
```

---

### 4-6. key-value 추출 공통 알고리즘

**규칙 KV-01: 라벨-값 쌍 추출 (표 기준)**
```
입력: ExtractedTable[]
처리:
  for each table:
    for each row:
      셀[0] 텍스트가 labelPatterns 중 하나에 매칭되면:
        → 해당 행의 셀[1] 텍스트를 raw 값으로 추출
        → 셀이 2개뿐이고 셀[0]이 라벨이면 가장 신뢰도 높음 (confidence: 'HIGH')
      셀[0]이 라벨, 셀[2]가 값인 구조(셀[1]이 단위나 빈 값):
        → 셀[2] 또는 셀[1] 중 숫자 포함 셀을 값으로 사용
```

**규칙 KV-02: 숫자 정규화 (rawValue → normalizedValue)**
```
원본: "120,000,000,000 원" 또는 "1,200억원"
처리:
  1. 쉼표 제거: /,/g → ''
  2. 단위 변환 (한국 금액 표기):
     /(\d+)\s*억\s*(원)?/ → 해당 숫자 × 100,000,000
     /(\d+)\s*천만\s*(원)?/ → 해당 숫자 × 10,000,000
     /(\d+)\s*만\s*(원)?/ → 해당 숫자 × 10,000
     /(\d+)\s*백만\s*(원)?/ → 해당 숫자 × 1,000,000
     /(\d+)\s*천\s*(원)?/ → 해당 숫자 × 1,000
  3. unitNote가 '백만원' 이면 숫자 × 1,000,000, '억원' 이면 × 100,000,000 등 적용
  4. 변환 실패 시 rawValue 그대로 저장, normalized 필드는 null
```

**규칙 KV-03: 날짜 정규화 (rawValue → isoDate)**
```
입력 패턴:
  YYYYMMDD           → YYYY-MM-DD
  YYYY.MM.DD         → YYYY-MM-DD
  YYYY년 M월 D일     → YYYY-MM-DD
  YYYY-MM-DD         → 그대로
변환 실패 시 rawValue 그대로, isoDate: null
```

---

## 5. 정정공시 판정 규칙 (amendment.detector.ts)

### 5-1. isAmendment 판정

**규칙 A-01: rmk 필드 패턴 매칭**
```typescript
const AMENDMENT_PATTERNS: RegExp[] = [
  /\[기재정정\]/,
  /\[첨부정정\]/,
  /\[자진정정\]/,
  /\[정정\]/,          // 단독 [정정] 태그
  /정정\s*신고/,
  /정정\s*보고/,
];

function isAmendment(rmk: string): boolean {
  return AMENDMENT_PATTERNS.some(p => p.test(rmk));
}
```

**규칙 A-02: reportName 보조 판정 (rmk 미신뢰 시 fallback)**
```typescript
const AMENDMENT_REPORT_PATTERNS: RegExp[] = [
  /\[기재정정\]/,
  /\[첨부정정\]/,
  /\(정정\)/,
  /정정\s*신고서/,
];

// rmk가 빈 문자열이거나 null인 경우 reportName으로 재판정
function isAmendmentByReportName(reportName: string): boolean {
  return AMENDMENT_REPORT_PATTERNS.some(p => p.test(reportName));
}
```

**최종 판정:** `isAmendment(rmk) || isAmendmentByReportName(reportName)`

### 5-2. originalRcpNo 연결 방법

**규칙 A-03: rmk에서 원공시 rcpNo 추출 시도**
```
rmk 예시: "[기재정정] 원본 접수번호: 20240101123456"
          "[첨부정정] (원접수번호: 20231215987654)"
          "[자진정정] 원공시: 20240215001234"

추출 패턴:
  /(\d{14})/  → 14자리 숫자가 있으면 rcpNo 후보 (DART rcpNo는 항상 14자리)
  여러 개일 경우 첫 번째 14자리 숫자 사용
  추출 실패 시 null
```

**규칙 A-04: DB 룩업으로 originalRcpNo 보완**
```
rmk에서 추출 실패 시:
  1. 동일 corpCode의 동일 disclosureType 공시 중
  2. 현재 공시 rcpDt 이전에 수신된 공시 중
  3. reportName에서 정정 패턴 ([기재정정] 등) 제거 후 유사 reportName 매칭
  4. 최근 30일 이내 공시만 검색 (너무 오래된 원공시 제외)
  5. 1건만 매칭되면 originalRcpNo로 설정
  6. 0건 또는 2건 이상 매칭 → originalRcpNo: null (수동 연결 필요)
```

**규칙 A-05: 복수 정정 시 체인 연결**
```
동일 공시에 정정이 2건 이상 있을 경우:
  모든 정정 공시의 originalRcpNo는 항상 최초 원공시의 rcpNo를 가리킨다.
  (정정1 → 원공시, 정정2 → 원공시, 정정3 → 원공시 — 체인 불가)
  
검증 방법: originalRcpNo의 isAmendment가 true인 경우
  → 그 originalRcpNo의 originalRcpNo를 재귀 탐색해 최초 원공시까지 거슬러 올라감
  → 최초 원공시(isAmendment: false) rcpNo로 업데이트
```

---

## 6. 파서 견고성 규칙

### 6-1. 깨진 태그 / 비정상 HTML 대응

**규칙 P-01: 태그 매칭 실패 처리**
```
fast-xml-parser 옵션:
  allowBooleanAttributes: true
  ignoreAttributes: false
  parseAttributeValue: false
  trimValues: true
  
파싱 실패 시: try-catch로 잡아 xmlParseError 기록
  → html.parser.ts의 정규식 기반 텍스트 추출로 fallback
  → parseStatus: PARSE_FAILED 대신 WARNING 기록 후 rawText만 저장
```

**규칙 P-02: 태그 미닫힘 대응**
```
정규식 기반 표 추출 시:
  /<table[\s\S]*?<\/table>/gi 로 table 블록을 먼저 분리
  분리 실패 시 (예: </table> 없음):
    /<table[^>]*>/i 로 시작 위치 찾고 다음 <table> 시작 전까지를 블록으로 간주
    → hasColspan: false, hasRowspan: false, rows를 최대한 추출
```

### 6-2. 빈 문서 대응

**규칙 P-03: 빈 문서 처리**
```
조건: rawText.trim().length < 50 (50자 미만이면 사실상 빈 문서)
처리:
  → parseStatus: SKIPPED
  → lastError: 'EMPTY_DOCUMENT'
  → tables: [], parsedJson: {}
  → wordCount: 0
```

**규칙 P-04: ZIP 내 파일 없음 처리**
```
ZIP 압축 해제 후 파일이 0개이거나 모든 파일 크기가 0인 경우:
  → parseStatus: FETCH_FAILED
  → lastError: 'EMPTY_ZIP'
  → retryCount 증가
```

### 6-3. 대용량 문서 대응

**규칙 P-05: 200KB 상한 처리**
```
rawText 길이가 200 × 1024 초과 시:
  → rawText = rawText.substring(0, 200 * 1024)
  → wordCount = 200 × 1024 (상한값으로 기록)
  → lastError에 'TRUNCATED_AT_200KB' append
  → tables 추출은 원본 전체에서 수행 (표 데이터는 truncate 제외)
  → parsedJson 추출은 rawText truncate 이전 표 데이터 기준으로 수행
```

**규칙 P-06: 처리 시간 상한**
```
단건 파싱 타임아웃: 10초 (다운로드 3초 + 파싱 7초)
타임아웃 초과 시:
  → parseStatus: PARSE_FAILED
  → lastError: 'PARSE_TIMEOUT'
  → retryCount 증가
```

### 6-4. wordCount 산출 최종 규칙

**규칙 P-07: wordCount 기록**
```
wordCount = rawText.length  (rawText truncate 후 최종 길이)
용도: Phase 4 AI 입력 토큰 비용 예측 (한국어 기준 약 1글자 = 0.6~1.0 토큰)
```

---

## 7. 오프라인 픽스처 기반 구현·테스트 규칙

> DART API 키 미보유 상태이므로 라이브 호출 대신 픽스처 파일 기반으로 파서를 검증한다.

### 7-1. 픽스처 파일 위치
```
backend/test/fixtures/dart-documents/
  {rcpNo}/
    document.xml      ← ZIP에서 꺼낸 원본 XML/HTML 파일
    expected.json     ← 기대 파싱 결과 (rawText 일부, tables, parsedJson)
```

### 7-2. 픽스처 우선 로딩 규칙
```
환경변수 DART_USE_FIXTURE=true (또는 DART_API_KEY 미설정) 시:
  DartDocumentFetcher.fetchDocumentXml(rcpNo) →
    1. backend/test/fixtures/dart-documents/{rcpNo}/document.xml 파일 존재 확인
    2. 존재하면 파일 내용 반환 (라이브 호출 생략)
    3. 없으면 FETCH_FAILED 처리
```

### 7-3. 픽스처 최소 요구사항
```
5종 이벤트 × 최소 2건 = 10개 픽스처 필요
각 픽스처 파일은:
  - 실제 DART 공시 원문과 동일한 마크업 구조
  - 적어도 1개 이상의 핵심 표 포함
  - 정정공시 픽스처 최소 1건 (rmk에 [기재정정] 포함)
```

---

## 8. 규칙 요약 인덱스

| 규칙 ID | 범주 | 내용 요약 |
|---------|------|----------|
| R-01~R-06 | rawText 제거 | DOCTYPE, 주석, script, style, XML PI, 모든 태그 제거 |
| R-07 | rawText 엔터티 | &amp; 우선 처리 후 나머지 엔터티 정규화 |
| R-08 | rawText 공백 | \r\n 정규화, 탭→공백, 연속공백 축소, 빈줄 축소 |
| R-09 | wordCount | rawText.length, 200KB 상한 truncate |
| T-01 | 표 탐지 | `<table>...</table>` 정규식 + DART 전용 TE/TU 태그 |
| T-02 | 표 최소 조건 | 행 1이상, 열 1이상, 전부 빈 셀이면 제외 |
| T-03 | 헤더 감지 | TH 태그 우선, 없으면 첫 행 조건 판단 |
| T-04 | colspan | 복제 없이 1셀 저장, hasColspan 플래그 |
| T-05 | rowspan | 아래 행에 "" 채움, hasRowspan 플래그 |
| T-06 | 단위 행 | 정규식으로 탐지, unitNote 필드에 저장 |
| T-07 | 셀 정규화 | br→\n, 인라인 태그 제거, 엔터티, trim |
| KV-01 | KV 추출 | 표 셀[0] 라벨 패턴 매칭 → 셀[1] 값 추출 |
| KV-02 | 숫자 정규화 | 쉼표제거, 억/만 단위 변환, unitNote 적용 |
| KV-03 | 날짜 정규화 | YYYYMMDD/YYYY.MM.DD/YYYY년MM월DD일 → ISO |
| A-01 | isAmendment | rmk 필드 6가지 패턴 매칭 |
| A-02 | isAmendment fallback | rmk 비어있으면 reportName 패턴 보조 판정 |
| A-03 | originalRcpNo | rmk에서 14자리 숫자 추출 |
| A-04 | originalRcpNo DB룩업 | 추출 실패 시 동일 corpCode+기간 기준 매칭 |
| A-05 | 복수 정정 체인 | 모든 정정은 최초 원공시 rcpNo 가리킴 |
| P-01 | 깨진 태그 | fast-xml-parser 실패 → 정규식 fallback |
| P-02 | 미닫힘 태그 | table 블록 추출 fallback 규칙 |
| P-03 | 빈 문서 | 50자 미만이면 SKIPPED 처리 |
| P-04 | 빈 ZIP | FETCH_FAILED + retryCount 증가 |
| P-05 | 200KB 상한 | rawText truncate, 표 추출은 제외 |
| P-06 | 처리 타임아웃 | 10초 초과 시 PARSE_FAILED |
| P-07 | wordCount | truncate 후 최종 rawText.length |
