> 상위 문서: [역할 인덱스](./README.md) · [실행 로드맵](../01-execution-roadmap.md)

# 화면(UI) 기획 역할 문서

> 최종 수정일: 2026-06-02 · 작성 기준: 책임 매트릭스 R/C/· 기준 M0~M12

---

## 1. 역할 정의 & 책임 범위

### 이 파트가 소유하는 것

- **와이어프레임 & 화면 정의서:** 각 화면의 목적·레이아웃·컴포넌트 구성·상태(로딩/빈/에러)·내비게이션 경로를 문서화한다. FE 구현의 직접 입력이다.
- **정보구조(IA):** 화면 간 이동 구조, 탭·모달·딥링크 계층을 정의한다.
- **컴포넌트 명세:** 각 화면에 쓰이는 RN Paper 컴포넌트(Card, Chip, Button, Badge, FAB 등)와 Teal 테마 토큰(`lightColors`/`darkColors`)의 적용 방식을 명시한다. NativeWind/Tailwind는 사용하지 않는다.
- **상태 정의:** 로딩 스켈레톤·빈 화면(Empty State)·에러 화면·오프라인 상태의 레이아웃 정의.
- **접근성 명세:** 각 인터랙티브 요소의 `accessibilityLabel`, `accessibilityHint`, 색상 대비 기준.

### 다른 파트와의 경계

| 경계 | 내용 |
|------|------|
| **화면 기획 → FE 구현** | 화면 정의서를 확정해야 FE가 컴포넌트 구현을 시작한다. 기획 없이 FE 구현 선착수 금지. |
| **화면 기획 ← 시나리오 기획** | 사용자 여정(시나리오)과 화면 정의서는 병행 작성. 플로우 분기(엣지·빈 상태)는 시나리오가 정의하고 화면 기획이 레이아웃으로 반영. |
| **화면 기획 ← BE** | BE가 확정한 API 응답 구조(DTO) 기준으로 화면의 데이터 필드를 매핑한다. API 미확정 시 "TBD" 표시 후 착수. |
| **화면 기획 ← 정책 기획** | 리스크 고지·비투자자문 고지 문구는 정책 기획이 확정한 문장을 그대로 화면에 배치한다. 임의 문구 작성 금지. |
| **화면 기획 ↔ AI 파트** | AI 출력 결과(요약 문구·Thesis 항목·근거)가 표시되는 화면에서, 문구 길이·줄 수·말줄임 정책을 AI 파트와 사전 합의한다. |

### 3대 원칙·AI 금지 영역을 화면 기획 관점에서 지키는 방법

1. **AI는 보조, 결정은 사람:** AI 분석 결과(Buy Score 근거, Thesis 등)가 표시된 모든 화면에 "AI가 생성한 분석 참고용입니다. 투자 결정의 책임은 본인에게 있습니다." 문구를 정책 기획 확정 문장으로 포함시킨다. 이 문구를 제거하는 레이아웃 변경은 정책 기획의 승인 없이 처리하지 않는다.
2. **주문 승인은 사람이 직접:** M11 주문 승인 카드 화면에서 승인 버튼은 단일 탭으로 즉시 실행되지 않도록, 확인 다이얼로그(모달) 또는 슬라이드 제스처를 필수로 포함한다. 자동 타이머 승인 UI는 설계에서 제외한다.
3. **리스크 고지 위치 고정:** 모든 투자 판단 관련 화면(매수 후보 카드·Thesis 상세·주문 승인 카드)의 최하단 또는 섹션 하단에 리스크 고지 문구 영역을 예약한다. 콘텐츠 확장으로 고지 문구가 가려지는 레이아웃은 허용하지 않는다.

---

## 2. 마일스톤별 업무 (M0~M12)

---

### M0 — 기준선 & 수집 안정화 [주담당 R]

**이 역할이 할 구체 작업**

온보딩 화면을 새로 설계한다. 현재 앱에 관심기업 유도 온보딩이 존재하지만, 투자 시스템으로 확장되면서 **유니버스 선택(분석 대상 종목)**과 **Persona 선택** 화면이 추가로 필요하다.

- [ ] **온보딩 IA(정보구조) 확정:** 온보딩 플로우 — `온보딩A(서비스 소개)` → `온보딩B(유니버스·관심종목 선택)` → `온보딩C(Persona 선택)` → `온보딩D(알림 권한)` → `홈` 순서 확정. 스킵 허용 여부 및 재진입 경로 정의.
- [ ] **온보딩A — 서비스 소개 화면 정의서:**
  - 목적: 서비스가 무엇을 하는지(공시 기반 투자 리포트), 무엇을 하지 않는지(자동매매 금지, 투자자문 금지) 명확히 전달.
  - 구성: `IllustrationArea` + `Title`(한 줄) + `BodyText`(2~3줄) + `PrimaryButton(시작하기)`.
  - 상태: 단일 상태(에러/로딩 없음).
  - 비투자자문 고지 문구 배치 위치 예약(정책 기획 확정 후 삽입).
- [ ] **온보딩B — 유니버스·관심종목 선택 화면 정의서:**
  - 목적: 사용자가 분석받을 종목을 선택한다. 기존 `WatchList` 기능과 통합.
  - 구성: `SearchBar(자동완성)` + `SectionList(인기종목 추천)` + `SelectedChipRow(선택된 종목)` + `FooterButton(다음)`.
  - 상태: 로딩(스켈레톤 6행) / 빈 상태(검색 결과 없음) / 최소 1종목 미선택 시 FooterButton 비활성화.
  - 컴포넌트: `Searchbar`(RN Paper), `List.Item`, `Chip`(아웃라인), `Button`(contained).
  - 내비게이션: `router.push('/onboarding/persona')`.
- [ ] **온보딩C — Persona 선택 화면 정의서:**
  - 목적: 4가지 투자 Persona(가치투자형/성장주형/모멘텀형/이벤트드리븐형) 중 하나 선택.
  - 구성: `ProgressIndicator(3/4)` + `TitleText` + `PersonaCardList(4개)` + `FooterButton(완료)`.
  - PersonaCard 구성: Persona 이름(한국어) + 한 줄 설명 + 대표 이벤트 태그(Chip 1~2개) + 선택 상태(보더 강조, `primary` 색상).
  - 상태: 미선택 시 FooterButton 비활성화 / 선택 시 카드 보더 `teal500` 강조.
  - 다크모드: 선택 카드 배경 `teal900` / 미선택 `navy800`.
  - 접근성: 각 PersonaCard `accessibilityRole="radio"`, `accessibilityState.selected`.
- [ ] **온보딩D — 알림 권한 화면 정의서:**
  - 구성: `Icon(bell)` + `Title` + `BodyText` + `PrimaryButton(권한 허용)` + `TextButton(나중에)`.
  - 상태: 이미 허용된 경우 자동 스킵.
- [ ] **공시 알림 기존 화면 회귀 확인:** 기존 완성된 홈 피드·공시 상세·알림 히스토리 화면이 Persona 선택 이후 레이아웃에서 깨지지 않는지 목업 수준 확인.

---

### M1 — 공시 원문 파싱 [해당 없음 ·]

BE가 `DisclosureDocument` 파이프라인을 구축하는 단계. 화면 기획의 신규 산출물 없음.

**이 역할이 확인할 점:** M0에서 정의한 온보딩 화면 정의서가 BE의 API 응답 구조(Company 검색, WatchList 등록) 변경에 영향받지 않는지 확인. API 변경 시 온보딩B 컴포넌트 명세 업데이트.

---

### M2 — 이벤트·수치 추출 [해당 없음 ·]

`DisclosureEvent` 모델 설계 단계. 화면 기획의 신규 산출물 없음.

**이 역할이 확인할 점:** 이벤트 enum 15종(`SUPPLY_CONTRACT`, `SHARE_BUYBACK` 등)이 확정되면, M3(분석 결과 표시)·M6(매수 후보 카드)에서 사용할 이벤트 한국어 레이블 테이블을 미리 준비한다.

| eventType | 표시 이름 | 방향 색상 |
|-----------|-----------|-----------|
| SUPPLY_CONTRACT | 공급계약 체결 | green |
| CONTRACT_CANCELLATION | 공급계약 해제 | red |
| SHARE_BUYBACK | 자사주 취득 | green |
| SHARE_CANCELLATION | 자사주 소각 | green |
| DIVIDEND_INCREASE | 배당 증가 | green |
| DIVIDEND_CUT | 배당 감소 | red |
| PAID_IN_CAPITAL_INCREASE | 유상증자 | red |
| THIRD_PARTY_ALLOTMENT | 제3자 배정 증자 | red |
| CB_ISSUANCE | 전환사채 발행 | red |
| BW_ISSUANCE | 신주인수권부사채 | red |
| EARNINGS_SURPRISE | 실적 서프라이즈 | green |
| EARNINGS_SHOCK | 실적 쇼크 | red |
| MAJOR_SHAREHOLDER_CHANGE | 주요주주 변동 | gray |
| LAWSUIT | 소송 | red |
| AUDIT_OPINION_RISK | 감사의견 위험 | red |

---

### M3 — AI Analyst + 비용계측 토대 [협업 C]

AI 분석 결과(`DisclosureAnalysis`)를 화면에 처음으로 표시한다.

**이 역할이 할 구체 작업**

- [ ] **공시 상세 화면 — AI 분석 섹션 레이아웃 정의:**
  - 기존 공시 상세 화면(원문 WebView 포함)에 AI 분석 섹션을 추가하는 레이아웃 정의.
  - 구성: `SectionHeader("AI 분석")` + `SummaryText(2~3줄, 말줄임 처리)` + `PolarityBadge(긍정/부정/혼재)` + `FactorList(긍정 요인·부정 요인 각 최대 3개)` + `PersonaInterpretationRow`.
  - PersonaInterpretationRow: 사용자 선택 Persona의 해석만 표시. 미선택 시 전체 4개 탭.
  - 상태: AI 분석 로딩 중(스켈레톤 3행) / AI 분석 없음("이 공시는 AI 분석 대상이 아닙니다") / 에러("분석 실패, 나중에 다시 시도").
  - 비투자자문 고지 문구 영역 하단 고정(정책 기획 문구 삽입 예정 위치).
- [ ] **AI 분석 섹션 컴포넌트 명세:**
  - `PolarityBadge`: `Chip`(RN Paper), 긍정=`green500` / 부정=`red500` / 혼재=`yellow500`.
  - `FactorList`: `List.Item`(아이콘 Feather `check-circle` 긍정, `alert-circle` 부정).
  - 텍스트 길이 제한: 요약 최대 150자, 각 요인 최대 60자. 초과 시 "더보기" 토글.

---

### M4 — 시세·시장 데이터 (KRX) [협업 C]

시세·차트 데이터가 도입되는 단계. 화면 기획은 종목 상세 화면의 차트 영역을 설계한다.

**이 역할이 할 구체 작업**

- [ ] **종목 차트·지표 화면 정의서 (기업 상세 화면 확장):**
  - 목적: 현재가·일봉 차트·기술지표(MA/RSI/MACD)를 제공해 사용자가 공시를 가격 맥락에서 해석한다.
  - 구성 영역:
    - `StockHeaderRow`: 종목명 + 종목코드 + 현재가 + 전일 대비 등락폭(등락률, Feather `trending-up`/`trending-down`).
    - `PriceChangeChip`: 등락률 Chip — 상승 `green500`, 하락 `red500`, 보합 `gray400`.
    - `ChartAreaPlaceholder`: 일봉 라인차트 영역(높이 220dp). 차트 라이브러리 선택은 FE 담당이나, 화면 기획에서 높이·여백·축 레이블 위치를 확정.
    - `PeriodSelector`: 1W / 1M / 3M / 1Y 탭(RN Paper `SegmentedButtons`).
    - `IndicatorToggleRow`: MA20 / MA60 / RSI / 거래량 토글 Chip. 최대 3개 동시 활성화.
    - `IndicatorSummaryCard`: 현재 선택된 지표 수치 요약(MA 위/아래, RSI 수치, 거래량 vs 20일 평균).
    - `StockStatusBanner`: 거래정지·관리종목·투자주의 상태일 때 `red100` 배너 표시.
  - 상태: 시세 로딩(스켈레톤) / 데이터 없음 / API 오류 / 거래정지 배너.
  - 내비게이션: 기업 상세(`/company/[corpCode]`) 화면에 탭 형태로 "공시" / "차트·지표" 탭 추가.
  - 접근성: `PriceChangeChip`에 `accessibilityLabel="전일 대비 +2.3% 상승"` 형태로 숫자와 방향 명시.

---

### M5 — Event Study [해당 없음 ·]

DQ 파트의 통계 계산 단계. 화면 기획의 신규 산출물 없음.

**이 역할이 확인할 점:** Event Study 결과(`EventStudyResult`)는 M6 매수 후보 카드의 "과거 유사 공시 성과" 데이터로 사용된다. 이 데이터의 표시 형식(D+5 평균 수익률, 상승 확률 등)을 사전에 정의해 FE와 공유해야 함. 숫자 포맷: "+X.X%", 상승 확률: "상승확률 X%", 표본 수: "(N건 기준)".

---

### M6 — 매수 Signal Engine [주담당 R]

**이 역할의 핵심 산출물.** 매수 후보 카드 화면 정의서를 확정해야 FE가 구현에 착수할 수 있다.

**이 역할이 할 구체 작업**

- [ ] **매수 후보 피드 화면 정의서:**
  - 목적: 관심 종목 기준으로 생성된 `TradingSignal` 목록을 카드 형태로 표시한다.
  - 내비게이션 위치: 하단 탭에 "신호" 탭 추가 또는 홈 피드 상단 섹션으로 삽입 — FE와 합의 후 확정.
  - 필터 바: Persona 선택 Chip + 신호 등급 필터(전체/강한매수/매수/관심) + entryReady 토글.
  - 리스트: `FlatList`(무한 스크롤), 각 아이템 = BuyScoreCard.
  - 상태: 로딩(스켈레톤 카드 3개) / 빈(관심 종목 없음 or 신호 없음, 각각 다른 Empty State) / 에러.

- [ ] **BuyScoreCard 컴포넌트 명세 (M6 핵심 산출물):**

  ```
  ┌──────────────────────────────────────────────┐
  │  [이벤트배지]  종목명          [신호등급배지]  │
  │  종목코드 · 이벤트 유형 한국어 레이블           │
  │                                              │
  │  Buy Score: ███████░░░ 78                    │
  │             (ProgressBar, teal500)           │
  │                                              │
  │  [핵심 매수 근거] (최대 2줄)                  │
  │  공급계약금액이 최근 매출 대비 24%             │
  │                                              │
  │  리스크:  ⚠ 5거래일 +18% 선행 급등           │
  │                                              │
  │  진입조건:  ● 20일선 위  ● 거래량 3배↑       │
  │            ○ 전고가 돌파 미확인               │
  │                                              │
  │  [상세보기]              공시발생: 13분 전     │
  └──────────────────────────────────────────────┘
  ```

  - 컴포넌트 매핑:
    - 카드 컨테이너: `Surface`(RN Paper, elevation=2), 보더 `border`.
    - 이벤트배지: `Chip`(소형), 색상은 M2에서 정의한 이벤트 방향 색상 테이블 적용.
    - 신호등급배지: `Chip`, STRONG_BUY_CANDIDATE=`green`, BUY_CANDIDATE=`teal500`, WATCH=`yellow`, BLOCKED=`gray`.
    - Buy Score ProgressBar: 0~100, `ProgressBar`(RN Paper). 0~29 `red`, 30~59 `yellow`, 60~79 `teal400`, 80↑ `green500`.
    - 진입조건 항목: 충족 ● `green`, 미충족 ○ `gray`. 필수 미충족 항목은 `red`.
    - BLOCKED 신호: 카드 전체 배경 `surfaceSecondary`(흐리게), `blockedReason` 텍스트 표시.
    - entryReady=false인 경우: "조건 미충족 — 관망" Chip 표시.

- [ ] **매수 후보 상세 화면 정의서:**
  - 목적: 특정 `TradingSignal`의 Buy Score 구성 요소, 진입 조건, 리스크, 관련 공시를 상세히 표시.
  - 구성:
    - `HeaderSection`: 종목명 + Buy Score + 신호 등급.
    - `ScoreBreakdownSection`: 7개 컴포넌트 점수 가로 막대 그래프 + 패널티. FE는 `scoreBreakdown` JSON 사용.
    - `EntryConditionSection`: 조건별 충족 여부 체크리스트. 필수/선택 구분 표시.
    - `RiskSection`: 리스크 요인 목록(`riskFactors`), Feather `alert-triangle` 아이콘.
    - `SignalSummarySection`: AI 생성 매수 근거 요약(`signalSummary`).
    - `RelatedDisclosureSection`: 트리거 공시 카드 → 공시 상세 내비게이션.
    - `ExpirySection`: 유효 기간 표시(`validUntil`).
    - `DisclaimerSection`: 비투자자문 고지(하단 고정).
  - 상태: 로딩 / 신호 만료("유효 기간이 지난 신호입니다") / 에러.
  - 내비게이션: `router.push('/signals/[id]')`.

---

### M7 — Position Thesis [주담당 R]

`PositionThesis` 데이터를 화면에 표현한다. 매수 근거·훼손 조건·청산 룰을 사용자가 명확히 이해할 수 있어야 한다.

**이 역할이 할 구체 작업**

- [ ] **Thesis 상세 화면 정의서:**
  - 목적: 특정 포지션에 대한 "왜 샀는지"의 논리적 구조와 현재 Thesis 상태를 표시한다.
  - 내비게이션: `/portfolio/[portfolioId]/position/[positionId]/thesis`.

  ```
  ┌──────────────────────────────────────────────┐
  │  [ACTIVE/WATCHING/VIOLATED/EXPIRED]          │
  │  종목명 · Persona 태그                        │
  │                                              │
  │  ▌ 진입 논리                                  │
  │    ✓ 계약금액 최근 매출 대비 24%              │
  │    ✓ 거래상대방 대기업, 계약 안정성 높음       │
  │    ✓ 공시 후 거래량 20일 평균 320%↑          │
  │    ✓ 현재가 20일선 위 상승 추세               │
  │                                              │
  │  ▌ 훼손 조건 (논리 깨지면 매도 검토)          │
  │    ○ 계약금액 축소·취소 정정공시              │
  │    ○ 공시 후 5거래일 거래량 급감              │
  │    ● 20일선 종가 이탈 지속 ← 현재 위반        │
  │    ○ 시장 대비 초과수익 미달                  │
  │                                              │
  │  ▌ 청산 룰                                   │
  │    손절: -7.0%  분할익절: +12.0%             │
  │    트레일링스탑: 고점 -6.0%                  │
  │    최대 보유: 20거래일                        │
  │                                              │
  │  ▌ 공시 트리거                               │
  │    [공시 카드 연결]                           │
  │                                              │
  │  [리스크 고지 문구 — 하단 고정]               │
  └──────────────────────────────────────────────┘
  ```

  - 상태별 색상:
    - ACTIVE: `teal500` 보더 / ThesisStatus 배지 배경 `teal100`.
    - WATCHING: `yellow500` 보더 / 배지 배경 `yellow100`.
    - VIOLATED: `red500` 보더 / 배지 배경 `red100`. 훼손된 조건 항목은 `red500` Feather `x-circle`.
    - EXPIRED: `gray300` 보더 / 배지 배경 `gray100`.
  - 훼손 조건 항목: 충족(아직 안 깨진) ○ `gray` / 위반(깨진) ● `red`.
  - 청산 룰 수치: 고정값. AI가 수치를 변경할 수 없음을 화면에서도 반영(편집 불가 필드로 표시).
  - 접근성: ThesisStatus 배지 `accessibilityLabel="Thesis 상태: 활성"`.

- [ ] **포지션 목록 화면 정의서:**
  - 목적: 사용자의 보유 포지션 전체를 한눈에 표시.
  - 위치: 하단 탭 "포트폴리오" 탭 내 기본 화면.
  - 구성: `PortfolioSummaryCard`(총 평가금액, 총 손익, 총 손익률) + `PositionList`.
  - PositionCard: 종목명 + 평가 손익률(등락 색상) + ThesisStatus 뱃지 + "상세" 화살표.
  - VIOLATED/EXPIRED 포지션은 리스트 최상단에 고정(주의 필요 항목 우선).
  - 상태: 빈 포지션("보유 종목이 없습니다. 매수 후보 탭에서 신호를 확인하세요.").

---

### M8 — Portfolio & Exit Engine [주담당 R]

Exit Signal과 매도 후보 카드 화면을 정의한다. 3대 원칙 "매수보다 매도를 먼저 안전하게"의 화면 구현.

**이 역할이 할 구체 작업**

- [ ] **매도 후보 카드(ExitScoreCard) 컴포넌트 명세 (M8 핵심 산출물):**

  ```
  ┌──────────────────────────────────────────────┐
  │  [REDUCE / EXIT / WATCH]  종목명             │
  │  Exit Score: ████████░░ 72  →  일부 축소     │
  │                                              │
  │  매도 근거:                                  │
  │    🔴 20일선 종가 이탈 (차트 훼손)           │
  │    🔴 Thesis 훼손: 거래량 5거래일 급감       │
  │    🟡 시장 대비 초과수익 0% 미달             │
  │                                              │
  │  권장 액션: 50% 분할 매도                    │
  │  현재 손익: -2.3%   ≥  손절선 -7.0%        │
  │                                              │
  │  [Thesis 보기]     [나중에]     [매도 검토]  │
  └──────────────────────────────────────────────┘
  ```

  - Exit Score ProgressBar: 0~29 `green` / 30~49 `yellow` / 50~69 `orange` / 70↑ `red`.
  - 권장 액션 배지:
    - HOLD: `green` Chip.
    - WATCH: `yellow` Chip.
    - REDUCE: `orange` Chip.
    - EXIT: `red` Chip(굵은 텍스트).
    - BLOCK_REBUY: `red` Chip + Feather `slash` 아이콘.
  - 매도 근거 항목: 점수 기여 원인별 아이콘 — 손실 🔴 `red`, 논리훼손 🔴 `red`, 차트훼손 🟠 `orange`, 시간초과 🟡 `yellow`.
  - BLOCK_REBUY 액션인 경우: "재매수 차단됨" 배너 표시 후 카드 상단 고정.

- [ ] **매도 후보 피드 화면 정의서:**
  - 위치: 포트폴리오 탭 또는 신호 탭 내 "매도 신호" 서브탭.
  - 구성: 서브탭 헤더(전체/오늘/긴급) + ExitScoreCard 리스트.
  - "긴급" 탭: Exit Score 90↑ (`BLOCK_REBUY` 포함) — 빨간 배지로 건수 표시.
  - 상태: 빈("매도 신호 없음, 모든 포지션이 정상입니다.") / 에러.
  - 푸시 알림 딥링크: EXIT 신호 발생 시 푸시 탭 → 해당 ExitScoreCard로 이동.

- [ ] **포트폴리오 리스크 스냅샷 섹션 정의:**
  - 포지션 목록 화면 상단에 `PortfolioRiskSnapshot` 요약 배너 추가.
  - 표시 항목: 포트폴리오 총 손익률 / 최대 낙폭(MDD 경고 수준 시 `red` 강조) / 오늘 손실 한도 잔여.
  - MDD 한도 초과 경고: `red100` 배너 + "포트폴리오 손실 한도 초과 위험" 문구.

---

### M9 — 백테스트 [해당 없음 ·]

DQ + QA 주담당 단계. 화면 기획의 신규 산출물 없음.

**이 역할이 확인할 점:** 백테스트 결과(`BacktestRun`)는 M10 모의투자 대시보드에 비교 지표로 표시된다. 백테스트 성과 지표(승률/MDD/Sharpe)의 숫자 포맷과 테이블 레이아웃을 미리 설계해 M10 작업에 선행 제공.

---

### M10 — 모의투자 + 비용 거버넌스 ★ MVP 졸업 게이트 [주담당 R]

**이 역할이 할 구체 작업**

- [ ] **모의 포트폴리오 대시보드 화면 정의서:**
  - 목적: 실데이터 기반 가상 주문·체결·손익을 한눈에 확인. "실전 전 약점 발굴" 컨텍스트를 화면에서 명시.
  - 내비게이션: 포트폴리오 탭 내 "모의투자" 탭 추가. 실전 포트폴리오와 명확히 구분(배너 또는 탭).
  - 구성:
    - `PaperBanner`: "모의투자 중 — 실제 돈이 투입되지 않습니다." 안내 배너(항상 표시).
    - `PaperSummaryCard`: 가상 총자산 / 가상 총손익 / 모의투자 시작일 / 경과 기간.
    - `SignalMetricsSection`: 신호 적중률(총 신호 대비 수익 신호 비율) / 평균 보유일.
    - `PaperPositionList`: 가상 보유 포지션 목록(실전 포트폴리오와 동일 PositionCard 재사용).
    - `PaperTradeHistory`: 가상 체결 이력(날짜/종목/매수가/매도가/손익) 최근 20건.

- [ ] **AI 비용 대시보드 화면 정의서:**
  - 목적: `AIUsageLog` 기반 비용 추적. "AI 비용이 수익보다 크면 시스템이 의미 없다"는 원칙을 사용자(또는 운영자)가 수치로 확인.
  - 접근: 설정 탭 내 "AI 비용 현황" 항목 또는 관리자 전용 화면.
  - 구성:
    - `CostSummaryCard`: 이번 달 AI 총비용($) / 모의투자 순손익($) / AI비용/순손익 비율(%).
    - `CostGaugeSection`: 비율 게이지 — ≤10% `green` / 10~20% `yellow` / >20% `red`. 목표 기준선(10%) 표시.
    - `UsageByLevelSection`: L0/L1/L2/L3 호출 비율 파이차트 또는 막대그래프. L0 비율 ≥70% 달성 여부 강조.
    - `CostByTaskTable`: AI Task별(Summary/EventClass/Persona/Thesis) 호출 수·비용·평균 비용.
    - `DailyTrendChart`: 일별 AI 비용 추이 (최근 30일 라인차트).
  - 상태: 데이터 없음("AI 분석이 아직 실행되지 않았습니다") / 비용 한도 초과 경고.
  - 접근성: 게이지는 색상만으로 의미를 전달하지 않도록 `accessibilityLabel`에 수치와 상태 텍스트 포함.

---

### M11 — 반자동매매 [주담당 R]

주문 승인 카드 화면. AI 금지 영역(최종 주문 승인)을 화면 구조로 강제한다.

**이 역할이 할 구체 작업**

- [ ] **주문 승인 카드 화면 정의서 (M11 핵심 산출물):**
  - 목적: Risk Engine 사전체크를 통과한 `OrderRequest`를 사용자가 승인/거절/관망한다.
  - 내비게이션: 신호 탭 내 "주문 승인 대기" 섹션 또는 별도 `/orders/pending` 화면. 배지(미결 건수) 표시.
  - 알림: `OrderRequest` 생성 시 푸시 알림 → 탭 시 주문 승인 카드로 딥링크.

  ```
  ┌──────────────────────────────────────────────┐
  │  [매수 주문안]  종목명   Buy Score 78         │
  │  주문 유형: 시장가 매수                       │
  │  수량: X주   예상 금액: X,XXX,XXX원           │
  │  포트폴리오 비중: 4.2% (한도 5% 이내)        │
  │                                              │
  │  Risk 체크:                                  │
  │    ✓ 종목 비중 한도 이내                      │
  │    ✓ 당일 손실 한도 이내                      │
  │    ✓ 거래 가능 종목                           │
  │    ✓ 증권사 API 연결 정상                     │
  │                                              │
  │  Buy Score 근거 (요약):                      │
  │    공급계약 최근매출 24%, 거래량 3배↑         │
  │                                              │
  │  ⚠ 리스크: 5거래일 +18% 선행 급등            │
  │                                              │
  │  유효 시간: 15분 남음                         │
  │                                              │
  │  [거절]      [관망(스누즈)]      [승인 →]    │
  └──────────────────────────────────────────────┘
  ```

  - 승인 버튼 UX 규칙(AI 금지 영역 강제):
    - `[승인 →]` 탭 시 즉시 실행되지 않고 확인 모달 표시.
    - 확인 모달: "종목명 X주 시장가 매수를 실행합니다. 이 결정의 책임은 본인에게 있습니다." + `[취소]` + `[실행]`.
    - `[실행]` 후에도 Risk Engine 서버 측 최종 체크를 통과해야 주문이 진행됨. 화면에 "검증 중..." 로딩 상태 표시.
    - 자동 타이머 승인 UI(X초 후 자동 승인) 사용 금지 — 설계에서 제외.
  - 유효 시간 카운트다운: 만료 전 3분부터 `yellow` → 1분부터 `red` 경고.
  - 유효 시간 만료: 카드 비활성화 + "이 주문안이 만료되었습니다." 텍스트 + [닫기].
  - RISK_BLOCKED 상태: 카드 자체가 회색 처리, "Risk Engine이 이 주문을 거부했습니다. 사유: [blockedReason]" 표시. 승인 버튼 제거.
  - 매도 주문안도 동일 카드 구조 사용. `[매수 주문안]` → `[매도 주문안]` 레이블 변경. Exit Score + 매도 근거로 내용 대체.
  - 하단: "이 주문안은 투자 자문이 아닙니다. 투자 결정의 책임은 투자자 본인에게 있습니다." 정책 기획 확정 문구.

- [ ] **주문 이력 화면 정의서:**
  - 구성: `OrderHistoryList` — 날짜·종목·유형(매수/매도)·수량·체결가·결과(체결/거절/만료/RISK_BLOCKED).
  - 체결 건에 대해 `TradingAuditLog` 연결 항목 표시.

---

### M12 — 제한적 자동매매 [주담당 R]

자동매매 설정·모니터링·Kill Switch 화면.

**이 역할이 할 구체 작업**

- [ ] **자동매매 설정 화면 정의서:**
  - 목적: 이벤트별 자동매매 활성화/비활성화, 한도 설정, Kill Switch.
  - 내비게이션: 설정 탭 → "자동매매 설정" — 명확한 경고 후 진입.
  - 진입 게이트 화면: "자동매매는 백테스트와 모의투자를 통과한 전략에만 적용됩니다." 안내 + 조건 충족 여부 체크리스트 표시 후 `[설정 진행]`.
  - 구성:
    - `AutoTradingMasterSwitch`: 최상단 자동매매 전체 ON/OFF 토글. OFF 시 모든 하위 설정 비활성화.
    - `WhitelistEventSection`: 자동 허용 이벤트 목록(SHARE_BUYBACK/SUPPLY_CONTRACT 등). 각 이벤트별 활성화 토글 + 백테스트 통과 여부 배지.
    - `HardRuleSummarySection`: 하드 리스크 룰 표시(편집 불가, 읽기 전용). "1회 주문 최대 3% / 단일 종목 최대 10% / 1일 손실 한도 -2%" 등.
    - `KillSwitchSection`: 전체 자동매매 즉시 중단. `[긴급 정지]` 버튼 — 빨간 배경 + Feather `power` 아이콘.
  - 하드 리스크 룰은 편집 불가(읽기 전용 표시). 수정 시도 시 "이 값은 시스템이 관리하는 안전 한도로 변경할 수 없습니다." 안내.

- [ ] **자동매매 모니터 화면 정의서:**
  - 목적: 자동 실행 중인 주문, 오늘 자동 체결 이력, 현재 리스크 상태를 실시간 확인.
  - 내비게이션: 설정 탭 → "자동매매 현황" 또는 포트폴리오 탭 서브탭.
  - 구성:
    - `AutoTradingStatusBanner`: 자동매매 ON/OFF 상태 + 오늘 자동 체결 건수.
    - `TodayAutoTradeList`: 오늘 자동 실행 주문 목록(체결가·수량·사유).
    - `RiskStatusSection`: 1일 손실 한도 사용률 게이지 / 연속 손실 카운터 / 시장 급락 차단 여부.
    - `AutoKillTriggerLog`: 자동 중단 트리거 이력(연속 손실 N회, 시장 급락, API 오류).
    - `ManualKillSwitchButton`: 언제든 즉시 접근 가능한 긴급 정지 버튼 — 화면 최하단 고정.
  - `ManualKillSwitchButton` 탭 시 확인 모달: "자동매매를 즉시 중단합니다. 진행 중인 주문은 취소 요청됩니다." + `[취소]` + `[중단]`.
  - Kill Switch 작동 후 상태: 화면 전체 `red100` 오버레이 배너 "자동매매 중단됨 — [재개하려면 설정에서 활성화하세요]".

---

## 3. 다른 역할과의 인터페이스 & 핸드오프

### 이 역할이 넘기는 것 (→ 다른 파트)

| 수신 파트 | 산출물 | 형식 | 타이밍 |
|-----------|--------|------|--------|
| **FE** | 화면 정의서(목적·구성·상태·내비게이션·접근성) | 이 문서 §2 각 마일스톤 기준 | FE 구현 착수 전 확정 필수 |
| **FE** | 컴포넌트 명세(RN Paper 컴포넌트 매핑, 테마 토큰) | §2 각 카드 컴포넌트 섹션 | FE 착수 전 |
| **FE** | 이벤트 한국어 레이블 테이블 | §2 M2 섹션 테이블 | M2 완료 후 즉시 |
| **시나리오 기획** | 화면 레이아웃 확정본 | 이 문서 | 시나리오 플로우 작성 전 |
| **정책 기획** | 리스크 고지 문구 배치 위치 | 각 화면 하단 `DisclaimerSection` | 정책 문구 확정 후 삽입 |

### 이 역할이 받는 것 (← 다른 파트)

| 공급 파트 | 받는 것 | 형식 | 필요 시점 |
|-----------|---------|------|-----------|
| **BE** | API 응답 DTO 구조 | OpenAPI/Swagger | 각 화면 정의서 작성 전 |
| **AI** | AI 출력 문구 길이·포맷 계약 | 프롬프트 출력 스키마 | M3 화면 설계 전 |
| **DQ** | Event Study 결과 표시 포맷 합의 | 지표명·단위·소수점 자릿수 | M9 완료 후 M10 전 |
| **정책 기획** | 비투자자문 고지 문구 확정본 | 문자열 상수 | M6 카드 설계 전 |
| **시나리오** | 엣지 케이스·빈 상태 시나리오 | 플로우 다이어그램 | 각 화면 상태 정의 전 |

### 회귀 체크포인트(↩︎)에서 이 역할이 재확인할 항목

| 마일스톤 | 재확인 항목 |
|----------|------------|
| M3 이후 | AI 분석 섹션 레이아웃이 BE API 응답 구조(JSON 필드명)와 정합하는가 |
| M6 이후 | BuyScoreCard가 `TradingSignal` DTO의 실제 필드를 모두 표시하는가. BLOCKED/entryReady=false 상태 UI가 정상 동작하는가 |
| M7 이후 | Thesis 상세 화면이 `PositionThesis.invalidConditions` 항목 수(3~10개)에 동적으로 대응하는가 |
| M8 이후 | ExitScoreCard 권장 액션 5종 모두 표시 테스트 통과 여부 |
| M10 이후 (전체 회귀) | 온보딩부터 모의투자 대시보드까지 전체 화면 플로우를 시뮬레이터에서 단절 없이 실행 가능한가 |

---

## 4. 산출물 목록

| # | 산출물 | 담당 마일스톤 | 저장 위치(권고) |
|---|--------|-------------|----------------|
| 1 | 온보딩 IA & 플로우 다이어그램 | M0 | `docs/screens/onboarding-ia.md` |
| 2 | 온보딩A~D 화면 정의서 | M0 | `docs/screens/onboarding-*.md` |
| 3 | 이벤트 한국어 레이블 테이블 | M2 완료 후 | `docs/screens/event-label-table.md` |
| 4 | AI 분석 섹션 레이아웃 정의 | M3 | `docs/screens/disclosure-ai-section.md` |
| 5 | 종목 차트·지표 화면 정의서 | M4 | `docs/screens/stock-chart.md` |
| 6 | 매수 후보 피드 화면 정의서 | M6 | `docs/screens/buy-signal-feed.md` |
| 7 | BuyScoreCard 컴포넌트 명세 | M6 | `docs/screens/components/buy-score-card.md` |
| 8 | 매수 후보 상세 화면 정의서 | M6 | `docs/screens/buy-signal-detail.md` |
| 9 | Thesis 상세 화면 정의서 | M7 | `docs/screens/position-thesis.md` |
| 10 | 포지션 목록 화면 정의서 | M7 | `docs/screens/portfolio-positions.md` |
| 11 | ExitScoreCard 컴포넌트 명세 | M8 | `docs/screens/components/exit-score-card.md` |
| 12 | 매도 후보 피드 화면 정의서 | M8 | `docs/screens/exit-signal-feed.md` |
| 13 | 모의 포트폴리오 대시보드 화면 정의서 | M10 | `docs/screens/paper-portfolio.md` |
| 14 | AI 비용 대시보드 화면 정의서 | M10 | `docs/screens/ai-cost-dashboard.md` |
| 15 | 주문 승인 카드 화면 정의서 | M11 | `docs/screens/order-approval-card.md` |
| 16 | 주문 이력 화면 정의서 | M11 | `docs/screens/order-history.md` |
| 17 | 자동매매 설정 화면 정의서 | M12 | `docs/screens/auto-trading-settings.md` |
| 18 | 자동매매 모니터 화면 정의서 | M12 | `docs/screens/auto-trading-monitor.md` |

---

## 5. 역할 특화 표준·체크리스트

### 화면 정의서 작성 표준 (모든 화면에 공통 적용)

각 화면 정의서는 아래 5개 섹션을 반드시 포함한다.

```
1. 목적 (한 문장)
2. 구성 요소 (레이아웃 구조 + 각 컴포넌트 이름·역할)
3. 상태 정의
   - 로딩: 스켈레톤 또는 인디케이터 위치
   - 빈 상태: Empty State 메시지 + 액션 버튼(있으면)
   - 에러: 에러 메시지 + 재시도 버튼 위치
   - 오프라인: 오프라인 배너 위치
4. 내비게이션 (진입 경로 + 이탈 경로)
5. 접근성 명세 (accessibilityLabel, accessibilityRole, 색상 대비)
```

### 컴포넌트 명세 표준

- RN Paper 컴포넌트 이름(`Card`, `Chip`, `Button`, `ProgressBar`, `Surface` 등)을 정확히 명시.
- 테마 토큰은 `lightColors`/`darkColors` 키 이름으로 표기. RGB/헥스 직접 사용 금지.
- 예외: `palette.teal500`처럼 palette 직접 참조 시 이유 명시.
- 아이콘: Feather 아이콘 이름으로 명시(`feather:bell`, `feather:trending-up`). Ionicons 지양.

### 투자 정보 화면 게이트 체크리스트

투자 판단과 관련된 모든 화면(M6 이후)은 FE 구현 착수 전 아래를 확인한다.

- [ ] 비투자자문 고지 문구 영역이 화면에 예약되어 있는가 (정책 기획 문구 삽입 대기 상태 포함)
- [ ] AI 생성 콘텐츠 영역에 "AI 분석 참고용" 명시 레이블이 있는가
- [ ] 주문 승인 버튼이 단일 탭 즉시 실행 구조가 아닌가 (확인 모달 또는 슬라이드 제스처 필수)
- [ ] 하드 리스크 룰 수치(손절 % 등)가 편집 불가 필드로 표시되는가
- [ ] Kill Switch 또는 긴급 중단 버튼이 해당 화면에서 2탭 이내로 접근 가능한가 (M12)

### 상태 컬러 코딩 표준

화면 전반에 걸쳐 일관된 색상 의미를 적용한다.

| 의미 | 라이트모드 토큰 | 다크모드 토큰 |
|------|---------------|-------------|
| 긍정·상승·통과 | `success` (green500) | `success` (green400) |
| 경고·주의 | `warning` (yellow500) | `warning` (yellow400) |
| 위험·하락·실패 | `error` (red500) | `error` (red400) |
| 주요 액션·신호 | `primary` (teal500) | `primary` (indigo400) |
| 비활성·중립 | `textTertiary` (gray400) | `textTertiary` |
| 비투자자문 고지 배경 | `surfaceSecondary` | `surfaceSecondary` |

> **색상만으로 의미를 전달하는 UI는 허용하지 않는다.** 색상 + 텍스트 레이블 + 아이콘 중 최소 2가지를 함께 사용한다.

### Expo Router 내비게이션 규약

| 화면 유형 | 경로 패턴 |
|-----------|-----------|
| 온보딩 | `/onboarding/(intro|universe|persona|notification)` |
| 신호 피드 | `/(tabs)/signals` |
| 매수 후보 상세 | `/signals/[id]` |
| 포트폴리오 | `/(tabs)/portfolio` |
| 포지션 상세 | `/portfolio/[portfolioId]/position/[positionId]` |
| Thesis 상세 | `/portfolio/[portfolioId]/position/[positionId]/thesis` |
| 주문 승인 대기 | `/orders/pending` |
| 주문 이력 | `/orders/history` |
| 자동매매 설정 | `/settings/auto-trading` |
| 자동매매 모니터 | `/settings/auto-trading/monitor` |
| AI 비용 대시보드 | `/settings/ai-cost` |
