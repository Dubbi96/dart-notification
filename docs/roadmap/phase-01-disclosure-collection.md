> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 1 — DART 공시 수집 안정화

> 작성일: 2026-06-02 · AI 사용: **없음(Rule 기반 전용)** · 선행 Phase: Phase 0

---

## 1. 목적 & 범위

### 목적

현재 `scheduler.service.ts`는 기본 동작(평일 cron, isCollecting 락, `createMany skipDuplicates`)은 갖추고 있으나, **실패 시 소리 없이 사라지는 공시**가 생길 수 있는 구조다. Phase 1의 목표는 수집 파이프라인을 "절대 데이터를 잃지 않는 구조"로 격상하는 것이다.

- DART OpenAPI 호출 실패·타임아웃 시 재시도/백오프 전략 확립
- 페이지 단위 부분실패 격리 (한 페이지 실패가 전체 롤백을 유발하지 않도록)
- 중복 방지 이중 잠금 (isCollecting 인메모리 락 + DB 고유키 `skipDuplicates`)
- `DisclosureCollectionLog` 모델로 모든 실행 이력을 영속화
- 운영자용 수집 상태 대시보드 엔드포인트
- 관심종목(WatchList) 기준 선행 필터링으로 알림 매칭 부하 경감
- `classifyDisclosureType` 확장: 7분류 → 투자 관련성이 높은 세부 분류 추가

### 포함

- `DisclosureCollectionLog` Prisma 모델 및 마이그레이션
- `SchedulerService` 재시도/백오프, 부분실패 격리, 로그 저장 리팩터
- `DartApiService.classifyDisclosureType` 고도화 (공급계약·자사주·배당·증자·CB/BW 식별)
- `GET /scheduler/logs`, `GET /scheduler/logs/:id`, `GET /scheduler/status` 엔드포인트
- 관심종목 코드 사전 로드 → 수집 시 WatchList 필터 적용 (선택적)

### 제외

- AI 기반 공시 중요도 분류 → Phase 4
- 공시 원문 파싱 → Phase 2
- 이벤트 수치 추출 → Phase 3
- 시세 데이터 결합 → Phase 5

---

## 2. 현재 코드베이스 연결점

| 파일 | 역할 | Phase 1 변경 방향 |
|------|------|-------------------|
| `backend/src/scheduler/scheduler.service.ts` | cron, `collectByDate`, `matchAndNotify` | 재시도·부분실패 격리·로그 저장 추가 |
| `backend/src/scheduler/scheduler.controller.ts` | `POST /scheduler/collect` | 로그 조회 엔드포인트 추가 |
| `backend/src/dart-api/dart-api.service.ts` | `getAllDisclosures`, `classifyDisclosureType` | 세부 분류 확장, 페이지별 에러 격리 |
| `backend/prisma/schema.prisma` | `Disclosure`(rcpNo PK), `Company`(corpCode PK), `WatchList` | `DisclosureCollectionLog` 추가 |

현재 `axiosRetry`는 `dart-api.service.ts`에 설정되어 있으나 재시도 횟수·딜레이가 하드코딩되어 있고 실패 이유가 로그에만 남는다. `SchedulerService`의 catch 블록은 에러를 re-throw하기 때문에 실패 건수를 집계하거나 부분 성공을 분리할 방법이 없다.

---

## 3. 선행 조건 & 의존성

| 항목 | 상태 |
|------|------|
| Phase 0 (기준선 확정) | 선행 완료 필요 |
| `Disclosure`, `Company`, `WatchList` 스키마 | 존재 (변경 없음) |
| DART OpenAPI 키 (`DART_API_KEY` env) | 운영 중 |
| Prisma + PostgreSQL | 운영 중 |
| `@nestjs/schedule`, `axios-retry` | 이미 설치됨 |
| Phase 2, 3, 4 | 불필요 (독립 실행 가능) |

---

## 4. 상세 설계

### 4-1. Prisma 모델: `DisclosureCollectionLog`

```prisma
// backend/prisma/schema.prisma 에 추가

enum CollectionStatus {
  RUNNING
  SUCCESS
  PARTIAL_FAILURE
  FAILURE
}

model DisclosureCollectionLog {
  id            String           @id @default(cuid())
  triggeredBy   String           @default("SCHEDULER") // "SCHEDULER" | "MANUAL"
  bgnDe         String           // YYYYMMDD
  endDe         String           // YYYYMMDD

  startedAt     DateTime         @default(now())
  finishedAt    DateTime?

  // 수집 결과 집계
  fetchedCount  Int              @default(0)  // DART API 응답 전체 건수
  newCount      Int              @default(0)  // 신규 저장 건수
  duplicateCount Int             @default(0)  // 이미 존재 → 스킵된 건수
  failedCount   Int              @default(0)  // 처리 실패 건수

  // 페이지 단위 실패 기록 (JSON 배열)
  // [{ pageNo: 2, error: "timeout", retried: true }, ...]
  pageErrors    Json?

  // 최상위 에러 (전체 실패 시)
  errorMessage  String?
  errorStack    String?

  status        CollectionStatus @default(RUNNING)

  @@index([startedAt])
  @@index([status])
  @@index([bgnDe, endDe])
  @@map("disclosure_collection_logs")
}
```

**FK 정합성 주의:** `Disclosure.rcpNo`와 `Company.corpCode`는 자연키 PK. 이 로그 모델은 수집 실행 단위를 추적하며 개별 공시와 FK를 맺지 않는다(집계 정보만 저장). 개별 공시 수준 실패 추적이 필요하면 `pageErrors` JSON 배열에 rcpNo 목록을 포함한다.

---

### 4-2. NestJS 모듈/서비스 설계

#### `SchedulerService` 메서드 변경

```typescript
// scheduler.service.ts (변경 시그니처 스케치)

async collectByDate(
  bgnDe: string,
  endDe: string,
  triggeredBy: 'SCHEDULER' | 'MANUAL' = 'SCHEDULER',
): Promise<CollectionResult> {
  // 1. isCollecting 락 체크
  // 2. DB에 CollectionLog(RUNNING) 생성 → logId 확보
  // 3. try {
  //      pages = await this.fetchAllPagesWithIsolation(bgnDe, endDe, logId)
  //      newDisclosures = await this.filterAndSave(pages.items)
  //      await this.matchAndNotify(newDisclosures)
  //      await this.updateLog(logId, SUCCESS, counts)
  //    } catch (e) {
  //      await this.updateLog(logId, FAILURE, { errorMessage, errorStack })
  //      // re-throw 안 함 — cron은 조용히 종료, manual은 에러 응답
  //    }
}

// 페이지별 격리 수집
private async fetchAllPagesWithIsolation(
  bgnDe: string,
  endDe: string,
  logId: string,
): Promise<{ items: DartDisclosureItem[]; pageErrors: PageError[] }> {
  // while 루프: 페이지 단위 try/catch
  // 실패한 페이지는 pageErrors 배열에 기록, 수집 계속
  // 페이지 재시도: 최대 MAX_PAGE_RETRY(3)회, 지수 백오프
  // 전체 페이지 실패 시 FAILURE, 일부 실패 시 PARTIAL_FAILURE
}

// 관심종목 필터 (선택적 — 플래그로 on/off)
private async filterByWatchList(
  items: DartDisclosureItem[],
  watchOnlyMode: boolean,
): Promise<DartDisclosureItem[]> {
  if (!watchOnlyMode) return items;
  const watchedCorpCodes = await this.getWatchedCorpCodes(); // Set<string>
  return items.filter(item => watchedCorpCodes.has(item.corp_code));
}
```

#### `DartApiService` 페이지 단위 에러 격리

```typescript
// dart-api.service.ts 추가 메서드

async getDisclosurePage(params: {
  bgn_de: string;
  end_de: string;
  page_no: number;
  page_count: number;
}): Promise<DartListResponse | null> {
  // 실패 시 null 반환 (throw X) — 호출자가 pageErrors에 기록
  // axios-retry: retries=3, exponentialDelay, retryCondition(네트워크·5xx만)
}
```

---

### 4-3. 공시 유형 분류 고도화

현재 7분류(REGULAR/MATERIAL/ISSUANCE/EQUITY/AUDIT/EXCHANGE/OTHER)에 **투자 관련성 레이어**를 추가한다. 분류 결과는 `Disclosure.disclosureType`(기존)과 `Disclosure.investmentTag`(신규 선택 필드) 두 컬럼에 분리 저장한다.

```typescript
// dart-api.service.ts — classifyDisclosureType 확장 의사코드

// 기존 7분류는 유지. 추가로 investmentTag 반환
classifyDisclosureTypeV2(reportName: string): {
  type: string;          // 기존 7분류
  investmentTag: string; // 신규 투자 관련성 태그
} {
  const name = reportName;

  // ─── Phase 0 우선 5종 ─────────────────────────────
  // 단일판매·공급계약
  if (/단일판매|공급계약|공급(및판매)?계약/.test(name))
    return { type: 'MATERIAL', investmentTag: 'SUPPLY_CONTRACT' };

  // 자기주식 취득·소각
  if (/자기주식.*취득|자기주식.*소각|자사주/.test(name))
    return { type: 'MATERIAL', investmentTag: 'SHARE_BUYBACK_OR_CANCEL' };

  // 현금·현물 배당
  if (/현금배당|현물배당|중간배당|특별배당/.test(name))
    return { type: 'MATERIAL', investmentTag: 'DIVIDEND' };

  // 유상증자
  if (/유상증자/.test(name))
    return { type: 'MATERIAL', investmentTag: 'PAID_IN_CAPITAL_INCREASE' };

  // 전환사채·신주인수권부사채
  if (/전환사채|신주인수권부사채|CB발행|BW발행/.test(name))
    return { type: 'MATERIAL', investmentTag: 'CB_BW_ISSUANCE' };

  // ─── 추가 관련 이벤트 ─────────────────────────────
  if (/실적|잠정실적|영업(이익|손실)/.test(name))
    return { type: 'REGULAR', investmentTag: 'EARNINGS' };

  if (/대규모내부거래|특수관계인|횡령|배임/.test(name))
    return { type: 'MATERIAL', investmentTag: 'RISK_GOVERNANCE' };

  if (/감사의견|한정의견|부적정|의견거절/.test(name))
    return { type: 'AUDIT', investmentTag: 'AUDIT_RISK' };

  if (/거래정지|투자위험|상장폐지|관리종목/.test(name))
    return { type: 'EXCHANGE', investmentTag: 'TRADING_RISK' };

  if (/소송|가처분|압류|채권|파산/.test(name))
    return { type: 'MATERIAL', investmentTag: 'LEGAL_RISK' };

  // ─── 기존 7분류 폴백 ─────────────────────────────
  const type = this.classifyDisclosureType(reportName);
  return { type, investmentTag: 'UNCLASSIFIED' };
}
```

**스키마 변경:** `Disclosure` 모델에 `investmentTag String @default("UNCLASSIFIED")` 필드 추가 + `@@index([investmentTag])`.

---

### 4-4. API 엔드포인트

```typescript
// scheduler.controller.ts 추가 엔드포인트

// 수집 로그 목록 (최신순, 페이지네이션)
GET  /scheduler/logs
  ?limit=20&offset=0&status=FAILURE   // 선택 필터
  → CollectionLogListDto[]

// 수집 로그 상세 (pageErrors 포함)
GET  /scheduler/logs/:id
  → CollectionLogDetailDto

// 현재 수집 상태 (실시간 polling 용)
GET  /scheduler/status
  → { isCollecting: boolean; lastLog: CollectionLogSummaryDto | null }

// 수동 수집 (기존 — triggeredBy='MANUAL' 전달)
POST /scheduler/collect?bgnDe&endDe
  → { success: boolean; logId: string; data: CollectionResult }
```

모든 엔드포인트에 `JwtAuthGuard` + `AdminGuard`(또는 `RolesGuard`) 적용 권장. 초기엔 `JwtAuthGuard`만 유지해도 무방.

---

### 4-5. 재시도/백오프 전략 (의사코드)

```
MAX_PAGE_RETRY = 3
BASE_DELAY_MS  = 1000  // 1초

for attempt in 1..MAX_PAGE_RETRY:
  try:
    response = await getDisclosurePage(params)
    if response.status == '013': break  // 데이터 없음 — 정상 종료
    if response.status != '000':
      throw DartApiError(response.status, response.message)
    return response
  catch NetworkError | TimeoutError | 5xxError:
    if attempt == MAX_PAGE_RETRY:
      return null  // pageErrors에 기록
    await sleep(BASE_DELAY_MS * 2^(attempt-1))  // 지수 백오프: 1s, 2s, 4s

// axios-retry 설정 (DartApiService 생성자)
retryCondition = (error) =>
  axiosRetry.isNetworkOrIdempotentRequestError(error) ||
  error.response?.status >= 500
retryDelay = exponentialDelay  // 기존 유지
retries = 3
```

---

## 5. 작업 분해

### DB / 스키마

- [ ] `DisclosureCollectionLog` 모델을 `schema.prisma`에 추가 (`CollectionStatus` enum 포함)
- [ ] `Disclosure` 모델에 `investmentTag String @default("UNCLASSIFIED")` 필드 추가
- [ ] `Disclosure` 모델에 `@@index([investmentTag])` 추가
- [ ] `npx prisma migrate dev --name phase01-collection-log` 실행 및 검증

### DartApiService 수정

- [ ] `getDisclosureList` → 실패 시 throw 유지 (axios-retry 레이어가 처리)
- [ ] `getAllDisclosures` → 페이지 단위 격리 로직으로 리팩터 (`getDisclosurePage` 분리)
- [ ] `classifyDisclosureTypeV2` 구현 (기존 `classifyDisclosureType`은 내부 폴백으로 유지)
- [ ] `retryCondition` 정의: 네트워크/타임아웃/5xx만 재시도 (4xx는 재시도 불필요)

### SchedulerService 수정

- [ ] `collectByDate` 시작 시 `DisclosureCollectionLog`(RUNNING) 생성
- [ ] `fetchAllPagesWithIsolation` private 메서드 추출 (페이지별 try/catch + `pageErrors` 누적)
- [ ] `filterByWatchList` private 메서드 구현 (환경변수 `COLLECTION_WATCHONLY_MODE=false`로 플래그 제어)
- [ ] `saveDisclosures`에서 `investmentTag` 함께 저장
- [ ] 성공/실패/부분실패에 따른 로그 `status` 업데이트 (`finishedAt`, 카운터 일괄 갱신)
- [ ] `collectByDate` catch 블록: cron 호출 시 에러를 re-throw하지 않음 (로그에만 기록)
- [ ] `collectByDate` 반환값에 `logId` 포함

### SchedulerController 수정

- [ ] `GET /scheduler/logs` (limit/offset/status 쿼리 파라미터, 기본 limit=20)
- [ ] `GET /scheduler/logs/:id` (pageErrors JSON 포함 상세)
- [ ] `GET /scheduler/status` (`isCollecting` + `lastLog` 요약)
- [ ] `POST /scheduler/collect` 응답에 `logId` 추가
- [ ] Swagger `@ApiOperation`, `@ApiQuery`, `@ApiResponse` 데코레이터 작성

### 테스트

- [ ] `SchedulerService.collectByDate` 단위 테스트: DART API 실패 시 로그 FAILURE 전환 확인
- [ ] `classifyDisclosureTypeV2` 단위 테스트: 공급계약·자사주·배당·증자·CB 샘플 보고서명 검증
- [ ] E2E: `POST /scheduler/collect` → 로그 생성 → `GET /scheduler/logs/:id` 조회

### 문서 / 운영

- [ ] `docs/database-schema.md` — `DisclosureCollectionLog`, `Disclosure.investmentTag` 추가
- [ ] `docs/api-specification.md` — 신규 3개 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` — 변경 없음 (파일 추가 없음)
- [ ] `NEXT_STEPS.md` — Phase 1 완료 항목 `[x]` 처리

---

## 6. AI 사용 정책

**Phase 1은 AI를 전혀 사용하지 않는다.**

| 영역 | 판단 |
|------|------|
| 공시 유형 분류 | Rule(정규식) 기반 — AI 호출 없음 |
| 재시도·락 로직 | 순수 코드 제어 |
| 관심종목 필터 | DB 조회 기반 |
| 로그 집계 | DB 집계 쿼리 |

비전 원칙 §3-①: "AI는 비용 대비 기대값이 있는 공시에만 사용한다." — Phase 1 단계에서는 어떤 공시가 가치 있는지 판단하기 전이므로 AI 투입 불가.

---

## 7. 비용·성능 고려사항

| 항목 | 내용 |
|------|------|
| DART API 호출 비용 | 무료(공개 API). 단, Rate Limit 존재. 재시도 간격 1~4초로 Rate Limit 충돌 최소화 |
| DB 부하 | `DisclosureCollectionLog` 기록은 실행 1회당 1 upsert. 로그 행이 많아져도 `@@index([startedAt])` 로 조회 유지 |
| 로그 보존 정책 | 90일 이상 된 SUCCESS 로그는 `cleanupExpiredTokens` cron에 함께 정리 권장 |
| `watchOnlyMode` 성능 | WatchList는 최대 수백 행 — 매 수집마다 전체 조회해도 부하 없음. 향후 Redis 캐시 가능 |
| `pageErrors` 저장 | JSON 컬럼, 페이지 수가 많지 않아 크기 문제 없음 (DART 최대 100건/페이지) |
| 인메모리 락 한계 | ECS 멀티 태스크 배포 시 `isCollecting`이 인스턴스 간 공유되지 않음. 이 경우 DB 레벨 락(RUNNING 상태 체크) 또는 Redis 분산 락으로 교체 필요 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 영향 | 대응 |
|--------|------|------|
| DART API 전체 장애 (status≠000, status≠013) | 모든 페이지 실패 → FAILURE 로그 | 재시도 3회 후 FAILURE 기록, 다음 cron 주기에 자동 재시도 |
| 공시 폭발 (하루 수천 건) | `createMany` 대량 insert 지연 | 청크 단위(500건) insert로 분할 처리 |
| `rcpNo` 중복 경쟁조건 (ECS 멀티 인스턴스) | 동시 수집 → skipDuplicates로 DB 보호됨. 로그 중복 생성 가능 | DB 레벨 RUNNING 상태 체크 선행 (`findFirst({ status: RUNNING })`) |
| `investmentTag` 미분류(UNCLASSIFIED) 과다 | 이후 Phase 필터링 품질 저하 | 단위 테스트로 주요 보고서명 커버리지 확인, 정기 검토 |
| 장기 수집 중 DB 연결 타임아웃 | 대용량 백필 실패 | 날짜 범위를 7일 이하로 나눠 수동 트리거 권장 |
| cron 시간대 오류 | KST 기준 장중 수집 누락 | ECS 태스크 환경변수 `TZ=Asia/Seoul` 설정 확인 |
| `isCollecting` 리셋 불가 상황 | 앱 재시작 전까지 수집 불가 | `GET /scheduler/status` 응답에 `isCollecting=true` 노출 → 운영자 인지 후 재시작 |

---

## 9. 완료 기준 (DoD)

| 항목 | 검증 방법 |
|------|-----------|
| `DisclosureCollectionLog` 마이그레이션이 개발/스테이징 DB에 적용됨 | `prisma migrate status` green |
| 스케줄러 1회 실행 후 로그 행이 정확히 1개 생성됨 | `GET /scheduler/logs` 응답 확인 |
| `fetchedCount`, `newCount`, `duplicateCount` 수치가 실제 수집 결과와 일치함 | 수동 수집 후 DB 직접 조회 대조 |
| DART API 1페이지 강제 타임아웃 → 해당 페이지만 `pageErrors`에 기록, 나머지 저장 완료 | 단위 테스트 mock |
| DART API 전체 실패 → 로그 `status=FAILURE`, cron이 에러 없이 종료됨 | 단위 테스트 mock |
| `classifyDisclosureTypeV2`가 Phase 0 5종 공시(공급계약·자사주·배당·증자·CB/BW)를 정확히 분류함 | 단위 테스트 15개 이상 케이스 |
| `GET /scheduler/logs`, `GET /scheduler/logs/:id`, `GET /scheduler/status` 모두 200 반환 | Swagger UI 수동 확인 |
| ECS 멀티 인스턴스 환경에서 RUNNING 중복 진입이 차단됨 | 시뮬레이션 또는 코드 리뷰 |
| `Disclosure.investmentTag` 컬럼이 기존 데이터 마이그레이션(default 'UNCLASSIFIED')을 통과함 | `npx prisma migrate deploy` |
| `docs/database-schema.md`, `docs/api-specification.md` 업데이트 완료 | 문서 리뷰 |
