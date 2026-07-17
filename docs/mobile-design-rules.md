# 모바일 디자인 룰 정본 (SSOT)

> 목적: 산재해 있던 레이아웃·타이포·잘림 규칙을 **번호 룰(R-N)**로 통합한다. 신규 화면·컴포넌트 PR은 해당 룰 준수가 DoD.
> 위계: 루트 `CLAUDE.md`(RN 규칙) > 이 문서(디자인 세칙) > 개별 컴포넌트 주석. 토큰 정본: `mobile/theme/`.
> 작성: 2026-07-17 PM · 근거가 된 기존 결정: DAR-174/217/301/305/319/446 등 — 본 문서가 이를 승계·정본화한다.

## A. 텍스트 잘림·오버플로 (오너 보고 이슈의 직접 대상)

- **R-1 (한 줄 보장 3종 세트)**: 잘릴 수 있는 단일행 텍스트(기업명·라벨·버튼 카피)는 반드시 `numberOfLines={1}` + `ellipsizeMode="tail"` + 부모 `flexShrink:1, minWidth:0`을 함께 쓴다. 셋 중 하나라도 빠지면 행 넘침/단어 중간 줄바꿈/이웃 밀어내기가 발생한다.
- **R-2 (칩·배지 글꼴 배율 상한)**: 고정 높이 칩/배지/뱃지의 텍스트는 `maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}`(=1.3) 필수 — OS 큰 글꼴에서 한글 받침 세로 클리핑 방지. 높이는 `height` 고정 대신 `minHeight`(늘어날 여지)를 쓴다.
- **R-3 (행 내 우선순위)**: 한 행에 [가변 텍스트 + 고정 액션]이 공존하면 텍스트 쪽이 양보(`flexShrink:1`)하고 액션은 `flexShrink:0`으로 보호한다. 예: 세그먼트(양보) vs '전체보기'(보호).
- **R-4 (숫자 잘림 금지)**: 금액·점수·카운트는 절대 말줄임하지 않는다 — 배율 상한(R-2) 또는 컨테이너 확장으로 해결. 라벨을 줄이는 한이 있어도 수치는 온전히.
- **R-5 (2줄 허용 텍스트)**: 요약·설명류는 `numberOfLines={2}` + **고정 슬롯 예약**(빈 값이어도 같은 높이·`reserveCaptionSpace` 패턴) — 카드 간 세로 편차 제거.

## B. 타이포그래피

- **R-6 (토큰 전용)**: `fontSize`/`fontWeight`/`lineHeight` 하드코딩 금지 — `typography` 토큰(h1~small·amount)만. 새 크기가 필요하면 토큰 추가가 먼저.
- **R-7 (위계 3단 초과 금지)**: 한 카드 안 텍스트 위계는 최대 3단(주·부·메타). 4단째가 필요하면 카드가 과적 — 정보를 상세로 밀어낸다.
- **R-8 (lineHeight 동반)**: fontSize만 있고 lineHeight 없는 Text 금지 — 토큰이 쌍으로 공급한다(한글 클리핑·행간 붕괴 방지).

## C. 스페이싱·레이아웃

- **R-9 (spacing 토큰 전용)**: 마진·패딩 매직넘버 금지 — `spacing.xs~xl`, 모서리는 `radius.*`. 예외는 1px 헤어라인뿐.
- **R-10 (gap 우선)**: 형제 간격은 부모 `gap`으로 — 자식별 margin 지양(겹침·상쇄 버그원). 단 가로 캐러셀은 예외적으로 카드 `marginRight`(DAR-319, Android Fabric gap 미적용 대응).
- **R-11 (카드 균일 높이)**: 캐러셀·그리드의 카드들은 데이터 유무와 무관하게 같은 높이 — 결측 필드는 같은 지오메트리의 정직 결측 행("표본 통계 없음" 패턴)으로 채운다. 고정 `height` 금지, 슬롯 예약으로.
- **R-12 (가로 스크롤 봉인)**: 화면 본문이 가로로 밀리면 결함. 넓은 콘텐츠(표·코드)는 자체 `overflow` 컨테이너에 가둔다.

## D. 터치·접근성

- **R-13 (44pt)**: 터치 타깃 실효 영역 ≥44×44pt — 시각 크기를 못 키우면 `hitSlop`으로 확보(수직 확장 유틸 `verticalHitSlopForHeight`).
- **R-14 (a11y 어휘 일치)**: `accessibilityLabel`은 시각 헤더와 같은 위계 어휘(SIGNAL_TERMS 위계 규약). 카드형은 그룹 단위로 읽히게(`no-hide-descendants` + 카드 라벨 빌더).
- **R-15 (색 단독 의미 금지)**: 상태(선택·위험·만료)를 색으로만 구분하지 않는다 — 형태(칩·배지·아이콘)나 텍스트 동반.

## E. 색·테마

- **R-16 (테마 토큰 전용)**: `#hex` 하드코딩 금지 — `colors.*`만. 유일 예외는 `palette.white`류 정본 팔레트 참조.
- **R-17 (온컬러 규약)**: 그라데이션/스크림 위 전경은 테마 무관 `onColor` 계열 — 다크서 스크림과 surface 명도 충돌 방지(UXR L-1).

## F. 플랫폼·리스트 (크로스플랫폼 가드 승계)

- **R-18**: `refreshControl` 커스텀 래퍼 금지(ESLint 강제) — FlatList는 `refreshing`/`onRefresh`.
- **R-19**: `keyExtractor` 전역 고유(복수 축 데이터는 복합키/id) · 신규 리스트는 iOS+Android 교차 렌더 확인.
- **R-20**: 가로 스냅 캐러셀은 `snapToInterval=카드폭+gap`+`decelerationRate="fast"`+`getItemLayout`(고정폭일 때) 세트.

## 강제 수단

| 룰 | 가드 |
|---|---|
| R-1/R-3 | `check-corpname-single-line` 등 — **통합 스캐너 `check-design-rules`로 승격 예정** |
| R-2 | `check-chip-font-clip` |
| R-9/R-16 | lint + `check-contrast` |
| R-11 | `check-home-preview-card-uniform-height` |
| R-18 | ESLint `no-restricted-syntax` |

신규 PR DoD: 텍스트를 추가·수정하면 해당 룰 번호를 PR 본문에 명시(예: "R-1/R-2 적용").
