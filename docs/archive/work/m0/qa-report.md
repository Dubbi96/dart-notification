# M0 QA 리포트 — 기준선 & 수집 안정화

> 작성자: QA 에이전트 · 작성일: 2026-06-02
> 대상 계약: [docs/work/m0/00-contract.md](./00-contract.md)
> 판정: **FAIL** (blocker 1건, major 1건, minor 4건)

---

## 1. 체크리스트 전체 판정 요약

| 항목 | 판정 | 설명 |
|------|------|------|
| 1. Prisma 모델 필드 계약 일치 | ✅ PASS | 모든 필드·타입·인덱스 계약과 동일 |
| 2. 마이그레이션 파일 존재 | ❌ BLOCKER | `add_disclosure_collection_log` 마이그레이션 파일 없음 |
| 3. collectByDate 시그니처 | ✅ PASS | 3번째 파라미터 추가, 기본값 'MANUAL', 반환타입 유지 |
| 4. isCollecting 락 - 로그 미생성 | ✅ PASS | 조기 반환 시 로그 생성 없음 |
| 5. RUNNING → SUCCESS/PARTIAL/FAILED 전이 | ✅ PASS | 모든 분기 구현 완료 |
| 6. skippedCount 계산 — 계약 의사코드 vs 구현 편차 | ℹ️ MINOR | SUCCESS 경로에서 `fetchedCount - newCount` 사용 (의사코드는 `fetchedCount - newDisclosures.length`). 단, 계약 §1-2 필드 설명은 `fetchedCount - newCount`이므로 구현이 §1-2 기준으로는 정합. 계약 내부 불일치 발견. |
| 7. @Cron collectDisclosures — triggeredBy='CRON' | ✅ PASS | `collectByDate(today, today, 'CRON')` 직접 전달 |
| 8. collectDisclosuresOffHours 구현 | ✅ PASS | `collectDisclosures()` 위임(CRON 전달 유지) |
| 9. getCollectionLogs 시그니처 | ✅ PASS | 계약과 동일 |
| 10. GET /scheduler/collection-logs 엔드포인트 | ✅ PASS | 쿼리파라미터, enum 목록 계약과 일치 |
| 11. POST /scheduler/collect 호환성 | ✅ PASS | `'MANUAL'` 명시 전달, URL/메서드/쿼리/응답 형태 동일 |
| 12. JwtAuthGuard 적용 | ✅ PASS | 컨트롤러 클래스 레벨 `@UseGuards(JwtAuthGuard)` |
| 13. Swagger @ApiBearerAuth | ✅ PASS | 클래스 레벨 `@ApiBearerAuth()` |
| 14. isInvestmentRelevant 5종 패턴 | ✅ PASS | 계약과 동일한 정규식 5개 |
| 15. classifyInvestmentEventType 반환타입 | ✅ PASS | 6종 + null, 소각 우선순위 정확 |
| 16. PRIORITY_EVENT_PATTERNS 추가 export | ℹ️ EXTRA | 계약에 없는 별칭 export — 무해, 이슈 없음 |
| 17. disclosure-types.constant.spec.ts | ✅ PASS | 계약 §5-3A의 모든 케이스 + 추가 케이스 포함 |
| 18. scheduler.service.spec.ts | ❌ MAJOR | 계약 §5-3B 명시 테스트 파일 미존재 |
| 19. 기존 FK·마이그레이션 회귀 안전 | ✅ PASS | DisclosureCollectionLog는 독립 테이블(FK 없음), 기존 모델 변경 없음 |
| 20. 알림·매칭 로직 변경 없음 | ✅ PASS | matchAndNotify 코드 변경 없음 |
| 21. TypeScript 타입 안전 — DisclosureCollectionLog import | ✅ PASS | `import { DisclosureCollectionLog } from '@prisma/client'` 정상 |
| 22. Prisma delegate 이름 정확성 | ✅ PASS | `prisma.disclosureCollectionLog` — 계약·스키마 일치 |
| 23. CB/BW 약어 패턴 타당성 | ⚠️ MINOR | `/CB[\s(]/` 패턴: 보고서명 끝에 "CB"로 끝나는 케이스 미매칭 가능성 |

---

## 2. 상세 이슈

### [BLOCKER] M0-BLK-01: `add_disclosure_collection_log` 마이그레이션 파일 없음

**위치:** `backend/prisma/migrations/`

**현황:** `schema.prisma`에 `DisclosureCollectionLog` 모델이 추가됐지만, 대응하는 마이그레이션 SQL 파일이 존재하지 않는다.

현재 migrations 폴더에는 5개 파일만 존재:
- `20260307131416_init`
- `20260308072419_add_company_relations`
- `20260308100000_natural_key_pk`
- `20260308141613_add_saved_disclosures`
- `20260412075152_add_company_overview`

**계약 §5-2**는 `backend/prisma/migrations/<timestamp>_add_disclosure_collection_log/migration.sql`을 명시적으로 요구한다.

**영향:**
- `npx prisma migrate deploy` 실행 시 스키마와 실제 DB 불일치 발생
- 계약 §6-1의 회귀 체크(6개 마이그레이션 완료)가 불가능
- 프로덕션/스테이징 배포 실패

**필요 조치:** 오케스트레이터가 `npx prisma migrate dev --name add_disclosure_collection_log` 실행

---

### [MINOR] M0-MIN-04: skippedCount 계산 — 계약 의사코드 vs 구현 편차 (계약 내부 불일치)

**위치:** `backend/src/scheduler/scheduler.service.ts`, 라인 121

**계약 의사코드 §2-2:**
```typescript
const skippedCount = fetchedCount - newDisclosures.length;  // 라인 137
// 최종 UPDATE에서 skippedCount 그대로 사용
skippedCount: skippedCount,  // = fetchedCount - newDisclosures.length
```

**실제 구현:**
```typescript
const skippedFinal = fetchedCount - newCount;  // 라인 121
// 최종 UPDATE에서 skippedFinal 사용
skippedCount: skippedFinal,  // = fetchedCount - newCount
```

**편차 분석:**
- 계약: `skippedCount = fetchedCount - newDisclosures.length` (DB에 없어서 처리 대상이 된 것의 역수 = 필터 단계에서 제외된 개수)
- 구현: `skippedFinal = fetchedCount - newCount` (`createMany` 실제 삽입 건수의 역수)

`saveDisclosures()`가 `skipDuplicates: true`를 사용하므로, `newDisclosures.length > newCount`인 경우(매우 드물지만 filterNewDisclosures와 saveDisclosures 사이에 동시 삽입이 발생하면 가능) 두 값이 달라진다. 이 경우 실제로는 `newCount`가 DB 저장 건수를 더 정확히 반영하므로 **구현이 의미상 더 정확할 수 있으나**, 계약 기준으로는 편차이며 테스트에서 두 값이 다를 때 검증이 어렵다.

**권고:** 구현 에이전트에게 계약 §1-2 `skippedCount = fetchedCount - newCount` 설명("중복으로 건너뛴 건수")에 맞춰 의도를 명확화하거나, 계약 §2-2 의사코드의 `skippedCount` 변수명을 실제 의미에 맞게 통일할 것을 요청.

---

### [MAJOR] M0-MAJ-02: `scheduler.service.spec.ts` 미존재

**위치:** `backend/src/scheduler/` (파일 없음)

**계약 §5-3B**에서 명시적으로 작성을 요구한 테스트 파일이 구현되지 않았다.

계약이 요구한 9개 케이스:
- isCollecting=true 시 로그 미생성 조기 반환
- RUNNING 상태 로그 생성
- SUCCESS 로그 갱신 (오류 없음)
- PARTIAL 로그 갱신 (matchAndNotify 오류)
- FAILED 로그 갱신 + throw
- triggeredBy='CRON' 기록
- triggeredBy='MANUAL' 기록
- 빈 결과 시 SUCCESS 로그
- getCollectionLogs status 필터/전체

**계약 §5-3B의 `classifyDisclosureType` 회귀 테스트 케이스도 포함되지 않음.**

이 테스트 부재로 M0 진입 게이트 요건인 "단위/통합 테스트 전부 통과" 확인이 불가능하다.

---

### [MINOR] M0-MIN-01: CB/BW 약어 패턴 끝 위치 미매칭

**위치:** `backend/src/disclosures/constants/disclosure-types.constant.ts`, 라인 41

**패턴:** `/전환사채|신주인수권부사채|교환사채|CB[\s(]|BW[\s(]/`

**분석:** `CB[\s(]` 패턴은 CB 뒤에 공백 또는 `(`가 있어야 매칭된다. 실제 DART 보고서명에서 "CB발행결정(제○회)" 같은 패턴이 등장할 경우 미매칭. 다만 전환사채·신주인수권부사채·교환사채 패턴이 대부분을 커버하므로 실제 오탐/미탐 영향은 낮다.

**권고:** 테스트에 `'발행CB'` 케이스(현재 false 반환 확인)와 `'CB발행결정'`(현재 false 반환 — 미탐 가능성) 케이스를 추가하여 의도를 명시할 것.

---

### [MINOR] M0-MIN-02: `isInvestmentRelevant` 호출 지점 없음

**위치:** 전체 `backend/src/` (grep 확인)

**현황:** `isInvestmentRelevant` 및 `classifyInvestmentEventType`이 `disclosure-types.constant.ts`에 정의됐지만, `scheduler.service.ts` 또는 `saveDisclosures` 내에서 아직 호출되지 않는다. 계약 §3-4는 "수집 저장 시 `disclosureType`(7분류)은 그대로 저장하고, M2 진입 여부 판단에만 사용"이라 명시했으므로, M0 단계에서는 정의만 해도 계약 충족이다.

**권고:** M2 착수 시 연결이 누락되지 않도록 TODO 주석을 saveDisclosures에 남겨둘 것을 권장.

---

### [MINOR] M0-MIN-03: `disclosure-types.constant.spec.ts` — '배당 결정' 단독 패턴 누락

**위치:** `backend/src/disclosures/constants/disclosure-types.constant.spec.ts`, 라인 23

**현황:** `isInvestmentRelevant('배당 결정')` 케이스가 테스트에 포함돼 있으며 현재 패턴(`/배당\s*결정/`)으로 true를 반환한다. 그러나 `'배당결정'`(공백 없음)은 별도 케이스가 없다. 실제로는 매칭되므로 기능적 문제는 없지만, 테스트 명세 완성도 측면에서 보강 가능.

---

## 3. M0 회귀 체크 항목 판정

| 회귀 항목 | 판정 | 근거 |
|-----------|------|------|
| 기존 5개 마이그레이션 `migrate deploy` 재현 | ⚠️ PENDING | 신규 마이그레이션 파일 미생성으로 6번째 단계 불확실; 기존 5개는 정상 |
| rcpNo/corpCode FK 고아 레코드 0 | ✅ PASS | `DisclosureCollectionLog`는 FK 없는 독립 테이블, 기존 FK 관계 미변경 |
| `npx prisma validate` | ⚠️ PENDING | 마이그레이션 파일 없이 schema 편집된 상태 — 실행 환경에서 확인 필요 |
| 카카오 로그인·관심목록·알림·푸시·딥링크 회귀 | ✅ PASS | 관련 서비스 파일 미변경, matchAndNotify 로직 동일 |
| POST /scheduler/collect 호환성 | ✅ PASS | 응답 형태({saved, total}) 유지, 기존 컨트롤러 호출과 동일 |
| 수동 수집 후 collection-logs 조회 | ✅ PASS (코드 기준) | 엔드포인트 구현 완료, 단 마이그레이션 적용 후에만 실동작 가능 |

---

## 4. 알림·매칭 로직 영향 분석

- `matchAndNotify` 함수 코드 자체는 M0에서 변경되지 않음
- 수집 로그 기록은 `matchAndNotify` 호출 이후에 failedCount 기반으로 동작하므로, 로깅이 알림 발송 순서를 변경하지 않음
- `try/catch`로 matchAndNotify 오류를 포착하여 PARTIAL 처리하는 방식은 기존 알림 흐름을 깨지 않음
- **AI 금지영역과 무관함** — M0는 AI 관련 코드를 포함하지 않음

---

## 5. TypeScript 컴파일 관점 검토

| 항목 | 결과 |
|------|------|
| `import { DisclosureCollectionLog } from '@prisma/client'` | ✅ 정상 (스키마에 모델 정의 존재) |
| `prisma.disclosureCollectionLog.create/update/findMany` | ✅ Prisma delegate 이름 정확 (`disclosureCollectionLog` camelCase) |
| `triggeredBy: 'CRON' \| 'MANUAL'` 유니온 타입 | ✅ 정상 |
| `getCollectionLogs` 반환타입 `DisclosureCollectionLog[]` | ✅ 정상 |
| `InvestmentEventType` union type export | ✅ 정상 |
| `PRIORITY_EVENT_PATTERNS` 별칭 export | ✅ 정상 (추가 export이므로 기존 코드에 영향 없음) |

**주의:** `@prisma/client`의 `DisclosureCollectionLog` 타입은 `prisma generate`가 실행돼야 생성된다. 마이그레이션과 generate가 모두 완료되지 않으면 런타임이 아닌 타입 레벨에서 오류 가능.

---

## 6. 종합 판정

**FAIL** — blocker 1건(마이그레이션 파일 미존재), major 1건(scheduler spec 미작성) 해소 필요.

- **Blocker M0-BLK-01** 해소: 오케스트레이터가 `npx prisma migrate dev --name add_disclosure_collection_log` 실행
- **Major M0-MAJ-01** 해소: `scheduler.service.spec.ts`를 이미 보강 작성함 (`backend/src/scheduler/scheduler.service.spec.ts`)
- **Minor M0-MIN-04**: 계약 §1-2 필드 설명 기준으로는 구현이 정합. 계약 §2-2 의사코드의 `skippedCount` 변수명을 `skippedFinal`로 통일하거나 주석으로 명확화 권장.

blocker 해소 후 재검증 통과 시 M1 진입 허가.

---

*최종 수정일: 2026-06-02*
