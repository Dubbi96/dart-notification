# 테스터 코호트 계측 — 이벤트 로깅 + iOS 게이트 설문 (DAR-516, Wave A/A6)

> 정본(SSOT). 계획 정본: `docs/roadmap/cc-pm-cycle1-plan-2026-07-17.md` (Wave A / A6).
> 착수 전제: 에디션 웨이브(DAR-508/509/510) 완주 후 · M10 무오염(읽기 API + UI 계측 한정).
> 관련: API `docs/api-specification.md §31.8` · 스키마 `docs/database-schema.md §42` · 온보딩 퍼널 §31.7(비인증 형제).
> 작성일: 2026-07-17.

## 1. 목적 · 범위

Play 스토어 비공개 테스트 12인 코호트의 **로그인 후 인앱 행동**을 7/22 온보딩 전에 배선한다.
목표: 에디션이 실제로 열리는가(오픈율), 다시 돌아오는가(재방문)를 **정량**으로 본다.

- 계측 5지점: **에디션 오픈 · 카드 탭 · 푸시 오픈 · 통계 섹션 노출 · waitlist CTA**.
- iOS **1문항 게이트 설문**: 테스터는 안드로이드 12인 — iOS 는 아직 배포 대상이 아니므로
  iOS 인증 사용자에게 "정식 출시되면 쓰실래요?" 1문항을 1회 노출하고 응답을 이벤트로 기록.

**비범위**: 서드파티 SDK(amplitude/GA 등) 도입, 세션 리플레이, 화면 체류시간, A/B 실험 프레임워크.
이것은 12인용 최소 계측이다 — 최소 스키마 + 무소음 실패 + PII 무수집이 설계 제약이다.

## 2. 수용기준 매핑

| # | 수용기준 | 충족 |
|---|---|---|
| 1 | PII 무수집(userId·이벤트명·ts만) | `tester_events` 는 정확히 `userId`·`event`·`createdAt` 3필드. `event` 는 화이트리스트 8종(`IsIn`)뿐 — 종목/카드 식별자·자유텍스트 입력 경로 없음. ts 는 **서버 스탬프**(클라 시계 미신뢰). |
| 2 | 스키마 문서화 | 본 문서 §4·§5·§6 + `database-schema.md §42` + `api-specification.md §31.8`. |
| 3 | 오픈율·재방문 집계 쿼리 1종 | §6 단일 CTE 집계 SQL(`GET /ops/tester-metrics` 로 노출·서비스에 구현). |
| 4 | APK 재빌드 일정과 동기 | §8. 계측 코드는 클라 번들에 포함되므로 **다음 APK 재빌드에 반드시 동승**해야 발화한다. |

## 3. PII · 프라이버시 정책

- **저장 필드 = `userId`(인증 내부 ID) · `event`(화이트리스트) · `createdAt`(서버 ts)** 뿐.
- 화이트리스트 강제(`IsIn`)로 자유텍스트/식별자 유입을 **입력 단에서 차단**한다 —
  `card_tap:005930` 같은 시도는 400(서버)·`isTesterEvent` false(클라).
- 카드가 어떤 종목인지, 어떤 에디션 날짜인지 **저장하지 않는다**(오픈율·재방문에 불필요).
- iOS 설문 응답은 **이벤트명으로만** 인코딩(`survey_ios_answer_yes|no`) — 별도 값 컬럼·자유응답 없음.
- 인증 게이팅: 클라는 `accessToken` 이 있을 때만 전송(게스트/미로그인 무전송) → 익명 트래킹 없음.
- 탈퇴 시 `userId` 처리: `tester_events` 는 FK 없는 감사 이력이므로 계정 삭제 흐름의 익명화/purge 정책(§2.6 api-spec)에 준해 별도 정리 대상(테스터 종료 후 일괄 폐기 권장).

## 4. 이벤트 택소노미 (SSOT)

**SSOT 미러**: 백엔드 `backend/src/ops/dto/record-tester-event.dto.ts` `TESTER_EVENTS` ↔
모바일 `mobile/utils/testerEvents.ts` `TESTER_EVENTS`. 값 추가/변경 시 **양쪽 동시 갱신 + 양쪽 유닛테스트가 순서까지 잠금**.

| event | 의미 | 발화 지점(모바일) |
|---|---|---|
| `edition_open` | 에디션 오픈 | 신호탭 `BuyEditionView`(선택 거래일 확정 effect, 날짜당 1회) · 홈 `HomeSignalPreview`(인증+최신 에디션 노출 effect) |
| `card_tap` | 신호/에디션 카드 탭 | `EditionSignalList.handlePress` · `HomeSignalPreview.handleCardPress`(상세 진입 직전) |
| `push_open` | 푸시 탭으로 앱 진입 | `useNotificationSetup` 응답 리스너(포그라운드/백그라운드) + 콜드스타트 핸들러 |
| `stats_section_view` | 통계 섹션 노출 | `DisclosureReactionSection`(콘텐츠 확정 시 rcpNo당 1회) |
| `waitlist_cta` | Pro waitlist CTA | `settings-detail/pro.tsx.handleWaitlistToggle`(opt-in 방향만) |
| `survey_ios_shown` | iOS 게이트 설문 노출 | `IosGateSurvey` 노출 시 |
| `survey_ios_answer_yes` | iOS 설문: 관심 있음 | `IosGateSurvey` '네, 관심 있어요' |
| `survey_ios_answer_no` | iOS 설문: 나중에 | `IosGateSurvey` '지금은 아니에요' |

**계측 신뢰도 주의(정직 고지)**:
- `stats_section_view` 는 `ScrollView` 내부라 **뷰포트 교차가 아닌 콘텐츠 렌더 시점** 기준(마운트 근사).
  즉 '스크롤로 실제 도달' 이 아니라 '섹션이 렌더될 조건 충족'을 뜻한다. 오픈율 지표엔 미사용(보조 카운트).
- `edition_open` 은 홈+신호탭 두 표면에서 발화 → 한 사용자가 양쪽을 보면 카운트 2. **오픈율은 고유 사용자
  기준**이라 무해하나, `byEvent.edition_open` 원시 카운트는 인상 수(중복 포함)임에 유의.

## 5. 데이터 모델 · API

### 5.1 모델 `tester_events` (Prisma `TesterEvent`)
`database-schema.md §42` 정본. 마이그레이션 `20260717120000_dar516_tester_event`(단일 테이블 create-only, additive).
```
id        String   @id @default(cuid())
userId    String                     -- @@index([userId, createdAt])
event     String                     -- @@index([event, createdAt])
createdAt DateTime @default(now())   -- 서버 스탬프(naive-UTC)
```

### 5.2 엔드포인트 (`api-specification.md §31.8`)
- `POST /ops/tester-event` (JWT) — body `{ event }`, `202 { success }`(실패 흡수), 120req/min.
- `GET  /ops/tester-metrics?days=` (JWT) — 오픈율·재방문 집계(§6). days 1~90, 기본 14.

계측은 제품 경로가 아니다 — 적재 실패도 202로 흡수하고 모바일은 fire-and-forget(`recordTesterEvent`).

## 6. 오픈율 · 재방문 집계 쿼리 (수용기준 3, "1종")

`TesterEventService.cohortMetrics` 의 헤드라인 단일 쿼리. `createdAt`(naive-UTC)를 KST 일 버킷으로
이중 변환(DAR-505 패턴)한 뒤, 사용자별로 접고(활동일 수·에디션/푸시 오픈 여부) 코호트 수준으로 롤업한다.

```sql
WITH windowed AS (
  SELECT
    "userId",
    "event",
    ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS kst_day
  FROM "tester_events"
  WHERE "createdAt" >= (NOW() AT TIME ZONE 'UTC') - ($1 * INTERVAL '1 day')  -- $1 = windowDays(1~90)
),
per_user AS (
  SELECT
    "userId",
    COUNT(DISTINCT kst_day)                 AS active_days,
    BOOL_OR("event" = 'edition_open')       AS opened_edition,
    BOOL_OR("event" = 'push_open')          AS opened_push
  FROM windowed
  GROUP BY "userId"
)
SELECT
  COUNT(*)::int                                   AS total_users,        -- 관측창 내 활동 고유 사용자
  COUNT(*) FILTER (WHERE opened_edition)::int     AS edition_open_users, -- 에디션 1회↑ 오픈
  COUNT(*) FILTER (WHERE opened_push)::int        AS push_open_users,    -- 푸시 1회↑ 오픈
  COUNT(*) FILTER (WHERE active_days >= 2)::int    AS revisit_users       -- 활동일 ≥2(재방문)
FROM per_user;
```
파생: `openRate = edition_open_users / total_users`, `revisitRate = revisit_users / total_users`
(분모 0 방어 → 0). 보조로 `byEvent`(이벤트별 총 카운트, `groupBy`)를 함께 반환한다.

**빠른 확인용 애드혹 쿼리**(psql, 최근 14일):
```sql
-- 일자별 활동 사용자(리텐션 곡선 눈으로 보기)
SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
       COUNT(DISTINCT "userId") AS dau
FROM "tester_events"
WHERE "createdAt" >= NOW() - INTERVAL '14 days'
GROUP BY 1 ORDER BY 1;
```

## 7. iOS 게이트 설문

`mobile/components/survey/IosGateSurvey.tsx` — `app/_layout.tsx` `AppContent` 에 마운트.
- 표시 조건: `Platform.OS === 'ios'` **AND** 인증 **AND** 미응답(`SecureStore` 플래그 `tester.survey.ios.v1`).
- 노출 시 `survey_ios_shown`, 응답 시 `survey_ios_answer_yes|no`, 바깥 탭 닫기 = 무응답 스킵(재노출 방지 플래그만).
- 안드로이드·게스트에서는 아무것도 렌더하지 않음(`null`). 앱 흐름 비간섭(계측 전용).

## 8. APK 재빌드 동기 (수용기준 4)

계측 코드는 **클라이언트 번들**(모바일)에 포함된다 — 서버 배포만으로는 발화하지 않는다.
따라서 다음 순서가 강제된다:

1. 본 브랜치(BE + FE) 머지 → main.
2. **백엔드 배포**: `tester_events` 마이그레이션 적용(`prisma migrate deploy`, 휴먼 승인) → 엔드포인트 라이브.
   (엔드포인트가 먼저 살아있어야 클라 fire-and-forget 이 202를 받는다. 순서 반대면 계측 손실만 — 무해.)
3. **APK 재빌드 + 테스터 배포**: 계측이 포함된 새 빌드를 7/22 온보딩 클록 **이전**에 Play 비공개 트랙으로 올린다.
   기존 설치본은 계측 코드가 없으므로 이벤트가 잡히지 않는다 → **재빌드 없이는 데이터 0**.
4. 온보딩(7/22) 후 §6 `GET /ops/tester-metrics` 로 오픈율·재방문을 관측.

> 오너 액션 종속(계획 §5-2): Play 개발자 계정·테스터 클록(7/22). APK 재빌드 파이프라인은
> 갭웨이브 잔여 레인(APK 재빌드)과 동일 산출물 — 그 재빌드에 본 계측이 반드시 동승해야 한다.

## 9. 검증 (DoD)

- 백엔드: `tsc --noEmit` 0 · `tester-event.service.spec.ts` 6/6 · ops 모듈 + 앱 부트스트랩 스모크 143/143(DI 배선 검증).
- 모바일: `tsc --noEmit` 0 · 전체 jest 121/121(신규 `__tests__/utils/testerEvents.test.ts` 포함·SSOT 순서 잠금).
- 마이그레이션 적용(`prisma migrate deploy`)은 휴먼 승인 게이트 — 에이전트 자동 적용 금지.
