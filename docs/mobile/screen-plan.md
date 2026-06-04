# 모바일 앱 화면 기획 상세 — 전 기능 (M0~M12)

> 작성: PLANNER (DAR-20) · 작성일: 2026-06-05
> 상위 문서: [비전 및 원칙](../roadmap/00-vision-and-principles.md) · [실행 로드맵](../roadmap/01-execution-roadmap.md)
> 화면(UI) 역할 기준: [plan-screen.md](../roadmap/roles/plan-screen.md)
> 다음 단계 입력: DAR-21 (FE 개발)
> **⚠️ PLANNER 산출물 — docs/ 전용. 코드 변경 금지.**

---

## 목차

1. [정보구조(IA) & 네비게이션](#1-정보구조ia--네비게이션)
2. [신규 vs 기존 화면 구분](#2-신규-vs-기존-화면-구분)
3. [화면별 상세 정의](#3-화면별-상세-정의)
   - [M0 — 기존 화면 재사용 및 확장](#m0--기존-화면-재사용-및-확장)
   - [M3 — AI 분석 섹션 (공시 상세 확장)](#m3--ai-분석-섹션-공시-상세-확장)
   - [M4 — 시세·차트·지표 (기업 상세 확장)](#m4--시세차트지표-기업-상세-확장)
   - [M5 — Event Study (기업 상세 내 통계)](#m5--event-study-기업-상세-내-통계)
   - [M6 — 매수 Signal 피드 & 상세](#m6--매수-signal-피드--상세)
   - [M7 — Position Thesis & 포트폴리오](#m7--position-thesis--포트폴리오)
   - [M8 — Exit Signal & 매도 후보 피드](#m8--exit-signal--매도-후보-피드)
   - [M10 — 모의투자 & AI 비용 대시보드](#m10--모의투자--ai-비용-대시보드)
   - [M11 — 주문 승인 & 주문 이력](#m11--주문-승인--주문-이력)
   - [M12 — 자동매매 설정 & 모니터](#m12--자동매매-설정--모니터)
4. [우선순위 (P0~P2)](#4-우선순위-p0p2)
5. [AI 금지영역 & 면책 표현 가이드](#5-ai-금지영역--면책-표현-가이드)
6. [디자인 일관성 규칙](#6-디자인-일관성-규칙)
7. [수용 기준 체크리스트](#7-수용-기준-체크리스트)

---

## 1. 정보구조(IA) & 네비게이션

### 1-1. 탭 구조 (하단 탭바)

| 탭 | 아이콘 (Feather) | 라우트 | 도입 시점 | 배지 |
|---|---|---|---|---|
| **홈** | `home` | `/(tabs)/home` | M0 (기존) | — |
| **공시** | `bell` | `/(tabs)/notifications` | M0 (기존) | 미읽음 수 |
| **신호** | `zap` | `/(tabs)/signals` | M6 (신규) | 미결 주문 수 (M11~) |
| **포트폴리오** | `briefcase` | `/(tabs)/portfolio` | M7 (신규) | VIOLATED 포지션 수 |
| **설정** | `settings` | `/(tabs)/settings` | M0 (기존) | — |

> M6 이전: 홈 / 공시 / 설정 3탭 유지.
> M6 도입 시 "신호" 탭 추가 (4탭).
> M7 도입 시 "포트폴리오" 탭 추가 (5탭).

### 1-2. 전체 화면 계층 (Expo Router 경로)

```
app/
├── index.tsx                       ← 진입: 로그인 상태 분기
├── auth/
│   └── sign-in.tsx                 ← 카카오 로그인 [기존]
├── kakao.tsx                       ← 카카오 OAuth 리다이렉트 [기존]
├── onboarding/
│   └── index.tsx                   ← 4단계 온보딩 [기존 + M0 확장]
├── legal/
│   ├── terms.tsx                   ← 이용약관 [기존]
│   └── privacy.tsx                 ← 개인정보처리방침 [기존]
├── (tabs)/
│   ├── _layout.tsx                 ← 탭 레이아웃 [기존 + M6/M7 탭 추가]
│   ├── home/
│   │   └── index.tsx               ← 홈 피드 [기존 + M3/M6 카드 추가]
│   ├── notifications/
│   │   └── index.tsx               ← 공시 알림 피드 [기존]
│   ├── signals/
│   │   └── index.tsx               ← 매수·매도 신호 피드 [M6 신규]
│   ├── portfolio/
│   │   └── index.tsx               ← 포지션 목록 & 모의투자 [M7 신규]
│   └── settings/
│       └── index.tsx               ← 설정 메인 [기존 + M10/M12 항목 추가]
├── company/
│   └── [corpCode].tsx              ← 기업 상세 [기존 + M4 차트탭 + M5 통계탭]
├── disclosure/
│   ├── [id].tsx                    ← 공시 상세 [기존 + M3 AI섹션]
│   └── viewer.tsx                  ← 공시 원문 뷰어 [기존]
├── disclosures/
│   └── index.tsx                   ← 공시 목록 [기존]
├── signals/
│   └── [id].tsx                    ← 매수 후보 상세 [M6 신규]
├── portfolio/
│   └── [portfolioId]/
│       └── position/
│           └── [positionId]/
│               ├── index.tsx       ← 포지션 상세 [M7 신규]
│               └── thesis.tsx      ← Thesis 상세 [M7 신규]
├── orders/
│   ├── pending.tsx                 ← 주문 승인 대기 [M11 신규]
│   └── history.tsx                 ← 주문 이력 [M11 신규]
└── settings-detail/
    ├── watchlist.tsx               ← 관심목록 [기존]
    ├── saved-disclosures.tsx       ← 저장된 공시 [기존]
    ├── notification-settings.tsx   ← 알림 설정 [기존]
    ├── profile.tsx                 ← 프로필 [기존]
    ├── auto-trading.tsx            ← 자동매매 설정 [M12 신규]
    ├── auto-trading/
    │   └── monitor.tsx             ← 자동매매 모니터 [M12 신규]
    └── ai-cost.tsx                 ← AI 비용 대시보드 [M10 신규]
```

### 1-3. 핵심 사용자 플로우

**공시 → AI 분석 → 신호 확인 플로우**
```
공시 알림 푸시 수신
  → 탭 → 공시 상세 (/disclosure/[id])
    → [AI 분석 섹션] 요약·긍부정·Persona 해석 확인
    → [매수 신호 있음] → 매수 후보 상세 (/signals/[id])
      → Buy Score·근거·진입 조건 확인
      → (M11) [승인] → 주문 승인 대기 (/orders/pending)
```

**포트폴리오 추적 → 매도 신호 플로우**
```
포트폴리오 탭 → 포지션 목록 /(tabs)/portfolio
  → PositionCard 탭 → 포지션 상세
    → [Thesis 보기] → Thesis 상세 (thesis.tsx)
    → [Exit 신호] → 신호 탭 매도 서브섹션
      → ExitScoreCard 확인 → (M11) 매도 주문 승인
```

**모의투자 점검 플로우**
```
포트폴리오 탭 → "모의투자" 서브탭
  → PaperSummaryCard → 신호 적중률 확인
  → PaperTradeHistory 확인
  → (AI 비용 비교) → 설정 → AI 비용 현황
```

---

## 2. 신규 vs 기존 화면 구분

### 기존 화면 (재사용 / 확장)

| 화면 | 경로 | 현황 | 확장 내용 |
|------|------|------|---------|
| 로그인 | `/auth/sign-in` | 완성 | 변경 없음 |
| 온보딩 | `/onboarding/index` | 완성 | M0: 4단계 확장 (Persona 선택·고지 추가) |
| 홈 피드 | `/(tabs)/home` | 완성 | M3: AI 분석 카드 섹션 추가 / M6: BuyScoreCard 피드 섹션 추가 |
| 공시 알림 피드 | `/(tabs)/notifications` | 완성 | 변경 없음 |
| 설정 메인 | `/(tabs)/settings` | 완성 | M10: "AI 비용 현황" 항목 / M12: "자동매매 설정" 항목 추가 |
| 기업 상세 | `/company/[corpCode]` | 완성 | M4: "차트·지표" 탭 추가 / M5: "Event Study" 탭 추가 |
| 공시 상세 | `/disclosure/[id]` | 완성 | M3: AI 분석 섹션 추가 (하단 섹션) |
| 공시 목록 | `/disclosures/index` | 완성 | 변경 없음 |
| 공시 원문 뷰어 | `/disclosure/viewer` | 완성 | 변경 없음 |
| 관심목록 | `/settings-detail/watchlist` | 완성 | 변경 없음 |
| 저장된 공시 | `/settings-detail/saved-disclosures` | 완성 | 변경 없음 |
| 알림 설정 | `/settings-detail/notification-settings` | 완성 | 변경 없음 |
| 프로필 | `/settings-detail/profile` | 완성 | 변경 없음 |

### 신규 화면

| 화면 | 경로 | 도입 시점 | 우선순위 |
|------|------|---------|---------|
| 신호 피드 | `/(tabs)/signals` | M6 | P0 |
| 매수 후보 상세 | `/signals/[id]` | M6 | P0 |
| 포지션 목록 | `/(tabs)/portfolio` | M7 | P0 |
| 포지션 상세 | `/portfolio/[portfolioId]/position/[positionId]` | M7 | P0 |
| Thesis 상세 | `…/thesis` | M7 | P0 |
| 모의투자 서브탭 | `/(tabs)/portfolio` (서브탭) | M10 | P0 |
| AI 비용 대시보드 | `/settings-detail/ai-cost` | M10 | P1 |
| 주문 승인 대기 | `/orders/pending` | M11 | P0 |
| 주문 이력 | `/orders/history` | M11 | P1 |
| 자동매매 설정 | `/settings-detail/auto-trading` | M12 | P2 |
| 자동매매 모니터 | `/settings-detail/auto-trading/monitor` | M12 | P2 |

### 재사용 추천 컴포넌트

| 컴포넌트 | 현재 위치 | 재사용 대상 |
|---------|---------|-----------|
| `PersonaCard` | 온보딩 | 신호 피드 Persona 필터 |
| `CompanyChip` | 온보딩 | 신호 피드·포트폴리오 필터 |
| `NotificationCard` | 알림 피드 | 홈 피드 공시 카드 |
| `DisclosureCard` | 공시 목록 | 매수 후보 상세 "관련 공시" 섹션 |
| `StepIndicator` | 온보딩 | 주문 승인 카드 Risk 체크 진행 |
| `DisclaimerSection` | 온보딩 OB-03 | 모든 투자 판단 화면 하단 |

---

## 3. 화면별 상세 정의

---

### M0 — 기존 화면 재사용 및 확장

> 온보딩 4단계 상세는 [screen-onboarding.md](../work/m0/screen-onboarding.md) 참조.
> 이 섹션은 M0 확장 요약만 기록한다.

#### SCR-HOME — 홈 피드

**목적:** 관심 종목의 최신 공시·AI 분석 요약·신호 카드를 한 화면에서 확인한다.

```
┌─────────────────────────────┐
│  다트 알림  [검색]  [알림]    │  ← AppBar
│                             │
│  ── 오늘의 공시 ──           │  ← SectionHeader
│  ┌─────────────────────────┐ │
│  │ [기업명] 공급계약 체결    │ │  ← DisclosureCard (기존)
│  │ 13분 전  ●긍정           │ │
│  └─────────────────────────┘ │
│                             │
│  ── AI 분석 요약 ── (M3~)   │  ← M3 추가 섹션
│  ┌─────────────────────────┐ │
│  │ [기업명] Buy Score 78   │ │  ← BuyScoreSummaryCard
│  │ 공급계약 최근매출 24%    │ │
│  └─────────────────────────┘ │
│                             │
│  ── 매수 후보 ── (M6~)      │  ← M6 추가 섹션
│  [BuyScoreCard 2~3개 가로스크롤]│
│                             │
│  ── 포지션 상태 ── (M7~)    │  ← M7 추가 섹션
│  ┌─────────────────────────┐ │
│  │ 보유 3 · EXIT 신호 1    │ │  ← PortfolioSnapshotBanner
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

**상태:**
- 로딩: 스켈레톤 카드 3개
- 빈 상태: "관심 종목을 추가하면 맞춤 공시를 알려드려요." + [관심 종목 추가] 버튼
- 오프라인: 상단 `surfaceVariant` 배너 "오프라인 — 마지막 업데이트 시각 표시"
- 에러: Snackbar "피드를 불러오지 못했습니다. 아래로 당겨 새로고침."

**내비게이션:**
- DisclosureCard 탭 → `/disclosure/[id]`
- BuyScoreCard 탭 → `/signals/[id]`
- PortfolioSnapshotBanner 탭 → `/(tabs)/portfolio`

---

### M3 — AI 분석 섹션 (공시 상세 확장)

#### SCR-DISCLOSURE-AI — 공시 상세: AI 분석 섹션

**목적:** 기존 공시 상세 하단에 AI 요약·긍부정 요인·Persona 해석을 추가로 표시한다.

```
┌─────────────────────────────┐
│  [기존 공시 상세 영역]        │
│  원문 제목 / 기업명 / 시각     │
│  [원문 보기 버튼]             │
│                             │
│  ── AI 분석 ─────────────── │  ← SectionHeader (신규)
│                             │
│  "이 공시는 대규모 공급계약    │  ← SummaryText (최대 150자, 말줄임)
│   체결로 긍정적 모멘텀이..."   │  ← [더보기] 토글
│                             │
│  ● 긍정  [Chip: teal]        │  ← PolarityBadge
│                             │
│  긍정 요인                   │  ← FactorSection
│  ✓ 계약금액 최근 매출 24%    │  ← List.Item (feather: check-circle, green)
│  ✓ 거래상대방 대기업          │
│                             │
│  부정 요인                   │
│  ⚠ 단기 +18% 선행 급등       │  ← List.Item (feather: alert-circle, red)
│                             │
│  Persona 해석                │  ← PersonaInterpretationRow
│  [성장투자형] 매출 성장 기여   │  ← 선택된 Persona만 / 미선택 시 4개 탭
│                             │
│  ── ⚠ 비투자자문 고지 ──     │  ← DisclaimerSection (하단 고정)
│  AI 분석은 참고 정보입니다.   │
│  투자 결정의 책임은 본인에게.  │
└─────────────────────────────┘
```

**컴포넌트 명세:**

| 컴포넌트 | RN Paper 기반 | 상태·색상 |
|---------|-------------|---------|
| `PolarityBadge` | `Chip` (소형) | 긍정=`success`(green500) / 부정=`error`(red500) / 혼재=`warning`(yellow500) |
| `FactorList` | `List.Item` | 긍정: Feather `check-circle` / 부정: Feather `alert-circle` |
| `PersonaInterpretationRow` | `SegmentedButtons` (4 Persona) | 선택 Persona 활성화 |
| `SummaryText` | `Text` | 최대 150자 / 초과 시 `[더보기]` TextButton |
| `DisclaimerSection` | `Surface` + `Text` | `surfaceSecondary` 배경 / 항상 가시 |

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| AI 분석 로딩 중 | 스켈레톤 3행 (`SkeletonPlaceholder`) |
| AI 분석 없음 | "이 공시는 AI 분석 대상이 아닙니다." (Caption, textTertiary) |
| AI 분석 실패 | "분석을 불러오지 못했습니다. 나중에 다시 시도해 주세요." + [재시도] |
| 분석 진행 중 | `ActivityIndicator` + "AI 분석 생성 중..." |

**API 매핑:** `GET /api/disclosures/{id}/analysis` → `DisclosureAnalysis` DTO

---

### M4 — 시세·차트·지표 (기업 상세 확장)

#### SCR-COMPANY-CHART — 기업 상세: 차트·지표 탭

**목적:** 현재가·일봉 차트·기술지표(MA/RSI/거래량)를 제공해 공시를 가격 맥락에서 해석한다.

```
┌─────────────────────────────┐
│  ← 삼성전자 (005930) [저장] │  ← AppBar
│                             │
│  [공시] [차트·지표]           │  ← 탭 (SegmentedButtons 또는 Tab)
│                             │
│  삼성전자   005930   KOSPI   │  ← StockHeaderRow
│  87,400원  ▲ +1,200 (+1.4%) │  ← PriceChangeChip (green)
│                             │
│  [거래정지 배너] (해당시만)    │  ← StockStatusBanner (red100)
│                             │
│  [1W] [1M] [3M] [1Y]        │  ← PeriodSelector (SegmentedButtons)
│                             │
│  ┌─────────────────────────┐ │
│  │                         │ │
│  │    라인차트 영역          │ │  ← ChartArea (높이 220dp)
│  │    (일봉 라인차트)        │ │
│  │                         │ │
│  └─────────────────────────┘ │
│                             │
│  [MA20] [MA60] [RSI] [거래량] │  ← IndicatorToggleRow (Chip, 최대 3개 동시)
│                             │
│  IndicatorSummaryCard        │
│  MA20: 위 (+2.1%)           │
│  RSI: 62 (과매수 아님)       │
│  거래량: 20일 평균 181%↑     │
│                             │
└─────────────────────────────┘
```

**컴포넌트 명세:**

| 컴포넌트 | RN Paper / 기타 | 비고 |
|---------|----------------|------|
| `StockHeaderRow` | `Text` + `PriceChangeChip` | 종목명·코드·현재가·등락 |
| `PriceChangeChip` | `Chip` | 상승 `success` / 하락 `error` / 보합 `textTertiary` + Feather `trending-up`/`trending-down` |
| `StockStatusBanner` | `Banner` (RN Paper) | 거래정지 `error100` 배경 |
| `PeriodSelector` | `SegmentedButtons` | 1W/1M/3M/1Y |
| `ChartArea` | 라이브러리 TBD (FE 선택) | 높이 220dp, 축 레이블 양끝 정렬 |
| `IndicatorToggleRow` | `Chip` (outlined) | 최대 3개 동시 활성, 초과 탭 시 토스트 "최대 3개까지 선택 가능합니다" |
| `IndicatorSummaryCard` | `Card` + `Text` | 활성화된 지표 수치만 표시 |

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 시세 로딩 | 헤더·차트 영역 스켈레톤 |
| 데이터 없음 | "시세 데이터를 아직 수집하지 못했습니다." |
| API 오류 | "시세를 불러오지 못했습니다. 나중에 다시 시도." + [재시도] |
| 거래정지 | `StockStatusBanner`: "거래정지 종목입니다. 매수·매도가 불가합니다." (feather `alert-octagon`) |
| 관리종목 | `StockStatusBanner`: "관리종목 지정 — 상장폐지 위험이 있습니다." (red100) |
| 투자주의 | `StockStatusBanner`: "투자주의 종목 — 추가 확인이 필요합니다." (yellow100) |

**접근성:** `PriceChangeChip` → `accessibilityLabel="전일 대비 +1,200원 (+1.4%) 상승"`

**API 매핑:** `GET /api/companies/{corpCode}/price?period=1M` → `StockDailyPrice[]` + `TechnicalIndicator`

---

### M5 — Event Study (기업 상세 내 통계)

#### SCR-COMPANY-EVENTSTUDY — 기업 상세: Event Study 탭 (또는 섹션)

**목적:** 이 종목에서 과거 동일 이벤트 발생 시 주가 반응 통계를 표시해 신호 신뢰도를 판단한다.

```
┌─────────────────────────────┐
│  ← 삼성전자 (005930)          │
│  [공시] [차트·지표] [통계]    │
│                             │
│  공급계약 체결 이벤트 통계    │  ← 이벤트 유형 Chip
│  표본: 23건 기준             │  ← 표본 수 명시
│                             │
│  D+1   D+3   D+5   D+20    │  ← EventStudyTable
│  +0.8% +1.2% +2.1% +3.4%   │
│                             │
│  상승 확률: 70% (16/23건)    │  ← UpProbabilityRow
│  평균 최대낙폭: -2.3%        │  ← MaxDrawdownRow
│  시장 대비 초과수익 D+5: +1.5%│  ← AbnormalReturnRow
│                             │
│  ⚠ 표본 23건으로 통계 신뢰도가│  ← SampleSizeWarning
│  제한적입니다. 참고용으로만   │
│  활용하세요.                  │
│                             │
│  [세분화] 계약금액/매출 20%+  │  ← BucketSelector (Chip)
│  표본: 8건 (세분화 표본 부족  │
│  경고)                       │
└─────────────────────────────┘
```

**컴포넌트 명세:**

| 컴포넌트 | 형태 | 비고 |
|---------|------|------|
| `EventStudyTable` | `DataTable` (RN Paper) | D+1/3/5/20 컬럼, 수치 색상: 양수=`success`, 음수=`error` |
| `SampleSizeWarning` | `Banner` (yellow) | 표본 < 30건 시 자동 표시 |
| `BucketSelector` | `Chip` (outlined) | 세분화 버킷 선택 |

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 데이터 없음 | "이 이벤트 유형의 과거 통계가 아직 없습니다." |
| 표본 부족 (< 10건) | 테이블 표시하되 `SampleSizeWarning` "표본이 부족해 통계 신뢰도가 낮습니다." (강조) |

**숫자 포맷:** `"+X.X%"` 형식, 소수점 1자리, 표본 수는 항상 `"(N건 기준)"` 함께 표시.

---

### M6 — 매수 Signal 피드 & 상세

#### SCR-SIGNALS — 신호 피드 (`/(tabs)/signals`)

**목적:** 관심 종목 기준으로 생성된 `TradingSignal` 목록을 카드 형태로 표시한다.

```
┌─────────────────────────────┐
│  신호  [매수] [매도]         │  ← AppBar + 서브탭
│                             │
│  [성장투자형▼] [전체▼] [진입준비]│  ← FilterBar
│  Persona Chip / 등급 Chip / Toggle
│                             │
│  ┌─────────────────────────┐ │
│  │  [공급계약] 삼성전자    [강한매수]│
│  │  005930 · 공급계약 체결  │ │
│  │                         │ │
│  │  Buy Score: ███████░░░ 78│ │  ← ProgressBar (teal)
│  │                         │ │
│  │  공급계약금액이 최근 매출  │ │
│  │  대비 24%               │ │
│  │                         │ │
│  │  리스크: ⚠ 5거래일 +18% │ │
│  │                         │ │
│  │  ● 20일선 위  ● 거래량 3배│ │
│  │  ○ 전고가 돌파 미확인    │ │
│  │                         │ │
│  │  [상세보기]  공시발생: 13분 전│
│  └─────────────────────────┘ │
│                             │
│  ┌─ (BLOCKED 신호 예시) ───┐ │
│  │  [관망] 카카오           │ │  ← 배경 surfaceSecondary
│  │  조건 미충족 — 20일선 이탈│ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

**BuyScoreCard 컴포넌트 명세:**

| 요소 | RN Paper 컴포넌트 | 색상/상태 |
|------|----------------|---------|
| 카드 컨테이너 | `Surface` (elevation=2) | 테두리 `border` 1px |
| 이벤트 배지 | `Chip` (소형) | M2 이벤트 방향 색상 테이블 적용 |
| 신호 등급 배지 | `Chip` | STRONG_BUY=`success` / BUY=`primary`(teal500) / WATCH=`warning` / BLOCKED=`textTertiary` |
| Buy Score ProgressBar | `ProgressBar` | 0~29=`error` / 30~59=`warning` / 60~79=`primary` / 80↑=`success` |
| 진입 조건 | `List.Item` (아이콘) | 충족=● `success` / 미충족=○ `textTertiary` / 필수 미충족=○ `error` |
| BLOCKED 카드 | `Surface` | 배경 `surfaceSecondary`, `blockedReason` 텍스트 |

**필터바 컴포넌트:**

```
[성장투자형 ▼]  [전체 ▼]  [진입준비 OFF|ON]
 Persona 드롭다운  등급 드롭다운   entryReady 토글
```

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 로딩 | 스켈레톤 BuyScoreCard 3개 |
| 관심 종목 없음 | "관심 종목을 추가하면 매수 신호를 알려드려요." + [관심 종목 추가] |
| 신호 없음 | "현재 조건에 맞는 신호가 없습니다. 필터를 조정해 보세요." |
| 에러 | Snackbar + [재시도] |

**접근성:** `BuyScoreCard` → `accessibilityRole="button"`, `accessibilityLabel="삼성전자 매수 신호, Buy Score 78"`

---

#### SCR-SIGNAL-DETAIL — 매수 후보 상세 (`/signals/[id]`)

**목적:** 특정 `TradingSignal`의 Buy Score 구성 요소·진입 조건·리스크·관련 공시를 상세히 표시한다.

```
┌─────────────────────────────┐
│  ← 매수 후보 상세             │
│                             │
│  삼성전자  [강한매수]          │  ← HeaderSection
│  Buy Score: 78  유효: 2일 남음│
│                             │
│  ── Score 구성 ──            │  ← ScoreBreakdownSection
│  공시 이벤트    ████░  +18   │
│  핵심 수치      ████░  +16   │
│  Persona 적합   ███░░  +12   │
│  과거 유사 공시  ██░░░  +10   │
│  차트           ███░░  +12   │
│  거래량/수급     ████░  +14   │
│  시장/업종       ██░░░  +8    │
│  리스크 패널티          -12  │  ← 빨간 텍스트
│                             │
│  ── 진입 조건 ──             │  ← EntryConditionSection
│  필수  ✓ 현재가 20일선 위    │  ← 필수/선택 구분 표시
│  필수  ✓ 거래량 3배↑        │
│  선택  ○ 전고가 돌파 미확인  │
│                             │
│  ── 리스크 ──                │  ← RiskSection
│  ⚠ 5거래일 +18% 선행 급등   │  ← feather: alert-triangle
│  ⚠ 단기 과열 가능성          │
│                             │
│  ── AI 매수 근거 ──          │  ← SignalSummarySection
│  공급계약금액이 최근 매출 대비  │  ← AI 생성 텍스트
│  24%로 유의미한 매출 성장 기대│
│  "AI 분석 참고용"[레이블]     │  ← AI 레이블 필수
│                             │
│  ── 관련 공시 ──             │  ← RelatedDisclosureSection
│  [공시 카드] → /disclosure/[id]│
│                             │
│  ── 유효 기간 ──             │  ← ExpirySection
│  2026-06-07 23:59 만료       │
│                             │
│  ── ⚠ 투자자문 아님 ──       │  ← DisclaimerSection (하단 고정)
│  이 신호는 AI 분석 참고 정보  │
│  입니다. 투자 결정의 책임은   │
│  투자자 본인에게 있습니다.    │
└─────────────────────────────┘
```

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 로딩 | 전체 스켈레톤 |
| 신호 만료 | "유효 기간이 지난 신호입니다." Banner + 카드 내용 흐림 처리 |
| 에러 | "신호를 불러오지 못했습니다." + [재시도] |

**API 매핑:** `GET /api/signals/{id}` → `TradingSignal` DTO

---

### M7 — Position Thesis & 포트폴리오

#### SCR-PORTFOLIO — 포지션 목록 (`/(tabs)/portfolio`)

**목적:** 보유 포지션 전체를 한눈에 확인하고 Thesis 상태·Exit 신호를 즉시 파악한다.

```
┌─────────────────────────────┐
│  포트폴리오    [실전] [모의]  │  ← AppBar + 서브탭 (M10 추가)
│                             │
│  ── 리스크 스냅샷 ──         │  ← PortfolioRiskSnapshot (M8 추가)
│  총 손익: +4.2%  MDD: -1.8% │
│  오늘 손실 한도 잔여: 1.2%   │
│  [MDD 경고 배너] (초과 시만)  │
│                             │
│  총 평가금액: 15,420,000원   │  ← PortfolioSummaryCard
│  총 손익: +640,000원 (+4.3%) │
│                             │
│  ──────── 포지션 ───────    │
│                             │
│  [VIOLATED 포지션 우선 고정]  │
│  ┌─────────────────────────┐ │
│  │ 삼성전자   -2.3%         │ │  ← PositionCard
│  │ [VIOLATED] → 매도 검토  │ │  ← ThesisStatus 배지 (red)
│  │                   [→]  │ │
│  └─────────────────────────┘ │
│                             │
│  ┌─────────────────────────┐ │
│  │ SK하이닉스  +8.1%        │ │
│  │ [ACTIVE]               │ │  ← ThesisStatus 배지 (teal)
│  │                   [→]  │ │
│  └─────────────────────────┘ │
│                             │
│  ── 빈 포지션 ──             │
│  "보유 종목이 없습니다.       │
│   매수 후보 탭에서 신호를     │
│   확인하세요."               │
└─────────────────────────────┘
```

**PositionCard 컴포넌트:**

| 요소 | 색상/상태 |
|------|---------|
| 손익률 | 양수=`success` / 음수=`error` / 보합=`textTertiary` |
| ThesisStatus 배지 | ACTIVE=`primary`(teal) / WATCHING=`warning` / VIOLATED=`error` / EXPIRED=`textTertiary` |
| VIOLATED/EXPIRED 위치 | 리스트 최상단 고정 |

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 로딩 | 스켈레톤 PositionCard 3개 |
| 빈 포지션 | "보유 종목이 없습니다. 매수 후보 탭에서 신호를 확인하세요." |
| MDD 초과 경고 | `red100` 배너 "포트폴리오 손실 한도 초과 위험 — 포지션 점검이 필요합니다." |

---

#### SCR-THESIS — Thesis 상세

**목적:** "왜 샀는지"의 논리 구조와 현재 Thesis 상태를 표시한다.

```
┌─────────────────────────────┐
│  ← Thesis                  │
│                             │
│  [VIOLATED]                 │  ← ThesisStatus 배지 (red border)
│  삼성전자  ·  이벤트드리븐형  │
│                             │
│  ▌ 진입 논리               │  ← SectionHeader
│    ✓ 계약금액 최근 매출 24%  │  ← feather: check-circle (green)
│    ✓ 거래상대방 대기업       │
│    ✓ 공시 후 거래량 320%↑   │
│    ✓ 현재가 20일선 위        │
│                             │
│  ▌ 훼손 조건               │
│    ○ 계약금액 축소 정정공시  │  ← 미위반 (gray)
│    ○ 5거래일 내 거래량 급감  │
│    ● 20일선 종가 이탈 ← 위반│  ← 위반 (red, feather: x-circle)
│    ○ 시장 대비 초과수익 미달 │
│                             │
│  ▌ 청산 룰  [편집 불가]     │  ← 읽기 전용 표시
│    손절: -7.0%              │
│    분할익절: +12.0%         │
│    트레일링스탑: 고점 -6.0%  │
│    최대 보유: 20거래일       │
│                             │
│  ▌ 공시 트리거             │
│    [공시 카드] → 공시 상세   │
│                             │
│  ── ⚠ 투자자문 아님 ──     │  ← DisclaimerSection (하단 고정)
└─────────────────────────────┘
```

**상태별 색상:**

| Thesis 상태 | 보더 | 배지 배경 | 훼손 조건 색 |
|-------------|-----|---------|-----------|
| ACTIVE | `primary`(teal500) | `primaryContainer` | gray (미위반) |
| WATCHING | `warning`(yellow500) | `warningContainer` | gray |
| VIOLATED | `error`(red500) | `errorContainer` | red (위반 항목) |
| EXPIRED | `textTertiary`(gray300) | `surfaceVariant` | gray |

**규칙:** 청산 룰 수치(손절 %, 익절 %, 트레일링 스탑)는 읽기 전용. 탭 시 "이 값은 시스템이 관리하는 안전 한도로 변경할 수 없습니다." 토스트.

**접근성:** ThesisStatus 배지 → `accessibilityLabel="Thesis 상태: 훼손"`, 각 훼손 조건 → `accessibilityLabel="훼손 조건 위반: 20일선 종가 이탈"`

**API 매핑:** `GET /api/positions/{positionId}/thesis` → `PositionThesis` DTO

---

### M8 — Exit Signal & 매도 후보 피드

#### SCR-SIGNALS-EXIT — 신호 피드 매도 탭

**목적:** Exit 신호 목록을 ExitScoreCard로 표시해 매도 판단을 지원한다.

```
┌─────────────────────────────┐
│  신호  [매수] [매도]         │  ← 서브탭
│                             │
│  [전체▼] [오늘▼] [긴급 🔴 1] │  ← 긴급 탭에 빨간 배지
│                             │
│  ┌─────────────────────────┐ │
│  │ [REDUCE] 삼성전자        │ │
│  │ Exit Score: ████████ 72 │ │  ← ProgressBar (orange)
│  │                         │ │
│  │ 매도 근거:               │ │
│  │ 🔴 20일선 종가 이탈       │ │
│  │ 🔴 Thesis 훼손: 거래량 감│ │
│  │ 🟡 초과수익 0% 미달       │ │
│  │                         │ │
│  │ 권장: 50% 분할 매도      │ │  ← RecommendedAction Chip
│  │ 현재 손익: -2.3%         │ │
│  │                         │ │
│  │ [Thesis 보기] [나중에] [매도 검토]│
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

**ExitScoreCard 컴포넌트 명세:**

| 요소 | RN Paper | 색상 |
|------|---------|------|
| Exit Score ProgressBar | `ProgressBar` | 0~29=`success` / 30~49=`warning` / 50~69=`warning`(진한) / 70↑=`error` |
| 권장 액션 배지 | `Chip` | HOLD=`success` / WATCH=`warning` / REDUCE=`warning`(진한) / EXIT=`error`(굵게) / BLOCK_REBUY=`error`+feather:`slash` |
| 매도 근거 아이콘 | Emoji+Text | 손실/논리훼손=🔴 / 차트훼손=🟠 / 시간초과=🟡 |
| BLOCK_REBUY 배너 | `Banner` (red) | "재매수 차단됨 — 이 종목은 일정 기간 재진입이 차단됩니다." |

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 빈 Exit 신호 | "매도 신호 없음. 모든 포지션이 정상입니다." (feather: `check-circle` 아이콘) |
| 에러 | Snackbar + [재시도] |

**푸시 딥링크:** EXIT 신호 발생 → 푸시 수신 탭 → `/signals?tab=exit&highlight={signalId}`

---

### M10 — 모의투자 & AI 비용 대시보드

#### SCR-PAPER-PORTFOLIO — 모의투자 서브탭 (`/(tabs)/portfolio` 내)

**목적:** 실데이터 기반 가상 주문·체결·손익을 확인한다. "실전 전 약점 발굴" 컨텍스트를 항상 명시.

```
┌─────────────────────────────┐
│  포트폴리오  [실전] [모의]   │
│                             │
│  ┌─────────────────────────┐ │
│  │ 🔵 모의투자 중           │ │  ← PaperBanner (항상 표시)
│  │ 실제 돈이 투입되지 않습니다│ │
│  └─────────────────────────┘ │
│                             │
│  가상 총자산: 50,000,000원   │  ← PaperSummaryCard
│  가상 총손익: +1,240,000원   │
│  시작일: 2026-05-01 (35일째) │
│                             │
│  ── 신호 성과 ──            │  ← SignalMetricsSection
│  신호 적중률: 63% (19/30건) │
│  평균 보유일: 8.2일          │
│                             │
│  ── 가상 포지션 ──          │  ← PaperPositionList
│  [PositionCard 재사용]       │
│                             │
│  ── 최근 체결 이력 ──       │  ← PaperTradeHistory (최근 20건)
│  2026-06-05 삼성전자 매수    │
│  87,400원 × 10주  -874,000  │
│  2026-06-03 SK하이닉스 매도  │
│  +12.4%  +142,000           │
└─────────────────────────────┘
```

**컴포넌트 명세:**

| 컴포넌트 | 형태 | 비고 |
|---------|------|------|
| `PaperBanner` | `Banner` (blue100) | 항상 표시, 닫기 불가 |
| `PaperSummaryCard` | `Card` | 가상 자산·손익·시작일·경과 기간 |
| `SignalMetricsSection` | `List.Item` | 적중률·평균 보유일 |
| `PaperPositionList` | `FlatList` + PositionCard | 실전 PositionCard 재사용 |
| `PaperTradeHistory` | `DataTable` | 날짜/종목/유형/매수가/매도가/손익 |

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 모의투자 시작 전 | "모의투자를 시작하면 AI 신호 기반 가상 주문이 자동으로 진행됩니다." + [시작] |
| 로딩 | 스켈레톤 |
| 신호 없음 | "아직 실행된 모의투자 신호가 없습니다." |

---

#### SCR-AI-COST — AI 비용 대시보드 (`/settings-detail/ai-cost`)

**목적:** `AIUsageLog` 기반 AI 비용 추적. AI 비용이 수익보다 크면 시스템 의미 없음 원칙을 수치로 확인.

```
┌─────────────────────────────┐
│  ← AI 비용 현황              │
│                             │
│  이번 달 AI 비용: $3.82      │  ← CostSummaryCard
│  모의투자 순손익: $24.60     │
│  비용/수익 비율: 15.5%       │  ← 경고 색상 (10~20%: yellow)
│                             │
│  ── 비용/수익 게이지 ──      │  ← CostGaugeSection
│  [█████████░░░] 15.5%       │
│  목표: 10% 이하              │  ← 기준선 표시
│  현재 상태: 주의 (10~20%)    │  ← 텍스트로 색상 보완
│                             │
│  ── Level별 호출 비율 ──     │  ← UsageByLevelSection
│  L0 (미사용): 74%  ● 목표달성│
│  L1 (저비용): 15%            │
│  L2 (중간):   8%             │
│  L3 (고성능): 3%             │
│                             │
│  ── Task별 비용 ──           │  ← CostByTaskTable
│  Summary    120건  $1.44    │
│  EventClass  85건  $0.85    │
│  Persona     60건  $0.96    │
│  Thesis      15건  $0.57    │
│                             │
│  ── 일별 AI 비용 추이 ──     │  ← DailyTrendChart (30일)
│  [라인차트 영역]              │
└─────────────────────────────┘
```

**컴포넌트 명세:**

| 컴포넌트 | 형태 | 게이지 색상 |
|---------|------|-----------|
| `CostSummaryCard` | `Card` | 비율에 따라 수치 색상 변경 |
| `CostGaugeSection` | `ProgressBar` + `Text` | ≤10%=`success` / 10~20%=`warning` / >20%=`error` |
| `UsageByLevelSection` | `List.Item` | L0 ≥70% 시 `success` ● 달성 배지 |
| `CostByTaskTable` | `DataTable` | 호출 수·비용·평균 비용 |
| `DailyTrendChart` | 라인차트 TBD | 최근 30일, 목표 기준선(점선) 표시 |

**접근성:** `CostGaugeSection` → `accessibilityLabel="AI 비용 게이지 15.5%, 주의 구간"` (색상 단독 전달 금지)

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 데이터 없음 | "AI 분석이 아직 실행되지 않았습니다." |
| 비용 한도 초과 | `error100` 배너 "AI 비용이 수익 대비 20%를 초과했습니다. 호출 범위 조정이 필요합니다." |

---

### M11 — 주문 승인 & 주문 이력

#### SCR-ORDER-PENDING — 주문 승인 대기 (`/orders/pending`)

**목적:** Risk Engine 사전체크를 통과한 `OrderRequest`를 사용자가 승인/거절/관망한다.
**AI 금지 영역:** 승인 버튼은 단일 탭 즉시 실행 금지. 확인 모달 필수.

```
┌─────────────────────────────┐
│  ← 주문 승인 대기 (2건)      │
│                             │
│  ┌─────────────────────────┐ │
│  │ [매수 주문안]  삼성전자   │ │
│  │              Buy Score 78│
│  │ 시장가 매수              │ │
│  │ 10주   예상: 874,000원   │ │
│  │ 포트폴리오 비중: 4.2%    │ │
│  │ (한도 5% 이내)           │ │
│  │                         │ │
│  │ Risk 체크:               │ │
│  │  ✓ 종목 비중 한도 이내   │ │  ← feather: check-circle (green)
│  │  ✓ 당일 손실 한도 이내   │ │
│  │  ✓ 거래 가능 종목        │ │
│  │  ✓ 증권사 API 연결 정상  │ │
│  │                         │ │
│  │ AI 매수 근거 (요약):      │ │
│  │ 공급계약 최근매출 24%    │ │
│  │ [AI 분석 참고용 레이블]  │ │
│  │                         │ │
│  │ ⚠ 리스크: 5거래일 +18%   │ │
│  │                         │ │
│  │ 유효: [■■■■░░░] 15분 남음│ │  ← CountdownBar (15분부터 yellow)
│  │                         │ │
│  │[거절] [관망(스누즈)] [승인→]│
│  └─────────────────────────┘ │
│                             │
│  ── ⚠ 투자자문 아님 ──     │  ← DisclaimerSection (하단 고정)
└─────────────────────────────┘
```

**승인 버튼 UX 규칙 (AI 금지 영역 강제):**

```
[승인 →] 탭
  ↓
  확인 모달:
  "삼성전자 10주 시장가 매수를 실행합니다.
   이 결정의 책임은 본인에게 있습니다."
  [취소]  [실행]
  ↓ [실행] 탭
  "검증 중..." (로딩, Risk Engine 최종 체크)
  ↓ 통과
  주문 전송 완료 Snackbar
```

**카운트다운 규칙:**
- 유효 시간 > 3분: `primary`(teal)
- 유효 시간 3분~1분: `warning`(yellow) + 배너 "3분 후 만료됩니다"
- 유효 시간 < 1분: `error`(red) + 배너 "1분 후 만료됩니다"
- 만료: 카드 비활성화 + "이 주문안이 만료되었습니다." + [닫기]

**RISK_BLOCKED 상태:**
- 카드 전체 `surfaceSecondary` (회색)
- "Risk Engine이 이 주문을 거부했습니다. 사유: {blockedReason}"
- 승인 버튼 제거, [확인] 버튼만 표시

**매도 주문안:** 동일 카드 구조. `[매수 주문안]` → `[매도 주문안]`, Buy Score → Exit Score로 대체.

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 승인 대기 없음 | "현재 승인 대기 중인 주문이 없습니다." |
| 로딩 | 스켈레톤 |
| 승인 후 서버 거부 | "서버에서 주문을 거부했습니다. 사유: {reason}" Snackbar |

**딥링크:** `OrderRequest` 생성 시 푸시 → 탭 → `/orders/pending`

---

#### SCR-ORDER-HISTORY — 주문 이력 (`/orders/history`)

**목적:** 주문 이력과 체결 결과를 확인한다.

```
┌─────────────────────────────┐
│  ← 주문 이력                 │
│                             │
│  2026-06-05                 │  ← DateSection Header
│  ┌─────────────────────────┐ │
│  │ 삼성전자  매수  10주     │ │  ← OrderHistoryItem
│  │ 체결가: 87,400원         │ │
│  │ 상태: [체결]             │ │  ← 체결=green / 거절=red / 만료=gray / RISK_BLOCKED=orange
│  │ [감사 로그 보기 →]       │ │
│  └─────────────────────────┘ │
│                             │
│  2026-06-04                 │
│  ┌─────────────────────────┐ │
│  │ SK하이닉스  매도  5주    │ │
│  │ 체결가: 189,000원        │ │
│  │ 상태: [RISK_BLOCKED]     │ │
│  │ 사유: 당일 손실 한도 초과 │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

**상태:**

| 상태 | 화면 표현 |
|------|---------|
| 이력 없음 | "아직 처리된 주문이 없습니다." |

---

### M12 — 자동매매 설정 & 모니터

#### SCR-AUTO-TRADING — 자동매매 설정 (`/settings-detail/auto-trading`)

**목적:** 이벤트별 자동매매 활성화/비활성화·한도 설정·Kill Switch를 관리한다.

**진입 게이트 화면:**
```
┌─────────────────────────────┐
│  자동매매는 백테스트와 모의투자를│
│  통과한 전략에만 적용됩니다.  │
│                             │
│  ✓ 백테스트 완료 (M9)       │
│  ✓ 모의투자 30일 이상 (M10)  │
│  ✗ AI 비용/수익 < 20% 달성  │  ← 미충족 항목 빨간 표시
│                             │
│  [설정 진행]  (조건 미충족 시 비활성)│
└─────────────────────────────┘
```

**메인 설정 화면:**
```
┌─────────────────────────────┐
│  ← 자동매매 설정              │
│                             │
│  자동매매  [OFF | ON]        │  ← AutoTradingMasterSwitch (토글)
│  OFF 시 모든 하위 설정 비활성화│
│                             │
│  ── 허용 이벤트 ──           │  ← WhitelistEventSection
│  자기주식 취득·소각  [ON] ✓백테│  ← 이벤트별 토글 + 백테스트 통과 배지
│  대규모 공급계약    [OFF]     │
│  배당 확대         [OFF]     │
│                             │
│  ── 하드 리스크 룰 [읽기전용] ──│  ← HardRuleSummarySection
│  1회 주문 최대: 3%           │  ← 편집 불가 (회색 텍스트)
│  단일 종목 최대: 10%         │
│  1일 손실 한도: -2%          │
│  1주 손실 한도: -5%          │
│                             │
│  ─────────────────────────  │
│  ┌─────────────────────────┐ │
│  │  🔴 긴급 정지           │ │  ← KillSwitchSection
│  │  자동매매 즉시 중단      │ │  ← 빨간 배경, feather: power
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

**하드 리스크 룰 탭 처리:** "이 값은 시스템이 관리하는 안전 한도로 변경할 수 없습니다." 토스트.

---

#### SCR-AUTO-MONITOR — 자동매매 모니터 (`/settings-detail/auto-trading/monitor`)

**목적:** 자동 실행 중인 주문, 오늘 자동 체결 이력, 현재 리스크 상태를 실시간 확인한다.

```
┌─────────────────────────────┐
│  ← 자동매매 현황              │
│                             │
│  ┌─────────────────────────┐ │
│  │ 자동매매 ON              │ │  ← AutoTradingStatusBanner (green)
│  │ 오늘 자동 체결: 2건       │ │
│  └─────────────────────────┘ │
│                             │
│  ── 오늘 자동 체결 ──        │  ← TodayAutoTradeList
│  삼성전자 매수 10주 87,400원  │
│  SK하이닉스 매도 5주         │
│                             │
│  ── 리스크 현황 ──           │  ← RiskStatusSection
│  1일 손실 한도 사용: 0.3/2%  │  ← 게이지 green
│  연속 손실: 0회              │
│  시장 급락 차단: 미적용       │
│                             │
│  ── 자동 중단 이력 ──        │  ← AutoKillTriggerLog
│  (기록 없음)                 │
│                             │
│  ─────────────────────────  │
│  ┌─────────────────────────┐ │
│  │  🔴 긴급 정지           │ │  ← ManualKillSwitchButton (항상 최하단 고정)
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

**Kill Switch 확인 모달:**
```
"자동매매를 즉시 중단합니다.
 진행 중인 주문은 취소 요청됩니다."
[취소]  [중단]
```

**Kill Switch 작동 후 상태:**
- 화면 전체 `red100` 오버레이 배너: "자동매매 중단됨"
- 재개 안내: "[설정에서 자동매매를 다시 활성화하세요]" (링크)

---

## 4. 우선순위 (P0~P2)

### P0 — MVP 핵심 (M0~M10)

FE 구현 순서와 직결되는 핵심 화면. 이 화면들이 완성되어야 M10 졸업 게이트를 통과한다.

| # | 화면 | 경로 | 마일스톤 |
|---|------|------|---------|
| 1 | 온보딩 4단계 확장 | `/onboarding` | M0 |
| 2 | 공시 상세 AI 분석 섹션 | `/disclosure/[id]` (확장) | M3 |
| 3 | 기업 상세 차트·지표 탭 | `/company/[corpCode]` (확장) | M4 |
| 4 | 신호 피드 (`/(tabs)/signals`) | 신규 탭 | M6 |
| 5 | BuyScoreCard 컴포넌트 | 공통 컴포넌트 | M6 |
| 6 | 매수 후보 상세 | `/signals/[id]` | M6 |
| 7 | 포지션 목록 | `/(tabs)/portfolio` | M7 |
| 8 | Thesis 상세 | `.../thesis` | M7 |
| 9 | ExitScoreCard 컴포넌트 | 공통 컴포넌트 | M8 |
| 10 | 매도 후보 피드 (신호 탭 서브) | `/(tabs)/signals` (서브탭) | M8 |
| 11 | 모의투자 서브탭 | `/(tabs)/portfolio` (서브탭) | M10 |

### P1 — 운영 필수 (M10~M11)

시스템 안정 운영과 실주문 흐름을 위한 화면.

| # | 화면 | 경로 | 마일스톤 |
|---|------|------|---------|
| 1 | AI 비용 대시보드 | `/settings-detail/ai-cost` | M10 |
| 2 | 주문 승인 대기 | `/orders/pending` | M11 |
| 3 | 주문 이력 | `/orders/history` | M11 |
| 4 | Event Study 통계 탭 | `/company/[corpCode]` (확장) | M5 |

### P2 — 자동매매 (M12)

MVP 졸업 후, 백테스트·모의투자 검증 완료 후에만 구현.

| # | 화면 | 경로 | 마일스톤 |
|---|------|------|---------|
| 1 | 자동매매 설정 | `/settings-detail/auto-trading` | M12 |
| 2 | 자동매매 모니터 | `/settings-detail/auto-trading/monitor` | M12 |

---

## 5. AI 금지영역 & 면책 표현 가이드

### AI 분석이 표시되는 모든 화면 공통 규칙

1. **AI 레이블 필수:** AI 생성 콘텐츠 영역 옆에 항상 `"AI 분석 참고용"` 또는 `"AI 생성"` 레이블 표시.
2. **DisclaimerSection 하단 고정:** 투자 판단 관련 화면(M6~) 최하단에 항상 고정. 콘텐츠 스크롤로 가려져서는 안 됨.
3. **자동 타이머 승인 UI 금지:** 주문 승인 화면에서 X초 후 자동 승인 UI 절대 금지.
4. **AI가 수치 변경 불가:** 손절·익절·트레일링 스탑 등 하드 룰 수치는 편집 불가 필드.

### DisclaimerSection 표준 문구

```
이 서비스의 모든 분석·신호·점수는 AI 및 통계 모델이 생성한
참고 정보입니다. 특정 종목의 매수·매도를 권유하지 않으며,
투자 결정 및 손실·이익의 책임은 전적으로 투자자 본인에게
있습니다.
```

**표시 방법:** `Surface`(배경 `surfaceSecondary`) + `Text`(bodySmall, `textSecondary`) + Feather `alert-triangle` 아이콘.

### 화면별 AI 면책 배치 위치

| 화면 | 배치 위치 | 형태 |
|------|---------|------|
| 공시 상세 AI 섹션 | AI 분석 섹션 최하단 | 인라인 텍스트 |
| BuyScoreCard | 카드 하단 (2줄 축약) | Chip 형태 레이블 |
| 매수 후보 상세 | 화면 최하단 고정 | DisclaimerSection |
| Thesis 상세 | 화면 최하단 고정 | DisclaimerSection |
| ExitScoreCard | 카드 하단 (2줄 축약) | Chip 형태 레이블 |
| 주문 승인 카드 | 카드 하단 고정 | DisclaimerSection |
| 자동매매 설정 | 설정 화면 최하단 | DisclaimerSection |

### "AI 분석 참고용" 레이블 표준

```
[ℹ AI 분석 참고용]
```
- `Chip`(outlined, `textSecondary` 색상)
- Feather `info` 아이콘 + "AI 분석 참고용" 텍스트
- AI 생성 콘텐츠 블록 우상단 또는 하단 인라인 배치

---

## 6. 디자인 일관성 규칙

### 색상 토큰 (mobile/theme/colors.ts 준수)

| 의미 | 라이트 토큰 | 다크 토큰 | 사용처 |
|------|-----------|---------|------|
| 주요 액션·신호 | `primary` (teal500) | `primary` (indigo400) | 활성 탭·선택 상태·CTA 버튼 |
| 긍정·상승·통과 | `success` (green500) | `success` (green400) | 매수 신호·상승 수치·Risk 통과 |
| 경고·주의 | `warning` (yellow500) | `warning` (yellow400) | WATCH·중간 리스크 |
| 위험·하락·실패 | `error` (red500) | `error` (red400) | 하락 수치·VIOLATED·매도 긴급 |
| 비활성·중립 | `textTertiary` (gray400) | `textTertiary` | BLOCKED·EXPIRED·미충족 |
| AI 고지 배경 | `surfaceSecondary` | `surfaceSecondary` | DisclaimerSection |

**규칙:** 색상만으로 의미를 전달하는 UI 금지. 반드시 색상 + 텍스트 레이블 + 아이콘 중 최소 2가지 조합.

### 하드코딩 색상 금지

- `#XXXXXX`, `rgb(...)` 직접 사용 금지
- 반드시 `colors.primary`, `colors.success` 등 테마 토큰 사용
- `palette.teal500` 직접 참조 시 반드시 주석으로 이유 명시

### 컴포넌트 표준

| 요소 | 표준 컴포넌트 | 금지 |
|------|------------|------|
| 버튼 | RN Paper `Button` | 커스텀 `TouchableOpacity` 버튼 |
| 배지/태그 | RN Paper `Chip` | 커스텀 View |
| 카드 | RN Paper `Card` / `Surface` | 커스텀 View 카드 |
| 진행 표시 | RN Paper `ProgressBar` | 커스텀 View |
| 아이콘 | Feather 우선 | Ionicons 지양, NativeWind/Tailwind 금지 |
| 리스트 | `FlatList` / `FlashList` | `ScrollView` 안에 map() |

### Expo Router 네비게이션 규약

| 화면 유형 | 경로 패턴 |
|---------|---------|
| 탭 화면 | `/(tabs)/home`, `/(tabs)/signals`, `/(tabs)/portfolio`, `/(tabs)/settings` |
| 온보딩 | `/onboarding` (단일 파일, step state) |
| 공시 상세 | `/disclosure/[id]` |
| 기업 상세 | `/company/[corpCode]` |
| 신호 상세 | `/signals/[id]` |
| 포지션 상세 | `/portfolio/[portfolioId]/position/[positionId]` |
| Thesis 상세 | `/portfolio/[portfolioId]/position/[positionId]/thesis` |
| 주문 승인 대기 | `/orders/pending` |
| 주문 이력 | `/orders/history` |
| AI 비용 대시보드 | `/settings-detail/ai-cost` |
| 자동매매 설정 | `/settings-detail/auto-trading` |
| 자동매매 모니터 | `/settings-detail/auto-trading/monitor` |

### 접근성 최소 요건

- 모든 인터랙티브 요소: `accessibilityLabel`, `accessibilityRole`
- 터치 영역: 최소 44pt × 44pt
- 색상 단독 의미 전달 금지 (텍스트/아이콘 병행)
- 투자 판단 배지: `accessibilityLabel`에 상태·수치 텍스트 포함 (`"Buy Score 78, 매수 후보"`)
- Risk/상태 게이지: `accessibilityLabel`에 수치와 상태 명시 (`"AI 비용 게이지 15.5%, 주의 구간"`)

---

## 7. 수용 기준 체크리스트

### DoD (완료 조건)

이 문서가 완성된 것으로 간주되는 조건:

- [ ] 전 기능(공시·AI분석·시세·EventStudy·BuyScore·Thesis·포트폴리오·Exit·모의투자·비용·Risk) 화면 커버
- [ ] 각 화면에 목적·구성 요소·상태 정의·내비게이션·접근성 명세 포함
- [ ] 기존 `mobile/app/` 화면과 충돌·중복 없는 확장안
- [ ] API 매핑이 `docs/api-specification.md` 및 비전의 백엔드 기능과 일치 (TBD 항목 명시)
- [ ] 투자 판단 화면 게이트 체크리스트 충족:
  - [ ] DisclaimerSection 위치 예약
  - [ ] AI 생성 콘텐츠에 "AI 분석 참고용" 레이블
  - [ ] 주문 승인 버튼이 단일 탭 즉시 실행 구조가 아님 (확인 모달)
  - [ ] 하드 리스크 룰 수치가 편집 불가 필드
  - [ ] Kill Switch가 2탭 이내 접근 (M12)
- [ ] 코드(mobile/, backend/) 변경 0

### 기존 정책 충돌 여부

| 정책 문서 | 충돌 여부 | 비고 |
|---------|---------|------|
| plan-screen.md | 없음 | 이 문서는 plan-screen.md의 상세 구현이다 |
| plan-policy.md | 없음 | DisclaimerSection·AI 금지영역 규칙 준수 |
| mobile/CLAUDE.md | 없음 | Teal 테마·RN Paper·Feather 규칙 준수 |
| plan-scenario.md | 없음 | 플로우 진입·이탈 경로는 시나리오 기획과 정합 |

### 미결 항목 (TBD — FE 착수 전 확정 필요)

| 항목 | 담당 | 필요 시점 |
|------|------|---------|
| 차트 라이브러리 선택 (ChartArea) | FE | M4 착수 전 |
| 신호 피드 탭 위치 (홈 상단 섹션 vs 별도 탭) | FE + 사용자 논의 | M6 착수 전 |
| AI 비용 대시보드 접근 권한 (사용자 전용 vs 관리자 전용) | BE | M10 착수 전 |
| `GET /api/signals/{id}` 등 M6~M12 API 엔드포인트 상세 | BE | 각 마일스톤 착수 전 |
| 정책 기획 확정 비투자자문 고지 문구 | 정책 기획 | M6 카드 설계 전 |

---

*작성: PLANNER (DAR-20) · 2026-06-05 · feat/DAR-20 브랜치*
*다음 단계: 이 문서를 기반으로 DAR-21(FE 개발)이 화면별 구현을 착수한다.*
