# M0 기술 계약서 — 기준선 & 수집 안정화

> 작성: BE 리드 · 작성일: 2026-06-02
> 이 문서는 M0 구현 에이전트가 그대로 따를 수 있는 구현 계약이다.
> 상위 문서: [실행 로드맵](../../roadmap/01-execution-roadmap.md) · [BE 역할](../../roadmap/roles/be.md)

---

## 1. DisclosureCollectionLog — Prisma 모델 계약

### 1-1. 모델 정의

아래 정의를 `backend/prisma/schema.prisma` 기존 모델 블록 다음(NotificationHistory 이후)에 추가한다.

```prisma
// ====================================
// 공시 수집 로그 (M0 신규)
// ====================================

model DisclosureCollectionLog {
  id           Int      @id @default(autoincrement())
  startedAt    DateTime @default(now())         // 수집 시작 시각
  endedAt      DateTime?                        // 수집 종료 시각 (RUNNING 중에는 null)
  bgnDe        String                           // 수집 시작일 (YYYYMMDD)
  endDe        String                           // 수집 종료일 (YYYYMMDD)
  fetchedCount Int      @default(0)             // DART API 에서 받아온 총 건수
  newCount     Int      @default(0)             // 신규 저장된 건수
  skippedCount Int      @default(0)             // 중복으로 건너뛴 건수 (fetchedCount - newCount)
  failedCount  Int      @default(0)             // 저장/매칭 오류 건수
  status       String   @default("RUNNING")     // "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED"
  errorMessage String?                          // 실패 시 오류 메시지 (SUCCESS/PARTIAL 시 null)
  triggeredBy  String                           // "CRON" | "MANUAL"

  @@index([startedAt])                          // 최근 N건 조회용
  @@index([status])                             // 상태 필터 조회용
  @@index([triggeredBy])
  @@map("disclosure_collection_logs")
}
```

### 1-2. 필드 상세 규칙

| 필드 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | `Int` | PK autoincrement | 단순 증가 PK. 로그 테이블이므로 UUID 불필요 |
| `startedAt` | `DateTime` | `@default(now())` | 로그 생성 시각 = 수집 시작 시각 |
| `endedAt` | `DateTime?` | nullable | 완료/실패 시점에 UPDATE. RUNNING 중 null |
| `bgnDe` | `String` | 필수 | DART API 파라미터와 동일 포맷(YYYYMMDD) |
| `endDe` | `String` | 필수 | 동상 |
| `fetchedCount` | `Int` | `@default(0)` | `dartApiService.getAllDisclosures()` 반환 건수 |
| `newCount` | `Int` | `@default(0)` | `prisma.disclosure.createMany` 실제 저장 건수 |
| `skippedCount` | `Int` | `@default(0)` | `fetchedCount - newCount` (중복 제거 결과) |
| `failedCount` | `Int` | `@default(0)` | 알림 매칭·발송 등 후처리 오류 건수 |
| `status` | `String` | 필수 | 아래 상태 전이 참고 |
| `errorMessage` | `String?` | nullable | FAILED 시 `error.message` 또는 요약 |
| `triggeredBy` | `String` | 필수 | `"CRON"` 또는 `"MANUAL"` |

#### status 전이 규칙

```
(생성) RUNNING
  → (정상 완료, failedCount === 0) SUCCESS
  → (정상 완료, failedCount > 0)  PARTIAL
  → (catch 블록 진입)              FAILED
```

- `PARTIAL`: DART 수집 자체는 성공했으나 일부 알림 발송 실패 등 부분 오류 상황
- 수집 결과가 `disclosures.length === 0`이어도 정상 완료면 `SUCCESS` (fetchedCount=0, newCount=0)
- `isCollecting` 락 조기 반환(중복 실행 방지)은 로그를 **생성하지 않는다**

---

## 2. scheduler.service.ts 변경 계약

### 2-1. 시그니처 변경

```typescript
// 변경 전
async collectByDate(bgnDe: string, endDe: string): Promise<{ saved: number; total?: number; message?: string }>

// 변경 후
async collectByDate(
  bgnDe: string,
  endDe: string,
  triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
): Promise<{ saved: number; total?: number; message?: string }>
```

- 기본값 `'MANUAL'`이므로 기존 컨트롤러 호출(`collectByDate(bgnDe, endDe)`) 은 코드 변경 없이 호환된다.
- 반환 타입(`{ saved, total }`)은 유지한다.

### 2-2. collectByDate 내부 변경 — 전체 의사코드

```typescript
async collectByDate(bgnDe, endDe, triggeredBy = 'MANUAL') {
  // ① isCollecting 락 — 로그 미생성 조기 반환
  if (this.isCollecting) {
    this.logger.warn('이전 수집 작업이 아직 진행 중입니다. 건너뜁니다.');
    return { saved: 0, message: '이전 작업 진행 중' };
  }

  this.isCollecting = true;

  // ② CollectionLog RUNNING 생성
  const log = await this.prisma.disclosureCollectionLog.create({
    data: { bgnDe, endDe, triggeredBy, status: 'RUNNING' },
  });

  let fetchedCount = 0;
  let newCount = 0;
  let failedCount = 0;

  try {
    this.logger.log(`공시 수집 시작... (${bgnDe} ~ ${endDe}) [triggeredBy=${triggeredBy}]`);

    const disclosures = await this.dartApiService.getAllDisclosures(bgnDe, endDe);
    fetchedCount = disclosures.length;

    if (disclosures.length === 0) {
      this.logger.log('새로운 공시가 없습니다.');
      // ③-a SUCCESS (결과 없음도 정상)
      await this.prisma.disclosureCollectionLog.update({
        where: { id: log.id },
        data: {
          endedAt: new Date(),
          fetchedCount: 0,
          newCount: 0,
          skippedCount: 0,
          failedCount: 0,
          status: 'SUCCESS',
        },
      });
      return { saved: 0, total: 0 };
    }

    const newDisclosures = await this.filterNewDisclosures(disclosures);
    const skippedCount = fetchedCount - newDisclosures.length;

    if (newDisclosures.length === 0) {
      this.logger.log('모든 공시가 이미 수집되었습니다.');
      await this.prisma.disclosureCollectionLog.update({
        where: { id: log.id },
        data: {
          endedAt: new Date(),
          fetchedCount,
          newCount: 0,
          skippedCount,
          failedCount: 0,
          status: 'SUCCESS',
        },
      });
      return { saved: 0, total: fetchedCount };
    }

    newCount = await this.saveDisclosures(newDisclosures);
    this.logger.log(`${newCount}개 신규 공시 저장 완료`);

    // 알림 매칭 — 오류 시 failedCount 증가, throw하지 않음
    try {
      await this.matchAndNotify(newDisclosures);
    } catch (notifyError) {
      this.logger.error('알림 발송 오류', notifyError);
      failedCount = newDisclosures.length; // 매칭 전체 실패로 간주
    }

    const finalStatus = failedCount > 0 ? 'PARTIAL' : 'SUCCESS';

    // ③-b SUCCESS / PARTIAL
    await this.prisma.disclosureCollectionLog.update({
      where: { id: log.id },
      data: {
        endedAt: new Date(),
        fetchedCount,
        newCount,
        skippedCount,
        failedCount,
        status: finalStatus,
      },
    });

    this.logger.log(`공시 수집 완료. [status=${finalStatus}]`);
    return { saved: newCount, total: fetchedCount };

  } catch (error) {
    this.logger.error('공시 수집 실패', error);

    // ③-c FAILED
    await this.prisma.disclosureCollectionLog.update({
      where: { id: log.id },
      data: {
        endedAt: new Date(),
        fetchedCount,
        newCount,
        skippedCount: fetchedCount - newCount,
        failedCount,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });

    throw error; // 컨트롤러 레이어에서 500 응답 처리
  } finally {
    this.isCollecting = false;
  }
}
```

### 2-3. @Cron 핸들러 변경

```typescript
// 장중 Cron
@Cron('*/10 8-17 * * 1-5')
async collectDisclosures() {
  const today = this.formatDate(new Date());
  return this.collectByDate(today, today, 'CRON'); // triggeredBy 추가
}

// 장외시간 Cron
@Cron('0 6-7,18-22 * * 1-5')
async collectDisclosuresOffHours() {
  await this.collectDisclosures(); // collectDisclosures가 'CRON' 전달하므로 변경 없음
}
```

### 2-4. 불변 규칙

- `isCollecting === true` 분기의 조기 반환은 **로그를 생성하지 않는다** (중복 실행 시 로그 노이즈 방지)
- `catch` 블록에서 log UPDATE가 실패해도(네트워크 등) 원래 에러를 재throw한다
- 기존 반환 형식 `{ saved: number; total?: number; message?: string }` 유지

---

## 3. 5종 우선 투자이벤트 1차 게이트 — isInvestmentRelevant 헬퍼

### 3-1. 추가 위치

`backend/src/disclosures/constants/disclosure-types.constant.ts` 파일 하단에 추가한다.

### 3-2. 5종 이벤트 정규식 패턴

| 이벤트 분류 | EventType (M2 예약) | 핵심 패턴 (보고서명 매칭) |
|-------------|---------------------|--------------------------|
| 단일판매·공급계약 | `SUPPLY_CONTRACT` | `/단일판매[·\s]*공급계약\|공급계약체결\|판매계약체결/` |
| 자기주식 취득·소각 | `SHARE_BUYBACK` / `SHARE_CANCELLATION` | `/자기주식\s*(취득\|처분\|소각)\|자사주\s*(취득\|소각)/` |
| 현금·현물배당 | `DIVIDEND` | `/현금배당\|현물배당\|배당결정\|배당금\s*지급/` |
| 유상증자 | `PAID_IN_CAPITAL_INCREASE` | `/유상증자\|주주배정\|제3자배정\|일반공모\s*증자/` |
| 전환사채·신주인수권부사채 | `CB_ISSUANCE` / `BW_ISSUANCE` | `/전환사채\|신주인수권부사채\|CB\b\|BW\b\|교환사채/` |

> **참고:** `교환사채`(EB)는 CB·BW와 함께 희석 이벤트로 분류하여 동일 패턴에 포함한다.

### 3-3. isInvestmentRelevant 헬퍼 코드 계약

```typescript
/**
 * 투자 관련 5종 이벤트 1차 게이트 — 보고서명만으로 스크리닝
 *
 * 반환값이 true인 공시만 M2 이후 수치 추출 대상이 된다.
 * false 공시는 수집·저장은 하되 투자 이벤트 파이프라인으로 진입하지 않는다.
 */
export function isInvestmentRelevant(reportName: string): boolean {
  return INVESTMENT_EVENT_PATTERNS.some((pattern) => pattern.test(reportName));
}

/** 투자이벤트 1차 게이트 정규식 패턴 목록 */
export const INVESTMENT_EVENT_PATTERNS: RegExp[] = [
  // 단일판매·공급계약
  /단일판매[·\s]*공급계약|공급계약\s*체결|판매계약\s*체결/,
  // 자기주식 취득·처분·소각
  /자기주식\s*(취득|처분|소각)|자사주\s*(취득|소각)/,
  // 현금·현물배당 결정
  /현금배당|현물배당|배당\s*결정|배당금\s*지급/,
  // 유상증자
  /유상증자|주주배정|제3자\s*배정|일반공모\s*증자/,
  // 전환사채·신주인수권부사채·교환사채
  /전환사채|신주인수권부사채|교환사채|CB[\s(]|BW[\s(]/,
];

/**
 * 보고서명으로 투자이벤트 타입을 1차 분류 (M2 정밀 분류 전 선별용)
 * 여러 패턴에 해당하면 첫 번째 매칭 이벤트 타입 반환
 */
export type InvestmentEventType =
  | 'SUPPLY_CONTRACT'
  | 'SHARE_BUYBACK'
  | 'SHARE_CANCELLATION'
  | 'DIVIDEND'
  | 'PAID_IN_CAPITAL_INCREASE'
  | 'CB_BW_ISSUANCE'
  | null;

export function classifyInvestmentEventType(reportName: string): InvestmentEventType {
  if (/단일판매[·\s]*공급계약|공급계약\s*체결|판매계약\s*체결/.test(reportName)) {
    return 'SUPPLY_CONTRACT';
  }
  if (/자기주식\s*소각|자사주\s*소각/.test(reportName)) {
    return 'SHARE_CANCELLATION';
  }
  if (/자기주식\s*(취득|처분)|자사주\s*취득/.test(reportName)) {
    return 'SHARE_BUYBACK';
  }
  if (/현금배당|현물배당|배당\s*결정|배당금\s*지급/.test(reportName)) {
    return 'DIVIDEND';
  }
  if (/유상증자|주주배정|제3자\s*배정|일반공모\s*증자/.test(reportName)) {
    return 'PAID_IN_CAPITAL_INCREASE';
  }
  if (/전환사채|신주인수권부사채|교환사채|CB[\s(]|BW[\s(]/.test(reportName)) {
    return 'CB_BW_ISSUANCE';
  }
  return null;
}
```

### 3-4. 현행 classifyDisclosureType과의 관계

- `classifyDisclosureType` (dart-api.service.ts) — 7분류 유지. 변경 없음.
- `isInvestmentRelevant` — 새로 disclosure-types.constant.ts에 추가.
- 두 함수는 **독립 호출**된다. 수집 저장 시 disclosureType(7분류)은 그대로 저장하고, M2 진입 여부 판단에만 `isInvestmentRelevant`를 쓴다.

---

## 4. 신규 엔드포인트 계약

### 4-1. GET /scheduler/collection-logs

#### 컨트롤러 시그니처

```typescript
@Get('collection-logs')
@ApiOperation({ summary: '공시 수집 이력 조회 (최근 50건)' })
@ApiQuery({ name: 'status', required: false, enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] })
async getCollectionLogs(@Query('status') status?: string) {
  return this.schedulerService.getCollectionLogs(status);
}
```

#### 서비스 메서드 시그니처

```typescript
async getCollectionLogs(status?: string): Promise<DisclosureCollectionLog[]> {
  return this.prisma.disclosureCollectionLog.findMany({
    where: status ? { status } : undefined,
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
}
```

#### 응답 형태 (DisclosureCollectionLog 전 필드)

```json
[
  {
    "id": 42,
    "startedAt": "2026-06-02T09:10:00.000Z",
    "endedAt": "2026-06-02T09:10:07.321Z",
    "bgnDe": "20260602",
    "endDe": "20260602",
    "fetchedCount": 137,
    "newCount": 12,
    "skippedCount": 125,
    "failedCount": 0,
    "status": "SUCCESS",
    "errorMessage": null,
    "triggeredBy": "CRON"
  }
]
```

#### 인증

- `JwtAuthGuard` 적용 (컨트롤러 클래스 레벨 `@UseGuards(JwtAuthGuard)` 이미 존재하면 그대로 상속)
- Swagger `@ApiBearerAuth()` 데코레이터 추가

### 4-2. POST /scheduler/collect — 호환성 유지

```typescript
// 변경 전 (현행)
async collect(@Query('bgnDe') bgnDe: string, @Query('endDe') endDe: string) {
  const result = await this.schedulerService.collectByDate(bgnDe, endDe);
  return { success: true, data: result };
}

// 변경 후 — triggeredBy='MANUAL' 명시 전달만 추가
async collect(@Query('bgnDe') bgnDe: string, @Query('endDe') endDe: string) {
  const result = await this.schedulerService.collectByDate(bgnDe, endDe, 'MANUAL');
  return { success: true, data: result };
}
```

- URL, HTTP 메서드, 쿼리파라미터, 응답 형태 모두 동일. 하위 호환 유지.

---

## 5. 영향 파일 목록 + 단위테스트 대상

### 5-1. 수정 파일

| 파일 경로 | 변경 유형 | 내용 |
|-----------|-----------|------|
| `backend/prisma/schema.prisma` | 모델 추가 | `DisclosureCollectionLog` 모델 블록 추가 |
| `backend/src/disclosures/constants/disclosure-types.constant.ts` | 함수/상수 추가 | `INVESTMENT_EVENT_PATTERNS`, `isInvestmentRelevant`, `classifyInvestmentEventType`, `InvestmentEventType` |
| `backend/src/scheduler/scheduler.service.ts` | 시그니처 확장 + 로직 추가 | `collectByDate` 3번째 파라미터 추가, CollectionLog CRUD 삽입, `getCollectionLogs` 메서드 신규 |
| `backend/src/scheduler/scheduler.controller.ts` | 엔드포인트 추가 + 수정 | `GET /collection-logs` 추가, `POST /collect` triggeredBy='MANUAL' 전달 |

### 5-2. 신규 마이그레이션 파일 (오케스트레이터 실행)

- 경로: `backend/prisma/migrations/<timestamp>_add_disclosure_collection_log/migration.sql`
- `npx prisma migrate dev --name add_disclosure_collection_log` 로 생성

### 5-3. 단위테스트 대상

구현 에이전트가 다음 테스트 파일을 작성한다:

#### A. `disclosure-types.constant.spec.ts`

```
describe('isInvestmentRelevant')
  ✓ 단일판매공급계약 보고서명을 true로 분류
  ✓ 자기주식취득 보고서명을 true로 분류
  ✓ 현금배당결정 보고서명을 true로 분류
  ✓ 유상증자 보고서명을 true로 분류
  ✓ 전환사채발행 보고서명을 true로 분류
  ✓ 사업보고서(정기공시)를 false로 분류
  ✓ 감사보고서를 false로 분류
  ✓ 빈 문자열을 false로 분류

describe('classifyInvestmentEventType')
  ✓ "자기주식 취득 결정" → SHARE_BUYBACK
  ✓ "자기주식 소각 결정" → SHARE_CANCELLATION
  ✓ "전환사채권발행결정" → CB_BW_ISSUANCE
  ✓ "합병결정" → null (투자이벤트 아님)
```

#### B. `scheduler.service.spec.ts` (신규 또는 기존 확장)

```
describe('collectByDate — CollectionLog')
  ✓ isCollecting=true 시 로그를 생성하지 않고 조기 반환
  ✓ 수집 시작 시 RUNNING 상태 로그 생성
  ✓ 수집 완료(오류 없음) 시 SUCCESS 로그 갱신
  ✓ matchAndNotify 오류 시 PARTIAL 로그 갱신
  ✓ DART API 오류 시 FAILED 로그 갱신 + throw
  ✓ triggeredBy='CRON'이 로그에 기록됨
  ✓ triggeredBy='MANUAL'이 로그에 기록됨
  ✓ 빈 결과(disclosures.length=0) 시에도 SUCCESS 로그 생성

describe('getCollectionLogs')
  ✓ status 필터 없을 때 최근 50건 반환
  ✓ status='FAILED' 필터 시 FAILED 건만 반환

describe('classifyDisclosureType') (기존 함수 — 회귀 보호용)
  ✓ "사업보고서" → REGULAR
  ✓ "주요사항보고" → MATERIAL
  ✓ "증권신고서" → ISSUANCE
  ✓ "대량보유" → EQUITY
  ✓ "감사보고서" → AUDIT
  ✓ "거래소" → EXCHANGE
  ✓ 기타 → OTHER
```

---

## 6. M0 회귀 체크 항목

M0 구현 완료 후 QA 에이전트(또는 BE 자체 검증)가 아래 항목을 모두 통과해야 다음 단계로 진입한다.

### 6-1. 기존 마이그레이션 재현

```bash
# 클린 DB 기준 전체 마이그레이션 재현 가능 여부
npx prisma migrate deploy
# → 기존 5개 + 신규 1개(add_disclosure_collection_log) = 총 6개 완료
```

- 마이그레이션 실패 0건 확인
- `npx prisma validate` 오류 0건 확인

### 6-2. FK 고아 레코드 0 확인

M0 스키마 변경 후 기존 FK 관계가 깨지지 않는지 확인한다.

```sql
-- rcpNo 고아 확인 (NotificationHistory → Disclosure)
SELECT COUNT(*) FROM notification_history nh
LEFT JOIN disclosures d ON nh.disclosure_rcpno = d.rcp_no
WHERE d.rcp_no IS NULL;
-- 결과 = 0 이어야 함

-- rcpNo 고아 확인 (SavedDisclosure → Disclosure)
SELECT COUNT(*) FROM saved_disclosures sd
LEFT JOIN disclosures d ON sd.disclosure_rcpno = d.rcp_no
WHERE d.rcp_no IS NULL;
-- 결과 = 0 이어야 함

-- corpCode 고아 확인 (Disclosure → Company)
SELECT COUNT(*) FROM disclosures disc
LEFT JOIN companies c ON disc.corp_code = c.corp_code
WHERE c.corp_code IS NULL;
-- 결과 = 0 이어야 함

-- corpCode 고아 확인 (WatchList → Company)
SELECT COUNT(*) FROM watch_lists wl
LEFT JOIN companies c ON wl.corp_code = c.corp_code
WHERE c.corp_code IS NULL;
-- 결과 = 0 이어야 함
```

### 6-3. 카카오 로그인 회귀

- `POST /auth/kakao/callback` — JWT Access + Refresh 정상 발급 확인
- `POST /auth/refresh` — Refresh Token 갱신 정상 확인
- `POST /auth/logout` — 토큰 무효화 확인

### 6-4. 관심목록 회귀

- `GET /watch-lists` — 기존 등록 목록 조회 정상
- `POST /watch-lists` — 관심기업 등록 정상 (Company FK 유효)
- `DELETE /watch-lists/:corpCode` — 삭제 정상

### 6-5. 알림·푸시·딥링크 회귀

- `POST /scheduler/collect?bgnDe=YYYYMMDD&endDe=YYYYMMDD` 수동 트리거 후:
  - `GET /scheduler/collection-logs` 에서 해당 실행 로그 1건 확인 (status=SUCCESS 또는 PARTIAL)
  - `triggeredBy='MANUAL'` 로그 기록 확인
  - 관심 기업의 신규 공시가 있을 경우 NotificationHistory 생성 확인
- CRON 자동 실행 시 `triggeredBy='CRON'` 로그 기록 확인

### 6-6. 수집 안정성 SLA

```
CollectionLog 기준: 최근 100건 중 status='SUCCESS' OR 'PARTIAL' 비율 ≥ 95%
중복 저장: 동일 rcpNo로 Disclosure 레코드가 2건 이상인 경우 = 0
```

---

## 7. 요약 결정 사항

1. **DisclosureCollectionLog PK는 `Int autoincrement`** — 로그 테이블에 UUID 불필요, 단순 증가 키로 충분.
2. **isCollecting 락 조기 반환은 로그 미생성** — 중복 실행 방지 분기가 로그를 남기면 노이즈가 되므로 기록하지 않는다.
3. **isInvestmentRelevant는 disclosure-types.constant.ts에 추가** — dart-api.service.ts의 classifyDisclosureType은 7분류 체계 그대로 유지하고, 5종 투자 이벤트 게이트는 별도 상수 파일에 분리하여 관심사를 분리한다.
