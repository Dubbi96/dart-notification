# 일일 투자판단 에디션(뉴스형) 재설계 — 설계 SSOT

> 작성: 2026-07-16 · 상태: 설계 확정(오너 결정 3건 반영), 구현 미착수
> 트리거: 홈 "오늘의 투자판단" 카드가 (A) 바뀌지 않고 (B) '오늘'이 아닌데 '오늘'로 표기됨
> 방식: 멀티에이전트 설계 워크플로(검증 1 + 설계 4렌즈 + 적대검토 2) 종합
> 관련: DAR-422(공시 '오늘'→'최신 M/D' 재라벨 전례) · DAR-129(백필 불노출) · DAR-217(용어위계 SSOT) · UXR-23(피드키 공유) · 2026-07-15 라이브 파싱 기아 장애

## 1. 근본원인 (코드 확정)

### 증상A — 카드가 바뀌지 않음
- 홈 카드는 `useBuySignals()` → `CURATION_FILTERS = { grade:[STRONG_BUY,BUY], sort:'score', sinceDays:14 }` (`mobile/hooks/useSignals.ts:21`).
- 백엔드 `findAll`이 `createdAt >= now-14d` 창 안에서 `orderBy [buyScore desc, createdAt desc, id desc]` (`backend/.../signals/signals.service.ts:301,312,319`).
- 클라 `curateBuySignals`가 다시 `buyScore desc` top-N 재정렬 (`mobile/utils/signalCuration.ts:26`) — **이중 점수정렬**.
- ⇒ 14일 창의 최고점 1건이 최대 14일 최상단 고정. 매일 생성되는 낮은 점수 신호는 창 안이어도 상단을 못 밀어냄.
- 심화: 신호 생성 cron은 평일 19:00 KST(`'0 19 * * 1-5'`), 대상 이벤트성 공시가 있어야만 생성 → 조용한 날/주말/공휴일 0건.

### 증상B — '오늘'이 아닌데 '오늘'로 표기
- 헤더 = `SIGNAL_TERMS.homeHeader = '오늘의 투자판단'` (정적 문자열, 항상 '오늘' 단정, `signalTerms.ts:31`).
- `SignalPreviewCard`는 `createdAt`을 **전혀 렌더하지 않음** (`HomeSignalPreview.tsx:74-173`). 페이로드엔 `createdAt` 존재(`service.ts:380`)하나 미사용.
- 같은 홈 화면의 공시 카운트는 이미 '최신 공시 M/D 기준'(DAR-422, `home/index.tsx:405`)으로 정직화됐는데 신호 헤더만 낡은 규약 잔존.

### 심층 리뷰가 추가로 잡은 정직성 함정 (고가치)
1. **귀속일 위장** — `createdAt`은 신호 *생성 시각*(19시 크론)이지 공시 발생일이 아님. 파싱 지연(2026-07-15 기아 장애 실재) 시 X일 공시가 X+2일에 신호로 생성 → 에디션 X+2가 이틀 묵은 이벤트를 '오늘 판단'으로 위장. `Disclosure.rcpDt`(접수일, `schema.prisma:252` 인덱스 존재)로 병기 가능.
2. **만료 미고지** — `TradingSignal.expiresAt`(= `validUntil`)가 이미 응답에 있음. 과거 BUY 에디션을 뉴스처럼 넘겨보면 만료된 추천을 유효 조언처럼 노출 → '지난 판단' 배너 필요.
3. **미래 vs 빈** — 미래 날짜를 `isEmpty:true`로 표기하면 '평가했으나 없음'을 거짓 함의. 별도 FUTURE 상태 필요.
4. **휴장 vs 조용** — 요일 휴리스틱은 공휴일(평일)을 QUIET로 오분류. backtest 시장캘린더 재사용으로 CLOSED와 구분.
5. **정체일 hero 간극** — 최신 에디션이 오늘과 N일 벌어질 때 간극을 hero에서 최우선 노출(라벨만으론 부족).

## 2. 오너 결정 (2026-07-16 확정)

| 결정 | 선택 | 함의 |
|---|---|---|
| 에디션 날짜 귀속 | **발행일(createdAt KST) 축 + 공시 접수일(rcpDt)·지연배지 병기** | 뉴스 '발행일' 은유 유지 + 실질 신선도 정직화. 간극 임계(≥2거래일) 시 '지연 반영' 배지 |
| 진행 순서 | **핫픽스 먼저 → 전체 재설계** | 카드 거짓말을 1개 작은 이슈로 즉시 차단 후 에디션 풀셋 |
| v1 범위 | **최소 코어** | 지면 그룹핑·발행 푸시·놓친호 뱃지는 후속 이슈로 분리 |

## 3. 재설계: 일일 투자판단 에디션 (신문 "호" 모델)

거래일 1일 = 신문 1호. 각 신호는 자기 발행일에 귀속 → 증상 A·B가 **구조적으로 소멸**(창이 하루로 좁혀지고, 헤더가 실제 날짜 상시 표기).

### 확정 설계 결정
- **네비게이션**: 패턴 A — 상단 **고정 가로 날짜 스트립**(오늘/어제/MM.DD, 건수 dot, 빈날 딤) + 그 날 세로 리스트. 세로 타임라인(SectionList sticky)·좌우 스와이프 pager는 Android Fabric 백지/제스처 회귀 리스크로 **v1 기각**(후속 이슈로만).
- **마이그레이션 0**: 기존 `@@index([createdAt])` + `market-data/candle-query`의 `tradeDateFromMs`/`KST_TIMEZONE` 재사용 + 목록은 `$queryRaw(AT TIME ZONE 'Asia/Seoul')`. `editionDate` 영속 컬럼 신설안은 두 비평이 과설계로 기각(성능 이득 0, 휴먼승인 마이그레이션 비용만).
- **백엔드 엔드포인트(조회 전용, JWT·Swagger)**:
  - `GET /signals/daily-editions?before=YYYYMMDD&limit=` — 판단 존재일만 최신순 목록(각 date/count/strongBuyCount/topGrade/headlineCorpName) + `latestDate`/`todayDate`/`todayHasEdition`/`nextCursor`/`hasMore`. 빈 날은 목록에 미포함(빈 날 발명 금지).
  - `GET /signals/daily/:date` — 그 KST 거래일 매수등급 랭킹 + meta(`isToday`/`isEmpty`/`emptyReason`(CLOSED/PENDING/QUIET/COLD_START/FUTURE)/`prevEditionDate`/`nextEditionDate`). `findAll` 매퍼(`items.map`·`sampleCountByEventType`) 재사용, `createdAt` 슬라이딩창 대신 폐구간 `[gteUtc,ltUtc)` 주입.
  - 두 엔드포인트 모두 `disclosure:{isBackfill:false}` 유지, `@Get(':id')` catch-all보다 위에 선언(라우트 충돌 방지).
  - 응답 item에 **`rcpDt`(공시 접수일) 추가** — 지연배지·귀속일 정직화 근거.
- **정직 규약**:
  - `SIGNAL_TERMS.homeHeader` 정적문자열 폐기 → `buildEditionTitle(dateISO, isToday)` SSOT 함수. 하드코딩 잔존 금지.
  - 절대 MM/DD **상시 병기**('N시간 전' 상대시간 단독 배지 폐기, `SignalFreshnessBadge` 정정). 공유 `<SignalDateBadge>`로 홈·에디션·explore 통일.
  - 빈 에디션 4분기 카피(다른 날로 안 채움, 폴백은 명시 CTA만): CLOSED(휴장)·PENDING(19시 전)·QUIET(조용)·COLD_START(전무). FUTURE는 별도.
  - 과거/만료(`expiresAt` 경과) 에디션: '지난 판단 · 현재 시세와 다를 수 있음' 배너 + muted + '오늘로' 리셋.
  - 휴장/조용 판정은 backtest 시장캘린더 재사용(공휴일 오분류 차단). 재사용 불가 시 요일+19:15 휴리스틱 폴백(공휴일 QUIET 오분류를 리스크로 기록).
- **홈 카드**: `HomeSignalPreview` → 최신 에디션 요약(날짜 라벨 최우선 + 상위 1~2 + 전체 진입). 정체일엔 'N일 전' 간극 hero 최우선. 게스트 잠금/스켈레톤/GuestPrompt(DAR-113) 분기 보존.
- **explore 유지**: 무한스크롤 탐색은 '아카이브' 보조로 유지하되 **모든 카드 날짜배지 필수**(교차일 신선도 모호성 차단).
- **캐시**: 홈이 에디션 훅으로 전환 시 `useCompanyBuySignal`이 공유하던 `buySignalsFeedKey`(UXR-23)가 안 채워짐 → 종목 배지를 기존 `GET /signals/by-corp/:corpCode`로 이관.

### M10 영향
파이프라인/데이터 무변경(읽기 API + UI만) → ~7/21 모의운용 졸업 측정 오염 없음.

## 4. Paperclip 이슈 레인 (BE 선행 직렬 → FE)

> **발행 완료(2026-07-16)**: S0=DAR-504 · S1=DAR-505 · S2=DAR-506 · S3=DAR-507 · S4=DAR-508 · S5=DAR-509 · S6=DAR-510 (전부 backlog·미할당 생성 — §7 인시던트 회피, 착수는 할당 시점부터)

- **S0 — 핫픽스(FE, 선행·독립)**: `buildEditionTitle` 도입해 `homeHeader` 정적 '오늘' 폐기 + `SignalPreviewCard`에 `createdAt` 날짜배지(M/D). 페이로드 기존 필드만 사용(rcpDt는 S1 후 병기). 카드 거짓말 즉시 차단.
- **S1 — BE**: `daily-editions`/`daily/:date` 엔드포인트 + 응답에 `rcpDt`·`expiresAt` 포함 + `emptyReason`(시장캘린더) + KST 경계/주말/공휴일/동점 tie-break 단위테스트. 마이그레이션 0. `findByCreatedRange` 추출 시 기존 `findAll` spec 그린 유지.
- **S2 — FE 공유**: `<SignalDateBadge>`(절대 MM/DD + 지연/만료 상태) + `signalTerms` 에디션 SSOT + `signalFreshness` 유틸.
- **S3 — FE 훅**: `useDailyEditions`/`useEdition(date)` + 인접일 프리페치 + `useCompanyBuySignal` → by-corp 이관.
- **S4 — FE 홈**: 홈 요약 교체 + 빈 4분기 + 정체 간극 hero + 게스트 분기 보존.
- **S5 — FE 신호탭**: 날짜 스트립 + 에디션 리스트 + 과거/만료 배너 + explore 배지. iOS(simctl)+Android(adb) 교차 렌더 검증 + `refreshing/onRefresh`만(커스텀 refreshControl 래퍼 금지) DoD.
- **S6 — 문서**: `docs/api-specification.md`·`docs/architecture.md`·`docs/workflow.md` 동기화.

### 후속(v1 제외, 별도 발행)
좌우 스와이프 pager · eventType 지면 그룹핑 · 발행 푸시(19:05) · 놓친 호 미읽음 뱃지 · 무한 아카이브 캘린더.

## 5. 잔여 리스크
- `$queryRaw`는 타입세이프티 밖 — row 명시 파싱(bigint COUNT→number), signal enum 상수 참조(하드코딩 금지).
- `AT TIME ZONE 'Asia/Seoul'`은 Postgres tzdata 의존 — prod/dev 컨테이너 tzdata 확인.
- 신규 리스트 화면 RN0.85 Fabric 백지 회귀(2026-06-07 전례) — 교차 렌더 검증 필수.
- 시장캘린더 재사용 실패 시 공휴일 QUIET 오분류(정직도 미세 하락).
