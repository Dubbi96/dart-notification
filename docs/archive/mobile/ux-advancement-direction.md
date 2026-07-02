# UX 고도화 방향 — 멀티에이전트 패널 종합

> 6개 UX 관점 논의 → 3개 교차검증(투자앱 PM·RN 엔지니어·UX 리서처) → 헤드오브디자인 종합. 출처: Workflow ux-advancement-panel.

## 비전
"공시온은 점수를 단독으로 들이밀지 않는다 — 모든 숫자(78점)는 반드시 '평문 뜻 + 무엇이 더해졌나 + 언제·무엇 기준' 셋을 데리고 와서, 사용자가 '믿거나 말거나'가 아니라 '검증해보라'로 차분히 판단하게 만드는, 정직하고 읽히는 조용한 애널리스트 경험."

## 설계 원칙
- 숫자는 절대 혼자 나타나지 않는다: 모든 점수·극성·enum은 (a)초심자 평문 (b)근거 분해 (c)출처/시점 중 최소 하나를 항상 동반한다. 이것이 인지부하 감소이자 과신방지이자 면책의 실천이다.
- 투명성에는 불확실성을 같은 비중으로: 근거를 많이 보여줄수록 리스크 패널티·표본수(n)·만료/신선도를 동등 노출해 '정밀해 보이는 착시(과신)'를 코드 레벨에서 차단한다.
- 모션은 '계산 과정의 신뢰감'까지만, '결과 강조'로 넘어가지 않는다: 차오름·카운트업은 절제된 1회 ease-out만, STRONG_BUY 글로우·무한 펄스·AI 의인화 같은 설득/FOMO 연출은 금지. 모든 모션은 useReducedMotion 폴백 의무.
- 면책은 약화 불가, 시각만 정돈: 법적 본문과 '투자자문 아님' 명시 문구는 변경 금지. 톤 완화(borderLeft teal 액센트)는 허용하되 alert-triangle→shield 교체·따뜻한 헤드라인 카피는 법무 확인 전 보류.
- 평문 결론 카피는 거버넌스 대상: scoreOneLiner 등 모든 해석 문구는 단일 상수 파일로 모으고 반드시 '(참고)' 꼬리표를 강제(린트/리뷰 규칙)해 투자권유 오인을 차단한다.
- 반드시 읽혀야 하는 텍스트(점수·근거·면책)는 시스템 차원에서 읽히게: 다크모드 대비 AA 통과 + 동적 글자크기(클램프 1.5x) + 색상 단독 의미 제거(아이콘+텍스트 병행)를 기반 인프라로 보장한다.
- 공통 컴포넌트 단일화로 신규 화면 자동 상속: ScoreGauge·DisclaimerSection 등 한 곳을 고치면 BuyScoreCard·ExitScoreCard·signals/[id]·ai-cost가 자동 수혜되는 기존 구조를 활용하되, 한 컴포넌트에 모션+세그먼트+근거+a11y를 동시에 얹지 않고 단계 분리한다.
- 백엔드 계약이 없으면 빈 껍데기를 만들지 않는다: evidenceKey 등 백엔드 스키마 선행이 필요한 기능(EvidenceBreadcrumb)·M4 시세 데이터 의존(스파크라인)은 데이터 계약 확정 전까지 착수 보류.

## 고도화 항목 (우선순위별)

### P0

#### 다크모드 대비 결함 수정 — 읽혀야 하는 텍스트를 textSecondary 이상으로 승격
- **왜:** darkColors.textTertiary(#5C6180)는 surface(navy900 #0C1026) 위에서 대비 3.11:1로 WCAG AA(4.5:1) 미달을 코드로 확인. ScoreGauge 라벨·EmptyState 보조문구·BuyScoreCard ticker가 모두 이 토큰이라 점수·면책 같은 핵심 투자 텍스트가 저시력자에게 사실상 안 읽힌다. '정직함'을 표방하면서 정작 못 읽히는 자기모순. 3개 비평 모두 검증·즉시채택으로 합의.
- **어디:** theme/colors.ts, components/common/ScoreGauge.tsx(라벨), components/common/StateView.tsx(EmptyState 보조문구), components/signals/BuyScoreCard.tsx(ticker)
- **어떻게:** 빌드타임 1회 대비 점검 스크립트로 전경×배경 쌍 AA 미달 식별(런타임 비용 0). 규칙: '읽어야 하는 텍스트'는 textSecondary(#8B90A8, 5.95:1 통과) 이상만 사용, textTertiary는 순수 장식/비활성에만 한정. ScoreGauge 점수 라벨·EmptyState 메인보조문구를 textSecondary로 승격. darkColors.primary(인디고 #818CF8)는 6.30:1 통과하므로 브랜드 teal 환원은 디자인 승인 필요한 별개 이슈로 분리(코드만으로 강행 금지). 신규 의존성 0, Expo Go 100% 호환.

#### 평문 번역 레이어 — raw enum 한글화 + scoreOneLiner + polarity 평문(모두 '(참고)' 강제)
- **왜:** signals/[id]·disclosure/[id]·BuyScoreCard가 'SUPPLY_CONTRACT', 'polarity POSITIVE', 'Buy Score 78'을 그대로 노출. 초심자는 enum 해독 불가, 78점이 무슨 뜻인지 어디에도 없다. 인지부하의 근원이자 ux-detail §8-2 미구현. 3개 비평 모두 effort low·impact 최고로 최우선 채택. raw 숫자가 평문·근거 없이 단독 노출되는 것이 곧 자문 오인 리스크.
- **어디:** utils/signalDisplay.ts(scoreOneLiner 추가), utils/disclosureType.ts(EVENT_TYPE_LABEL 맵), 신규 utils/copy.ts(평문 결론 상수 단일 파일), components/common/ScoreGauge.tsx, components/signals/BuyScoreCard.tsx, app/signals/[id].tsx, app/disclosure/[id].tsx
- **어떻게:** 기존 gradeLabel/getTypeLabel 패턴 그대로 확장. EVENT_TYPE_LABEL 맵(SUPPLY_CONTRACT→'대규모 공급계약')으로 Chip·카드·AI섹션 전부 교체. scoreOneLiner(score,kind)는 '관심을 가져볼 만한 수준 (참고)'/'아직 근거가 약함 (참고)' 평문 매핑 — 반드시 '(참고)' 꼬리표 포함, ScoreGauge 하단 textSecondary로 항상 노출. polarity는 'POSITIVE'→'호재 성격(참고)'. 모든 평문 결론 문구를 utils/copy.ts 단일 상수로 모아 컴플라이언스/법무 검토 + '(참고)' 강제 린트 규칙 대상. Teal 토큰·기존 Chip만 사용, 신규 의존성 0.

#### Score 근거 분해 ScoreBreakdownSection — '왜 78점인지'를 가산/패널티 합으로 증명(불확실성 동등 노출)
- **왜:** signals/[id].tsx는 ScoreGauge import만 있고 ScoreBreakdownSection이 없어 점수가 블랙박스. screen-plan SCR-SIGNAL-DETAIL이 명세한 가산식(+18/+16…/-12)이 UI에 전혀 안 드러나 사용자는 '맹신 아니면 불신'으로 양극화된다. 근거 분해는 점수를 '검증 가능한 참고치'로 격하시켜 면책과 같은 방향으로 작동 — 신뢰계약을 '믿어달라→검증해보라'로 전환하는 boldMove의 한 축. 3개 비평 만장일치 채택.
- **어디:** app/signals/[id].tsx(HeaderSection 직후), 신규 components/signals/ScoreBreakdownSection.tsx, 신규 components/common/ScoreProgressRow.tsx(ux-detail §11 제안)
- **어떻게:** 각 기여 항목을 ScoreProgressRow(라벨 + 부호 점수칩 + mini ProgressBar progress=Math.abs(기여)/maxContribution)로 렌더. 양수=success/음수·리스크패널티=error 색+부호 텍스트 병행. 합계 '= 78점' 꼬리줄로 '점수=근거의 합' 증명. 화려한 diverging bar보다 가산구조 증명에 집중. 과신 역설 차단을 위해 리스크 패널티 행 + 표본수(eventStudy n)·불확실성을 동등 비중으로 반드시 노출. signal.scoreBreakdown?.map() optional chaining으로 백엔드 미연동 시 graceful null(기존 패턴). 항목 8개 고정이라 View map 허용. RN Paper ProgressBar/Chip, 신규 의존성 0.

### P1

#### ScoreGauge 등급 밴드 세그먼트 — flat ProgressBar에 등급 컷 틱 + 노브 + '다음 등급까지' 캡션
- **왜:** ScoreGauge는 8dp 단색 트랙 + 숫자뿐. 78점이 STRONG_BUY(80) 직전인지 BUY(60~79) 한복판인지, 등급 컷(30/60/80)이 어디인지 전혀 안 읽혀 점수 의미가 텍스트에만 의존. 비전의 등급 컷이 게이지에 없다. effort low·신규 의존성 0이며 reanimated 카운트업보다 우선(2개 비평이 '모션보다 시각 우선' 명시).
- **어디:** components/common/ScoreGauge.tsx(BuyScoreCard·ExitScoreCard·signals/[id]·ai-cost 자동 전파)
- **어떻게:** 기존 ProgressBar 위에 등급 컷(30/60/80) 지점을 position:absolute left:`${cut}%` 1px 세로 틱 View로 오버레이, 채워진 끝에 작은 원형 노브 View. 우측 숫자 옆 '다음 등급까지 +2' 캡션(small→대비 위해 textSecondary). 색은 기존 buyScoreColor/exitScoreColor 유틸 재사용. 접근성 라벨에 '78점, 매수후보 구간, 강한매수까지 2점' 합성. 매직넘버 금지 위해 컷 상수는 signalDisplay에 정의. 신규 라이브러리 0.

#### 맥락 적응형 면책 — DisclaimerSection contextNotes prop(급등·표본부족·만료임박을 '상태 고지'로 동적 주입)
- **왜:** DisclaimerSection이 모든 화면 동일 정적 문구라 '읽지 않고 넘기는 법적 문구'로 죽어있다. ux-detail §10-1의 강도 계층(Level 1~4)이 단일 강도로만 구현. riskFlags high·eventStudy n<30·만료임박 같은 '지금 이 화면 한정' 위험맥락을 면책 상단에 동적 주입하면 면책이 살아있는 의사결정 정보가 된다. 3개 비평 채택.
- **어디:** components/common/DisclaimerSection.tsx(contextNotes prop), app/signals/[id].tsx·app/disclosure/[id].tsx(riskFlags/eventStudy를 contextNotes로 전달)
- **어떻게:** DisclaimerSection에 contextNotes?: string[] prop 추가 → 기존 surfaceSecondary 박스 상단에 feather:alert-triangle(warning) + 배열 map으로 '추가 행만' 렌더(기존 면책 본문은 그대로 보존·약화 금지). 문구는 반드시 '상태 고지'로 한정: '이 신호는 최근 5거래일 +18% 급등 구간에서 생성됨' O / '지금 위험하니 매도' X. contextNotes 행에도 accessibilityLabel 포함(§9-6). 색상 warning/error 토큰만, 신규 의존성 0.

#### 데이터 출처·시점 ProvenanceBar — AI 분석/시세에 '언제·무엇 기준' 상시 노출 + stale 경고
- **왜:** disclosure/[id]·signals/[id]의 AI 분석에 '분석 생성 시각·시세 기준 시각'이 전혀 없다. React Query staleTime 규칙상 캐시된 옛 데이터가 화면에 떠 있을 수 있어 시점 표기는 장식이 아니라 오인 방지 장치. date-fns 4.1.0 설치 확인. '78점은 절대 단독 등장 안 한다(근거의 합 + 출처의 시점)'는 신뢰계약의 다른 한 축. 2개 비평 채택, 1개 채택.
- **어디:** app/disclosure/[id].tsx(AI 헤더 아래), app/signals/[id].tsx(AI 매수 근거 Surface), 신규 components/common/ProvenanceBar.tsx
- **어떻게:** Text + Feather 조합 한 줄: feather:clock '분석 2분 전' · feather:database '시세 14:32 기준' · feather:hash '룰 v1.2'를 점(·) 구분 caption. date-fns formatDistanceToNow(locale ko)는 이미 의존성. 신선도 임계(시세 15분 초과/장중) 시 해당 토큰만 warning + alert-circle로 승격. 기본색은 대비 위해 textSecondary. generatedAt/priceAt 백엔드 미존재 시 optional chaining 조건부 렌더. 신규 의존성 0.

#### 접근성 — 스크린리더 카드 그룹핑 + EntryCondition 상태어 합성 + 색맹 대응 아이콘
- **왜:** BuyScoreCard는 카드 라벨 'corpName 매수신호 78 강한매수'만 있고 내부 ScoreGauge(progressbar)·EntryConditionRow·면책이 각각 별도 요소로 중복/단편 읽힘. EntryConditionRow는 '필수 미충족'을 색상으로만 구분(met이면 check-circle, 아니면 circle)하고 라벨에 충족/미충족 상태어가 없어 스크린리더·색맹 사용자에게 핵심 판단정보가 전달 안 됨 — a11y 결함이자 신뢰 문제. effort low.
- **어디:** components/signals/BuyScoreCard.tsx(EntryConditionRow·카드 그룹핑), components/signals/ExitScoreCard.tsx, components/common/DisclaimerSection.tsx, components/common/ScoreGauge.tsx(accessibilityElementsHidden 옵션)
- **어떻게:** 카드를 accessible + accessibilityRole='button' + accessibilityHint='탭하면 신호 상세로 이동'으로 두고 내부를 importantForAccessibility='no-hide-descendants'로 묶어 한 번에 합성 읽힘. EntryConditionRow 라벨에 '충족'/'필수 미충족'/'미충족' 상태어 텍스트 합성 + 필수-미충족은 circle→alert-circle로 형태 구분(색맹 대응). ScoreGauge는 카드 안에서 accessibilityElementsHidden 옵션 받아 중복 제거. 단 카드 내 '관련 공시 보기' 등 보조 액션은 accessibilityActions로 보강해 도달성 유지. RN 내장 props만, Expo Go 호환.

#### 동적 글자크기(Dynamic Type) — typography를 makeTypography(scale) 함수화(클램프 1.5x 필수)
- **왜:** typography.ts가 fontSize 고정 const라 시스템 '더 큰 텍스트'를 올려도 면책·점수·탭바 라벨이 안 커진다. 고령·저시력의 가장 큰 포용성 공백. 반드시 읽혀야 하는 투자 텍스트의 가독성을 시스템 차원에서 보장. 3개 비평 채택하되 클램프·numberOfLines 해제 가드를 채택 조건으로 명시.
- **어디:** theme/typography.ts(makeTypography(scale)), theme/index.ts(useTheme 시그니처), stores/settingsStore.ts(textScaleOverride), app/(tabs)/settings/index.tsx, app/(tabs)/_layout.tsx(tabBarLabelStyle)
- **어떻게:** typography를 makeTypography(scale) 함수로 전환, useTheme이 PixelRatio.getFontScale() 또는 useWindowDimensions().fontScale에 Math.min(scale,1.5) 클램프를 곱해 반환. small 최소 12px 바닥값. 설정에 '글자 크기' (보통/크게/아주 크게 = 1.0/1.25/1.5)를 settingsStore에 textScaleOverride로 추가(기존 secure-store persist 패턴 그대로 — AsyncStorage 절대 금지). 카드 행은 numberOfLines 고정 해제로 줄바꿈 허용(레이아웃 붕괴 방지). useTheme 시그니처 변경은 전 화면 파급이 크므로 모션·면책과 섞지 말고 격리된 단일 PR(테마엔진)로 직렬 처리. 신규 라이브러리 0.

#### 홈 헤더 검색 직결 — SearchOverlay를 1탭으로(관심기업 추가 깊은 경로 단축)
- **왜:** SearchOverlay는 낙관적 업데이트·실행취소·접근성까지 완성됐는데 홈 헤더에 진입점이 없어 초심자는 설정→관심목록 깊은 경로로만 기업을 추가한다. ux-detail §1-1 미연결. visible/onClose로 이미 모듈화돼 있어 home에서 state 하나면 끝나는 저위험 변경. 인지부하 즉시 감소. 2개 비평 채택.
- **어디:** app/(tabs)/home/index.tsx(헤더 + 빈 관심목록 유도 배너), components/common/SearchOverlay.tsx(visible prop 재사용)
- **어떻게:** home 헤더 알림 아이콘 왼쪽에 feather:search(44x44, hitSlop) 추가 → useState로 SearchOverlay visible 토글. watchlistCount===0 유도 배너 onPress와 빈 피드 EmptyState onAction을 watchlist 라우팅 대신 동일 오버레이로 통일(한 단계 단축). 비로그인 시 requireAuth() 게이트 유지. Teal GlassCard·Feather 그대로, 신규 의존성 0.

### P2

#### ScoreGauge 절제된 카운트업 — 0→점수 600ms 1회 ease-out(useReducedMotion 폴백 의무)
- **왜:** 점수가 즉시 박히면 '판단 지표'의 무게감이 약하다. 0→78로 차분히 차오르는 1회 모션은 '계산되어 나온 값'이라는 신중함을 준다. 단 모션 렌즈의 boldMove(reanimated 전면 도입·entering stagger·STRONG_BUY 글로우)는 버리고 카운트업 1개만 절제 채택. 가장 후순위에 두는 이유: reanimated 4.3.1이 src에서 dead이고 newArchEnabled 미설정이라 Expo Go 동작이 미검증.
- **어디:** components/common/ScoreGauge.tsx
- **어떻게:** 착수 전 게이트: 빈 화면 PoC로 'Expo Go 실기기에서 withTiming 1개가 실제 도는가'를 스파이크로 먼저 증명. 통과 시 reanimated useSharedValue(0)→withTiming(target,{duration:600,easing:Easing.out(Easing.cubic)})로 바·숫자 카운트업, 화면 진입/스크롤 인 1회만(중복 invalidate 가드, 리스트는 보이는 카드만). 실패 시 RN 내장 Animated로 강등. useReducedMotion 폴백 의무(정적 즉시 표시). STRONG_BUY 글로우·무한 펄스·AI 의인화는 과신/FOMO 유발로 명시적 금지. 카운트업은 ScoreGauge 단계 분리 순서상 (1)근거분해 (2)등급밴드 (3)a11y 다음 마지막에 얹어 각 단계 jest 회귀 확인.

#### PriceChangeChip — 색+아이콘+텍스트 3중 인코딩(스파크라인은 M4까지 보류)
- **왜:** PositionCard가 손익률을 pnlColor 텍스트 한 줄로만 표시해 색상 단독 의미 전달(색맹 미대응)이자 ux-detail §11 PriceChangeChip 미구현. 추세 스파크라인은 react-native-svg 15.15.4가 설치돼 있으나 폭 48dp 미니라인은 표본/축이 모호하면 과대해석을 부르고 M4 시세 시계열 API 전엔 데이터 자체가 없다 — 3개 비평 모두 칩만 선채택·스파크라인 보류.
- **어디:** 신규 components/common/PriceChangeChip.tsx, components/portfolio/PositionCard.tsx, app/company/[corpCode].tsx
- **어떻게:** RN Paper Chip + Feather trending-up/trending-down/minus + 부호 수치 + successSurface/error 배경으로 즉시 구현. PositionCard·기업상세·홈에 공통 적용해 '게이지=정량, 칩=방향'의 일관 시각문법 확립. accessibilityLabel '수익률 2.04% 상승'(§9-6). 인라인 스파크라인은 M4 시세 차트 라이브러리 결정과 함께 별도 처리. 색상 colors.success/error/successSurface 토큰, svg 미사용.

## 구현 순서
1. 1단계 (P0·신뢰/가독 기반, 신규 의존성 0·저위험): 다크모드 대비 수정 → 평문 번역 레이어(+copy.ts 단일 상수 + '(참고)' 강제) → ScoreBreakdownSection. 이 셋이 '78점은 단독 등장 안 한다(읽힘·이해·검증)' 신뢰계약의 코어. 각각 npx tsc --noEmit 0 + jest 그린 확인.
2. 2단계 (P1·기존 컴포넌트 확장, 의존성 0): ScoreGauge 등급밴드 → 맥락 적응형 면책(contextNotes) → ProvenanceBar → 접근성 그룹핑/상태어. ScoreGauge는 (1)등급밴드 (2)a11y 순서로 단계 분리하고 각 단계 회귀 확인(한 컴포넌트에 동시 prop 폭발 금지).
3. 3단계 (P1·테마엔진 격리 PR, 단일 직렬): 동적 글자크기(makeTypography + useTheme 시그니처 변경). 전 화면 파급이 크므로 모션·면책과 절대 섞지 않고 독립 마일스톤으로 처리, 광범위 회귀 매트릭스 점검.
4. 4단계 (P1·UX 동선): 홈 헤더 SearchOverlay 직결.
5. 5단계 (P2·모션 게이트 통과 후): reanimated 스파이크 PoC(Expo Go 실기기 withTiming 1개 동작 증명)를 선행 게이트로 통과해야만 ScoreGauge 카운트업 착수. 실패 시 RN Animated 폴백 또는 보류. 이어서 PriceChangeChip(svg 미사용). 스파크라인·EvidenceBreadcrumb·Persona 온보딩은 백엔드 evidenceKey/M4 시세 계약 확정까지 착수 보류.
6. 전 구간 가드: 모든 모션 useReducedMotion 폴백 의무, 하드코딩 색상(#xxx)·AsyncStorage 신규 사용 금지, 면책 본문/'투자자문 아님' 변경 금지, 평문 카피 '(참고)' 강제 린트.

## 수용 기준(성공)
- 앱의 어떤 화면에서도 점수(78)·극성·raw enum이 평문 뜻 또는 근거 분해 또는 출처/시점 중 최소 하나 없이 단독 노출되는 곳이 0이다(코드 grep + 시각 검수).
- 모든 평문 결론 카피가 utils/copy.ts 단일 상수에 모이고 '(참고)' 꼬리표를 강제하는 린트/리뷰 규칙이 통과한다.
- 다크모드에서 '읽어야 하는 텍스트'(점수 라벨·근거·면책·EmptyState 보조문구)의 전경×배경 대비가 전부 WCAG AA(4.5:1) 이상임을 빌드타임 점검 스크립트가 0 위반으로 통과한다(DoD 포함).
- ScoreBreakdownSection이 리스크 패널티·표본수(n)를 양수 기여와 동등 비중으로 노출해, 합계가 헤더 점수와 일치('= 78점')함을 시각적으로 증명한다.
- VoiceOver로 BuyScoreCard가 단일 단위로 '종목명·점수·등급·진입조건 N/M 충족·리스크·AI 참고용'을 합성 읽고, EntryCondition의 필수/충족 상태가 색상 외 텍스트+아이콘 형태로 전달된다.
- 시스템 글자크기를 1.5배로 올려도 BuyScoreCard·탭바·ScoreGauge가 줄바꿈으로 수용되고 레이아웃이 깨지지 않는다.
- 면책의 법적 본문과 '투자자문 아님' 문구가 변경되지 않았고, contextNotes는 기존 면책에 '추가'만 되어 면책 강도가 약화되지 않았다.
- 도입된 모든 모션이 useReducedMotion ON에서 정적 폴백으로 동작하고, STRONG_BUY 글로우·무한 펄스·AI 의인화 같은 과신/FOMO 연출이 코드에 존재하지 않는다.
- npx tsc --noEmit 에러 0 · npm run lint 통과 · jest 기존 테스트 회귀 0 · Expo Go 실기기 동작 확인(reanimated 사용 시 스파이크 게이트 선통과).
