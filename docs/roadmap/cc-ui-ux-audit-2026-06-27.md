# UI/UX 취약점 감사 & 처리 가이드라인 (2026-06-27)

> 범위: 모바일 앱(`mobile/`) 40개 화면 · ~85개 컴포넌트 전수 감사.
> 방법: 5개 화면 클러스터를 동일 8축 루브릭으로 병렬 감사, 코드 근거(file:line) 동반.
> 정본 디자인 시스템: `mobile/theme/{colors,spacing,typography}.ts` · 규칙: 루트 `CLAUDE.md`, `mobile/CLAUDE.md`.
> 이 문서는 **진단 + 우선순위 + 처리 가이드라인**이다. 실제 구현은 Paperclip 플릿이 이슈 단위로 수행한다.
>
> ✅ **처리 완료(2026-07-02 후속 검증)**: 아래 §0-1의 24건(DAR-445~470)은 **전부 구현·main 머지 완료**(후속 DAR-471/472 = PR #424/#425 오픈). 워크스트림 판정: W2·W3·W4·W6 완료 / W1·W5·W7 부분 — 잔여 항목과 신규 발견은 **후속 정본 [cc-ux-review-2026-07-02](./cc-ux-review-2026-07-02.md)** 를 볼 것. 아래 본문의 todo/in_progress 표기는 등록 당시 스냅샷이다.

---

## 0. 한 줄 결론 — 어디를 고치면 가장 효과적인가

> **앱은 "예쁘지만 못 읽힌다."** 시각 디테일(대비·터치·게이지 지오메트리)은 DAR 이슈로 이미 정교하게 다듬여 있으나, **(1) 핵심 화면이 개발자·운영자 언어로 말하고, (2) 진입점인 홈이 밀도로 코어를 묻고, (3) 공유 컴포넌트의 접근성/일관성이 빠져** 사용자 이해도와 첫인상에서 점수를 잃는다.

가장 효과적인 수정 위치를 3가지로 압축한다:

| 순위 | 가장 효과적인 "곳" | 왜 효과적인가 | 워크스트림 |
|---|---|---|---|
| 1 | **홈 탭 + 신호 탭 (이해도 레이어)** | 모든 사용자의 진입점·핵심 가치 화면인데, "M10/Sharpe/졸업/Buy Score" 같은 내부 용어를 설명 없이 던져 신규 사용자가 무슨 앱인지 즉시 이해 못 함. 고치면 첫인상·전환·이해도가 동시에 오름 | **W1 + W2** |
| 2 | **공유 컴포넌트 접근성 일괄** | `MenuItem`·피드 카드·서브 버튼의 a11y 라벨/44pt 터치영역 누락이 거의 모든 화면에 반복. **한 컴포넌트 수정 → 전 화면 파급**되는 최고 기계적 ROI | **W4** |
| 3 | **신호 상세의 점수 합계 모순(B3)** | 근거 합계(예 84점)와 헤더 최종점수(예 11점)가 정면 충돌 — 신뢰를 주려고 만든 섹션이 핵심 기능의 신뢰를 깬다. 좁지만 치명적 | **W3** |

---

## 0-1. 이슈 등록 현황 (Paperclip, 2026-06-27)

24건 등록·디스패치 완료(DEVELOPER `engineer` 할당, `todo`/`in_progress`). 우선순위 = 1차 high → 2차 medium → 3차 low. **파일별 1이슈(충돌 회피)**로 분해.

| DAR | 우선순위 | 워크스트림 | 주요 파일 | 발견 ID |
|---|---|---|---|---|
| **445** | high | W4 | settings/index.tsx | D1·D2·D3·D8·D9·D12 |
| **446** | high | W1·W2·W4 | home/index.tsx +home 컴포넌트 | A-HOME-1~6·A-MKT-1 |
| **447** | high | W3 | signals/[id].tsx·ScoreBreakdownSection | B2·B3·B10 |
| **448** | high | W1 | common/ScoreGauge.tsx (+InfoSheet) | B1·B5 |
| **449** | high | W4·W5 | signals/* 카드·리스트 | B4·B7·B8·B14 |
| **450** | high | W3·W4 | portfolio/EquityCurveChart·PerformanceSparkline | C4·C7 |
| **451** | medium | W1·W5 | portfolio/index.tsx·utils/portfolioTabs.ts | C1·C2·C12 |
| **452** | medium | W2·W6 | company/[corpCode].tsx | E1·E3·E4 |
| **453** | medium | W2 | disclosure/[id].tsx | E8·E9 |
| **454** | medium | W2·W5 | settings-detail/ai-cost.tsx | D6·D7·D4·D15 |
| **455** | medium | W5·W6 | profile·saved·collection·pro | D4·D5·D11·D13·D14 |
| **456** | medium | W2·W5 | disclosures/index.tsx | E10·E11 |
| **457** | medium | W5 | search/index.tsx·SearchOverlay.tsx | E12 |
| **458** | medium | W2·W1 | Daily/MinuteCandleChart·stock/[stockCode].tsx | E6·E7·E2 |
| **459** | medium | W2·W7 | portfolio/StrategyComparison·IntradayScalp | C6·C9 |
| **460** | medium | W2·W6 | auto-trading.tsx·backtest-track-record.tsx | C5·C8·C10 |
| **461** | medium | W4·W5 | portfolio/trade-history.tsx | C3·C11 |
| **462** | low | W6·W4 | onboarding/index.tsx | A-ONB-1~4 |
| **463** | low | W7·W2 | intro/index.tsx | A-NAV-1·A-INTRO-1~3 |
| **464** | low | W7·W4·W6 | auth/sign-in.tsx·app/index.tsx | A-SIGNIN-1/2·A-TOUCH-1·A-A11Y-1·A-IDX-1 |
| **465** | low | W2 | philosophy/[id].tsx | E15 |
| **466** | low | W2 | event-stats/index.tsx | E16 |
| **467** | low | W5 | company/Fundamentals·EventStudy·DecisionHub 탭 | E17 |
| **468** | low | W7 | notifications/index.tsx | D10 |

> 운용: DEVELOPER가 high→medium→low 순으로 `feat/<id>-<slug>` 브랜치+PR 구현 → `in_review` → 총괄(Claude) 통합검증(tsc·lint·iOS+Android 렌더) 후 머지. 충돌 시 동일파일 PR 순차 머지.

---

## 1. 횡단 패턴 (5개 클러스터에서 반복 관측된 구조적 결함)

개별 발견(부록 참조)을 합치면 7개의 횡단 패턴으로 수렴한다. **개별 화면이 아니라 패턴 단위로 고치는 것이 효과적이다.**

1. **전문용어/내부용어 누수** — `M10`·`Main Thesis B`·`Sharpe`·`졸업`(A), 무설명 `Buy/Exit Score`(B), `내 모의 vs 시스템 모의 vs 전략 vs 단타` 구분 부재(C), `L0비율·단위경제·강등`(D), `앱 환경 시계`·`백필 종목`(D·E). → **앱 전역이 운영자 언어로 말한다.**
2. **정보 밀도/위계 과부하** — 홈 헤더 카드 4~5개로 공시 피드 매몰(A), 점수 중복 표기(B), 전략 탭 과밀(C), AI비용 6블록(D), 기업상세 분봉 고정·공시상세 7섹션(E).
3. **접근성 — 44pt 터치영역 + a11y 라벨 누락** — 거의 모든 클러스터에서 보조 버튼 <44pt, `MenuItem`/카드/차트점에 role·label 없음.
4. **컴포넌트·패턴 드리프트** — `ScreenHeader` 있으나 5화면 자체 구현(D), 검색 3종(E), 로딩 3종(E), `DataLimitBadge` 중복(C), 미사용 `BuyScoreCard`에 개선 적용(B).
5. **상태 처리·새로고침 비일관** — 온보딩 에러/빈상태 부재(A), 무음 권한 실패(A), pull-to-refresh가 화면마다 있고 없음(C·D·E).
6. **신뢰 무결성 결함** — 점수 합계 모순(B), 색=의미 불일치(C), 실명+수치 예시 오해(A).
7. **토큰 위생** — 하드코딩 색상/알파/매직넘버, 이모지 사용(A·C·D·E).

---

## 2. 처리 워크스트림 (우선순위 = 효과 순)

각 워크스트림은 **이슈 1건 이상으로 분해 가능**하며, 수용기준(DoD)을 만족해야 완료다.
공통 DoD: `npm run lint` 통과 · 타입 에러 0 · iOS+Android 양쪽 렌더 확인(크로스플랫폼 가드, `mobile/CLAUDE.md`).

---

### W1 — 이해도 레이어: 용어 설명 + 내부용어 제거 〔최우선 · 효과 최대〕

**근거:** 핵심 가치 화면(신호·포트폴리오)과 진입점(홈)이 점수·트랙의 의미를 설명하는 장치가 0이다. `components/common/InfoSheet.tsx`가 **이미 존재** → 재사용해 빠르게 깐다.

**작업:**
- (W1-a) 1차 표면에서 개발/운영 용어 제거·평이어 치환: `M10`·`Main Thesis B`·`Sharpe`·`졸업 트래커`(A-HOME-1), `앱 환경 시계`→"실시간 시세 기준"(E7), `백필 종목`(D14), AI비용 태스크 영문 키→한국어 라벨(D7).
- (W1-b) 재사용 용어 설명 패턴: 점수 게이지/섹션 헤더 옆 `info` 아이콘 → `InfoSheet` 바텀시트(정의·등급 컷·"무엇을 보고 무엇을 하라"). 적용: Buy/Exit Score(B1), 모의/시스템 모의/전략/단타 구분(C1).
- (W1-c) 핵심 탭에 1줄 서브타이틀: 신호 탭(B13), 포트폴리오 트랙 그룹 라벨(C1).
- (W1-d) 신호 탭 첫 진입 1회 코치마크(점수 읽는 법). `FirstWatchCoachmark` 패턴 재사용.

**수용기준:** 1차 표면(홈·신호·포트폴리오 기본 뷰)에 설명 없는 영문/내부 용어 0건. 모든 점수·트랙 지표에 ≤1탭 거리의 설명 진입점 존재.
**관련 발견:** A-HOME-1, B1, B13, C1, D7, D14, E7 · **노력:** M

---

### W2 — 첫인상·정보위계: 홈 재배치 + 고밀도 화면 다이어트 〔최우선〕

**근거:** 홈은 100% 사용자가 보는 진입점인데 헤더에 시장배지+신호프리뷰+졸업트래커+퍼널+세그먼트가 쌓여 앱 코어(공시 피드)가 한참 아래로 밀린다.

**작업:**
- (W2-a) 홈 헤더 섹션을 2~3개로 축소, 공시 피드를 상단으로. 졸업/퍼널은 게스트 비표시 또는 `GuestPrompt` 치환(A-HOME-2, A-HOME-3). 핵심 통계 수치 위계 강화(`amount` 토큰, A-HOME-5).
- (W2-b) 기업 상세: 분봉 차트 고정 영역 → 탭 스크롤 안으로 편입 또는 접이식(E1). **모든 기업 방문에 영향, 단일 수정으로 6개 탭 동시 개선.**
- (W2-c) 공시 상세: 유사 "AI" 카드 2개 통합/명확 구분 + 섹션 우선순위 재배치(E8).
- (W2-d) AI비용: 사용자용 요약(이번 달 비용 1줄 + 한도 게이지 1개)만 기본, 운영 6블록은 "고급" 접기(D6).
- (W2-e) 공시 목록 필터 chrome 축약(E10), 전략 탭 카드 압축·미니차트 옵션화(C6).

**수용기준:** 홈 첫 스크린(스크롤 전)에 공시 피드 또는 신호 프리뷰 1개 이상 노출. 기업/공시/AI비용 화면 첫 스크린 고정 chrome ≤ 뷰포트 40%.
**관련 발견:** A-HOME-2/3/5, C6, D6, E1, E8, E10 · **노력:** L (이슈 분할 권장: 홈 / 기업상세 / 공시상세 / AI비용)

---

### W3 — 신뢰 무결성: 점수 모순·색의미·예시 오해 제거 〔높음 · 핵심기능〕

**근거:** 핵심 기능(신호)의 신뢰를 직접 깨는 결함. 가장 trust-critical.

**작업:**
- (W3-a) **점수 합계 모순(B3):** 근거 행을 "가중 후 기여" 또는 "기여도 %"로 정규화해 합계=헤더 최종점수 일치. 합계 행에 최종점수 동시 노출.
- (W3-b) 헤더 점수 중복 표기 제거 — `ScoreGauge` 하나로 통합(B2).
- (W3-c) 추세 색을 기울기 기반(`sparklineTrendColor`)으로 — "하락 중인데 초록" 제거(C7). 색맹 대비 라벨 동반.
- (W3-d) 인트로 예시 BuyScore의 실명(삼성전자/005930)+구체수치 → 가상 종목/일반화(A-INTRO-2).

**수용기준:** 신호 상세에서 근거 합계와 헤더 점수 불일치 0. 추세 색이 실제 기울기 부호와 항상 일치.
**관련 발견:** A-INTRO-2, B2, B3, C7 · **노력:** M

---

### W4 — 접근성 일괄: 공유 컴포넌트 a11y + 44pt 터치영역 〔높은 ROI · 파급 최대〕

**근거:** 한 번에 고칠 수 있는 공유 컴포넌트(`MenuItem`, 피드 카드, hitSlop 헬퍼)에 결함이 몰려 있어, **수정 1건이 수십 화면에 파급**된다.

**작업:**
- (W4-a) `MenuItem`(settings)에 `accessibilityRole="button"` + `accessibilityLabel`(title+subtitle) 추가 — 설정의 거의 모든 행 동시 개선(D2).
- (W4-b) 피드/신호/포지션 카드 `TouchableOpacity`에 role="button"+요약 라벨(A-HOME-6, A-ONB-3, A-A11Y-1, A-HOME-3/4).
- (W4-c) 공통 hitSlop/`minHeight:44` 헬퍼로 보조 버튼 일괄 보정: 둘러보기·건너뛰기·나중에(A-TOUCH-1), 정렬/필터 칩(B7), 빈상태 버튼(B14), 북마크 해제(D11), 공시 기업행(E9).
- (W4-d) 차트 데이터점 44pt 히트영역 오버레이 + 점별 a11y 라벨 — 자산곡선(C4)·캔들(E6, 장기구간 다운샘플/스크럽 별도 이슈).

**수용기준:** 1차 표면 인터랙티브 요소 유효 터치영역 ≥44pt. 카드·행·아이콘버튼에 의미있는 `accessibilityLabel`/`Role`. (검증: a11y inspector 또는 코드 리뷰 체크리스트.)
**관련 발견:** A-TOUCH-1, A-A11Y-1, A-HOME-3/4/6, A-ONB-3, B7, B14, C4, D2, D11, E6, E9 · **노력:** M (W4-a/b/c는 S 다수, W4-d 차트는 별도)

---

### W5 — 컴포넌트·패턴 일관성: 헤더/검색/로딩 통일 〔높은 ROI〕

**근거:** 정렬·학습성을 위해 만든 공통 컴포넌트가 일부 화면에서만 쓰여 드리프트. 통일은 품질 인상을 한꺼번에 끌어올린다.

**작업:**
- (W5-a) `ScreenHeader` 미사용 5화면(profile·saved-disclosures·collection-status·ai-cost·pro) 교체 — 백버튼 아이콘 Feather 통일(D4).
- (W5-b) 검색 3종(통합·관심기업·공시 인라인) placeholder·빈상태·디바운스 훅(`useDebounce`) 공통 규약으로 수렴(E11, E12).
- (W5-c) 로딩 3종(StateView 스피너·DetailSkeleton·SkeletonList) — 탭 콘텐츠도 스켈레톤으로 통일, 표준 1개 채택(E17).
- (W5-d) 위계·배경 토큰 불일치 정렬: 총평가금액 헤드라인 토큰 통일(C2), 진입 배너 2개 배경 통일(B9), 헤더 구분선 토큰(D10), 설정 탭 타이틀 "프로필"→"설정"(D1).
- (W5-e) 중복/미사용 정리: `DataLimitBadge` 일원화(C11), 미사용 `BuyScoreCard` 제거 또는 실제 카드와 역할 명확화(B11) — 단 이벤트 칩 대비 보강은 실제 카드(Curated/Explore)에도 적용(B4). FlatList 성능 props 공통화(B12).

**수용기준:** 헤더는 전 상세화면 `ScreenHeader` 사용. 검색 placeholder/빈상태/디바운스 패턴 1종. 로딩 인상 화면 내 일관.
**관련 발견:** B4, B9, B11, B12, C2, C11, D1, D4, D10, E11, E12, E17 · **노력:** M~L (이슈 분할: 헤더 / 검색 / 로딩 / 토큰정렬)

---

### W6 — 상태 처리·새로고침 일관 〔중간〕

**작업:**
- 온보딩 인기기업 목록 `isError`/빈배열 → `EmptyState`+재시도, `ListEmptyComponent`(A-ONB-1).
- 알림 권한 거부 시 토스트/인라인 안내(무음 실패 제거, A-ONB-2).
- pull-to-refresh 일관화: backtest·auto-trading·ai-cost·saved-disclosures·기업 일부 탭 — **RN 코어 `<RefreshControl>`만**(커스텀 래퍼 금지, 크로스플랫폼 가드)(C8, D5, D15, E3).
- 콜드스타트 로딩 화면 `colors.background`+`ActivityIndicator color={colors.primary}`(다크모드 흰 플래시 제거, A-IDX-1). 시장배지 로딩 자리표시(A-MKT-1).

**수용기준:** 데이터 화면 전부 빈/에러/로딩 3상태 보유. 갱신형 화면 전부 동일한 당겨서 새로고침.
**관련 발견:** A-IDX-1, A-MKT-1, A-ONB-1/2, C8, D5, D15, E3 · **노력:** S~M

---

### W7 — 토큰 위생 & 마무리 polish 〔낮음 · 일괄 처리〕

**작업:** 하드코딩 색상/알파 토큰화(A-SIGNIN-1/2, D13, E4) · 이모지 🥇→Feather `award`(C9) · ASCII divider→Divider 토큰(B10) · 로그아웃 확인 다이얼로그(D3) · 화면설정 cycle affordance+hint(D8) · "앱 정보" dead tap 제거(D9) · 저장공시 진입점 설정에 추가(D12) · 온보딩 back 동선(A-ONB-4) · 인트로 "카카오로 시작" 라벨-행동 정합(A-NAV-1) · 정렬 방향 명시(C12) · 게이지 카운트업 리스트 내 `animated={false}`(B5, 스크롤 체감 개선) 등.

**수용기준:** 하드코딩 `#hex`/알파 결합 0(`theme/colors.ts` 토큰만). 이모지 0(Feather 통일). 파괴적 액션(로그아웃) 확인 게이트.
**노력:** S 다수 — 1~2개 묶음 이슈로 일괄.

---

## 3. 권장 실행 순서

```
1차 (이번 스프린트, 효과/ROI 최상):
  W4 (접근성 공유컴포넌트 일괄)  ← 가장 빠른 파급, 기계적
  W1 (이해도 레이어)             ← 가장 큰 이해도 임팩트, InfoSheet 재사용
  W3 (신뢰 무결성, 특히 B3)      ← 핵심기능 신뢰 버그

2차:
  W2 (첫인상·위계 — 홈부터, 그다음 기업/공시/AI비용)
  W5 (헤더/검색/로딩 통일)

3차:
  W6 (상태·새로고침 일관)
  W7 (토큰위생·polish 일괄)
```

근거: W4·W1·W3은 "작은 수정 × 큰 파급/임팩트"라 ROI가 가장 높다. W2는 임팩트는 최상이나 화면별 재설계라 노력 L → 홈 단일 이슈부터 착수. W5~W7은 품질 정렬·마무리.

---

## 4. 반드시 지킬 가드레일 (구현 이슈 공통 제약)

- **색상은 `theme/colors.ts` 토큰만.** `#hex`/`rgba`/`color + '25'` 알파 결합 금지(W7로 청산). 컬러 표면 위 전경은 `onColor*` 토큰.
- **간격·반경·터치영역은 `theme/spacing.ts` 토큰.** `sizing.minTouchTarget=44` 기준.
- **타이포는 `theme/typography.ts` 토큰.** Dynamic Type 클램프(≤1.5) 준수, 칩/배지는 `MAX_CHIP_FONT_SCALE`.
- **리스트:** `FlatList`(+`keyExtractor`·`getItemLayout`·`initialNumToRender`). **`refreshControl` prop에 커스텀 래퍼 금지** — `refreshing`/`onRefresh` 또는 RN 코어 `<RefreshControl>`만(ESLint 강제, 백지화 회귀 방지). 정본: `docs/mobile-cross-platform-issues.md`.
- **아이콘 Feather 통일**(Ionicons·이모지 지양). **모든 UI 텍스트 한국어.**
- **iOS+Android 양쪽 렌더 확인**이 DoD(Android 단독 백지 회귀 차단).
- AI 산출물은 "참고" 표기 유지, 자동 승인 UI 신설 금지(정책 불변).

---

## 5. 부록 — 클러스터별 전체 발견 (이슈 작성 시 ID 참조)

> 심각도 P0(치명)·P1(높음)·P2(중간)·P3(낮음) / 노력 S(<2h)·M(반나절)·L(1일+).

### A — 첫인상 & 진입 퍼널 (home·intro·onboarding·sign-in)
| ID | 화면(file:line) | 심각도 | 문제 |
|---|---|---|---|
| A-HOME-1 | home/index.tsx:170-175, GraduationTracker.tsx:230, EntryFunnelSection.tsx:189 | P1 | 첫 화면에 M10/Sharpe/졸업/퍼널 등 내부·전문 용어 노출 |
| A-HOME-2 | home/index.tsx:164-259 | P1 | 헤더 카드 과적으로 공시 피드 매몰 |
| A-HOME-3 | home/index.tsx:173-174, GraduationTracker.tsx:223-269 | P1 | 게스트에게 인증 게이트 없이 모의운용 측정값 노출 |
| A-ONB-1 | onboarding/index.tsx:254-292 | P1 | 인기기업 목록 에러/빈상태 ListEmptyComponent 없음 |
| A-ONB-2 | onboarding/index.tsx:65-87 | P2 | 알림 권한 거부 시 무음 실패(피드백 없음) |
| A-ONB-3 | onboarding/index.tsx:270-289 | P2 | companyItem a11y role/label/selected 없음 |
| A-ONB-4 | onboarding/index.tsx:28-310 | P2 | 이전 단계 back 동선 없음 |
| A-NAV-1 | intro/index.tsx:368-373 | P2 | "카카오로 시작"이 카카오 시트 아닌 sign-in으로 이동(라벨-행동 불일치) |
| A-INTRO-1 | intro/index.tsx:48-280 | P2 | 고정 슬라이드 비스크롤 → 소형/큰글꼴 하단 클리핑 |
| A-INTRO-2 | intro/index.tsx:33-37,152-217 | P2 | 예시 BuyScore가 실명(삼성전자)+구체수치 → 실추천 오해 |
| A-INTRO-3 | intro/index.tsx:305-309 | P3 | 가로 FlatList getItemLayout 없이 scrollToIndex |
| A-SIGNIN-1 | auth/sign-in.tsx:225 | P2 | `rgba(255,255,255,0.5)` 하드코딩(onColorFaint 토큰 존재) |
| A-SIGNIN-2 | auth/sign-in.tsx:222-228 | P3 | fontSize:60·palette 인라인·고정 폭 |
| A-TOUCH-1 | sign-in.tsx:346-350, intro:553-560, onboarding:458-462 | P2 | 보조 버튼 실효 높이 ≈36pt(<44), hitSlop 없음 |
| A-A11Y-1 | sign-in.tsx:291-299 | P3 | guestButton a11y role/label 없음 |
| A-HOME-4 | home/index.tsx:358-386 | P3 | 헤더 통계 3개 중 1개만 a11y 라벨 |
| A-HOME-5 | home/index.tsx:368-384 | P3 | 핵심 수치를 h2(이름과 동크기)로 — 위계 약함 |
| A-HOME-6 | home/index.tsx:41-68, DisclosureFeedCard.tsx:41 | P2 | 피드 카드 a11y role="button"/label 없음 |
| A-IDX-1 | app/index.tsx:30-36 | P3 | 콜드스타트 로딩 배경 토큰 없음 → 다크 흰 플래시 |
| A-MKT-1 | MarketIndexBadge.tsx:98-99 | P3 | 로딩 시 null → 배지 삽입 시 레이아웃 점프 |

### B — 신호 (핵심 가치)
| ID | 화면(file:line) | 심각도 | 문제 |
|---|---|---|---|
| B1 | ScoreGauge.tsx:80-98, signalTerms.ts:33-36 | P1 | Buy/Exit Score 정의·등급밴드 설명 장치 전무 |
| B2 | signals/[id].tsx:268-283 | P1 | 같은 점수 텍스트+게이지 이중 표기, 헤더 3행 분산 |
| B3 | signals/[id].tsx:329-340, ScoreBreakdownSection.tsx:76-88 | P1 | 근거 합계(예84)와 최종점수(예11) 정면 모순 |
| B4 | CuratedSignalCard.tsx:96, SignalExploreCard.tsx:111 | P2 | 칩 대비 보강이 미사용 카드에만 적용, 실제 카드 누락 |
| B5 | ScoreGauge.tsx:62-78 | P2 | 리스트 게이지 매-마운트 카운트업(useNativeDriver:false) → 스크롤 산만/잼 |
| B6 | signals/index.tsx:44-46 | P2 | 매수=상세/매도=기업허브 비대칭 라우팅, 매도 상세 없음 |
| B7 | SignalExplorer.tsx:245,65 | P2 | 정렬/필터 칩 minHeight 30~34(<44), hitSlop 없음 |
| B8 | ExitScoreCard.tsx:156-158 | P2 | 매도 카드마다 AiReferenceLabel 반복(매수는 푸터 1회) |
| B9 | signals/index.tsx:64-101 | P2 | 동급 진입 배너 2개 배경 토큰 불일치 |
| B10 | signals/[id].tsx:346~388 | P3 | `── 진입 조건 ──` ASCII 장식 divider |
| B11 | BuyScoreCard.tsx 전체 | P3 | 미사용 컴포넌트가 "정본"처럼 남아 개선 오적용 |
| B12 | signals/index.tsx:211-228 외 | P3 | FlatList 윈도잉 props 3종 불일치 |
| B13 | signals/index.tsx:234-236 | P3 | 헤더 "신호"뿐 — 탭 목적 안내 0 |
| B14 | CurationSlot.tsx:98-106 | P3 | 빈상태 버튼 ≈36pt, hitSlop 없음 |

### C — 포트폴리오 & 모의/자동매매
| ID | 화면(file:line) | 심각도 | 문제 |
|---|---|---|---|
| C1 | utils/portfolioTabs.ts:21-29, portfolio/index.tsx:346-384 | P1 | 6개 서브탭 개념 중복, 구분 오리엔테이션 0 |
| C2 | index.tsx:185 vs 294 vs SimulationStatusSection.tsx:207 | P2 | 총평가금액 헤드라인 토큰 탭마다 다름(h1/h2) |
| C3 | trade-history.tsx:388-391 | P2 | warning 배경 위 흰 텍스트 대비 ~1.7:1(경고 안 보임) |
| C4 | EquityCurveChart.tsx:128-139 | P2 | 자산곡선 점 <44pt + 점별 a11y 없음 |
| C5 | auto-trading.tsx:182-208 | P2 | 1년 트랙레코드가 2단계 깊이에 매몰(발견성↓) |
| C6 | StrategyComparisonSection.tsx:329-338, IntradayScalpSection 전체 | P2 | 전략 탭 과밀(미니차트+지표+드릴다운) |
| C7 | EquityCurveChart.tsx:77, PerformanceSparkline.tsx:39-40 | P3 | 추세색=마지막점 부호 → 기울기와 불일치, 색맹 미대응 |
| C8 | backtest-track-record.tsx:236, auto-trading.tsx:229 | P3 | ScrollView 화면 pull-to-refresh 없음 |
| C9 | StrategyComparisonSection.tsx:37-48 | P3 | 🥇 이모지(Feather 컨벤션 이탈) |
| C10 | backtest-track-record.tsx:71-83 | P3 | 총수익률·승률 동일 크기(위계 동률) |
| C11 | trade-history.tsx:236-262 | P3 | 로컬 vs 공통 `DataLimitBadge` 중복 |
| C12 | index.tsx:103-114 | P3 | 수익률 정렬 오름차순(손실 큰 종목 최상단), 방향 불명 |

### D — 알림 & 설정
| ID | 화면(file:line) | 심각도 | 문제 |
|---|---|---|---|
| D1 | settings/index.tsx:124 | P2 | 설정 탭 헤더 타이틀이 "프로필"로 하드코딩(탭 정체성 충돌) |
| D2 | settings/index.tsx:35-43 | P2 | MenuItem a11y role/label 누락(설정 거의 전 행) |
| D3 | settings/index.tsx:110-112 | P2 | 로그아웃 확인 다이얼로그 없이 즉시 실행 |
| D4 | profile/saved/collection/ai-cost/pro 헤더 | P1 | ScreenHeader 미사용 5화면 자체 헤더(아이콘·폭·정렬 혼재) |
| D5 | saved-disclosures.tsx:139-151 | P2 | FlatList pull-to-refresh 미배선 |
| D6 | ai-cost.tsx 전체 | P1 | 운영자급 6블록 고밀도·내부용어 → 신규 이해 붕괴 |
| D7 | ai-cost.tsx:447-461 | P2 | task 영문 enum 키 그대로 렌더(한국어 위반 가능) |
| D8 | settings/index.tsx:221-235 | P2 | 화면/글자크기 cycle인데 affordance·hint 없음 |
| D9 | settings/index.tsx:263-269 | P3 | "앱 정보" dead tap(onPress 빈 함수) |
| D10 | notifications/index.tsx:288 외 | P3 | 헤더 구분선 토큰 분기마다 불일치 |
| D11 | saved-disclosures.tsx:76-83 | P3 | 북마크 해제 ≈36pt(<44) |
| D12 | settings/index.tsx:216-288 | P2 | "저장된 공시" 진입점 설정에 없음(발견성↓) |
| D13 | profile.tsx:72-73 | P3 | `colors.primary + '25'` 알파 결합(토큰 밖) |
| D14 | collection-status.tsx:194·216 | P3 | "백필 종목" 등 미설명 도메인 용어 |
| D15 | ai-cost.tsx:402-408 | P3 | pull-to-refresh 없음 + 기간 원시 문자열 미포맷 |

### E — 공시·기업·검색·철학 (콘텐츠 소비)
| ID | 화면(file:line) | 심각도 | 문제 |
|---|---|---|---|
| E1 | company/[corpCode].tsx:513-624 | P1 | 회사카드+분봉이 탭 위 고정 → 전 탭 뷰포트 절반 잠식 |
| E8 | disclosure/[id].tsx:289-421 | P1 | 7섹션 누적 + 거의 동일한 AI 카드 2개 혼동 |
| E12 | search/index.tsx:244, SearchOverlay.tsx:374, disclosures/index.tsx:264 | P2 | 검색 UI 3종(훅·placeholder·빈상태 제각각) |
| E6 | DailyCandleChart.tsx:169-172, MinuteCandleChart.tsx:145-148 | P2 | 장기구간 캔들 히트영역 ≈1px → 탭 무력화, 줌 없음 |
| E7 | MinuteCandleChart.tsx:166, stock/[stockCode].tsx:99-101 | P2 | "앱 환경 시계" 구현용어 노출 + 고지 중복 |
| E10 | disclosures/index.tsx:230-482 | P2 | 헤더+검색+필터2행+배너 chrome 다단 누적 |
| E15 | philosophy/[id].tsx:94-99,245-301 | P2 | FitRow가 종목마다 개별 쿼리(최대 30개 동시) |
| E17 | StateView vs DetailSkeleton vs SkeletonList | P2 | 로딩 처리 3종 혼재(탭 전환 시 스피너↔스켈레톤) |
| E2 | company:586-624, stock:130-153 | P3 | 분봉 차트·고지 인라인/풀스크린 중복 |
| E3 | company:668-777 | P3 | 탭별 pull-to-refresh 어포던스 불일치 |
| E11 | disclosures/index.tsx:158-199 | P3 | 디바운스 수동 구현(타 화면 useDebounce) |
| E16 | event-stats/index.tsx:130-136 | P3 | 5개 수치 컬럼 과밀 → 좁은 기기 절단 |
| E9 | disclosure/[id].tsx:257-285 | P3 | 기업명 행 ≈42pt(<44), hitSlop 없음 |
| E4 | company/[corpCode].tsx 다수 | P3 | JSX 인라인 스타일·매직넘버 |
| E14 | disclosure/viewer.tsx:110-126 | P3 | DART 데스크톱 HTML WebView 미최적·진행률 없음 |

---

*최종 수정일: 2026-06-27 · 작성: UI/UX 전수 감사(5클러스터 병렬) · 다음 단계: W4·W1·W3을 1차 이슈로 분해해 Paperclip 할당.*
