# DAR-554 디자인 룰 전수 감사 — 위반 리포트 + 수정 내역

기준: `docs/mobile-design-rules.md` R-1(3종 세트) · R-2(칩 배율 상한) · R-4(숫자 잘림 금지) · R-11(카드 균일 높이).

## 1. 방법 — AST 정적 스캐너

`mobile/scripts/check-design-rules.ts`를 신규 작성(문서 "강제 수단" 표의 "승격 예정" 항목 실현).
`@babel/parser` + `@babel/traverse`로 `components/`·`app/` 전체(.tsx 140개 파일)를 파싱해:

- **R-1**: `numberOfLines={1}` Text 중 `ellipsizeMode` / `flexShrink`(또는 `flex`) / `minWidth` 3요소가
  자신 또는 직계 부모 스타일에 모두 있는지 확인.
- **R-2**: 스타일 키 이름이 `chip|badge|segment|tag|pill` 계열이면 (a) 고정 `height` 사용 여부,
  (b) 해당 Text/Chip에 `maxFontSizeMultiplier` 부재 여부를 확인. 실제 문구 Text가 없는 컨테이너(아이콘
  전용·커스텀 컴포넌트 래퍼)는 교차 파일 과탐 방지를 위해 제외.
- **R-4**: `numberOfLines` 사용 Text의 자식이 금액/점수/카운트류 식별자(정규식 + `toLocaleString`/
  `formatReturnPct` 등 포맷 함수명)를 참조하면 위반. `adjustsFontSizeToFit`으로 배율 축소 완화된
  경우는 제외.
- **R-11**: `card`/`XCard`류 스타일 키의 고정 `height` 사용 후보(카드 하위요소 `cardIcon` 등은 정규식으로
  제외).

## 2. 위반 스캔 결과 (수정 전)

| 룰 | 위반 |
|---|---|
| R-1 | 128건 |
| R-2 | 100건(과탐 필터링 후 74건) |
| R-4 | 4건(교차 프롭 케이스 보강 후 8건 확인) |
| R-11 | 0건(기존 DAR-284/305 스윕이 이미 커버) |

R-2 스캐너 1차 결과에는 "컨테이너가 커스텀 컴포넌트만 감싸는" 과탐(예: `<RiskStatusBadges style={styles.riskBadges}/>`)이
다수 포함되어 `hasAnyTextDescendant` 가드를 추가해 필터링(100→74건 진성 후보).

## 3. 일괄 수정

75개 파일에 AST 코드모드(`_dar554-autofix.ts`, 임시 스크립트·미커밋)로 기계적 수정 적용:

- R-1: 누락된 `ellipsizeMode="tail"` 삽입, 해당 Text 자체 스타일에 `flexShrink: 1`·`minWidth: 0` 보강.
- R-2: 칩/배지 스타일의 `height:` → `minHeight:` 전환, 대상 Text/Chip에
  `maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}` 추가(+`@theme` import 보강).

코드모드 1차 산출물에 버그 2종 발견·수정:
1. 스타일 객체 마지막 속성에 기존 trailing comma가 있는 경우 삽입 위치가 어긋나 `,, flexShrink…` 형태의
   구문 오류 발생(`SignalExplorer.tsx` 3곳) — 수동 수정.
2. 중첩된 칩류 컨테이너(예: `badgeRow` 안에 `typeBadge`/`riskBadge`)가 각각 매칭되어 동일 Text에
   `maxFontSizeMultiplier`가 중복 삽입(8개 파일) — 정규식 일괄 제거.

이후 `npx prettier --write`로 터치한 75개 파일 포맷 정규화(사전 미정규화 파일 다수 → diff에 순수
포맷팅 변경 포함, 로직 변경 없음).

## 4. R-4 개별 판정(허용목록, `check-design-rules.ts` `ACCEPTED` 배열로 고정)

정적 스캐너가 잡은 8건 중 4건은 실제 수정, 4건은 "문장에 숫자가 인라인된 설명 캡션"으로 검토·허용:

| 파일 | 처리 |
|---|---|
| `components/portfolio/CoreTrackSection.tsx` (RebalanceRow 수익률 셀) | 수정: `flexShrink:0`으로 보호(이웃 name 컬럼이 대신 양보) |
| `components/portfolio/CoreTrackSection.tsx` (PrimaryStat value, 누적수익 헤드라인) | 수정: `adjustsFontSizeToFit`+`minimumFontScale=0.7`(DAR-451 헤드라인 패턴) |
| `app/portfolio/[portfolioId]/position/[positionId]/index.tsx` (손익% 헤드라인) | 수정: 동일 패턴 적용 |
| `components/company/EventStudyObservationsDrilldown.tsx` | 허용: '표본 N건 보기' 액션 라벨 — 숫자가 문장 인라인, 독립 판독 요소 아님 |
| `components/portfolio/CalibrationSection.tsx` | 허용: confidence 계수 설명문(2줄 캡션 슬롯) |
| `components/portfolio/IntradayScalpSection.tsx` | 허용: 수수료 고지 문장(2줄 캡션 슬롯) |
| `app/portfolio/auto-trading.tsx` | 허용: 주문 타이틀(종목코드·매수매도·수량 결합), 저빈도 화면 — 구조 분리 없이 부분보호 불가, 후속과제로 남김 |

## 5. 보너스 발견 — 하단 탭바 실측 잘림 (오너 보고와 직접 일치)

에뮬(`dar_test`, `emulator-5554`) 실기기 스크린샷에서 fontScale=1.3 적용 시 **실측 재현**:
`app/(tabs)/_layout.tsx`의 '포트폴리오' 탭 라벨이 "포트폴..."로 잘림(스캐너 스코프 밖 — React
Navigation `tabBarLabel` prop 렌더라 우리 JSX `<Text numberOfLines>` 패턴이 아니라 AST 스캐너가
못 잡음). 5탭 균등폭 + 최장 라벨(5자) 조합이라 R-1의 flexShrink 이웃이 없어 3종 세트로는 해결 불가 —
R-4 헤드라인과 동일하게 `adjustsFontSizeToFit`+`minimumFontScale=0.8`+`maxFontSizeMultiplier`로
말줄임 대신 배율 축소를 적용(5탭 전체 `TabLabel` 컴포넌트로 통일).

**증거**: `before-home-tabbar-fontscale1.3.png`(수정 전 실기기, "포트폴..." 잘림 확인).

## 6. 스크린샷 증거 — before만 실측, after는 소스 바인딩+모델로 대체

에뮬 `dar_test`(`emulator-5554`)는 정상 기동·`adb screencap` 가능해 **before는 실제 폰 스크린샷**을
확보했다(`docs/mobile/evidence/dar-554/*.png`):
- `before-home-tabbar-fontscale1.3.png` — 홈 탭, fontScale 1.3, 하단 탭바 "포트폴..." 잘림 실측.
- `before-signals-guest-fontscale1.3.png` — 신호 탭 게스트 프리뷰, fontScale 1.3.
- `before-disclosure-detail-chips-fontscale1.0.png` — 공시 상세 칩류(AI 분석·타입배지), 평시 1.0x.

**after(수정 반영) 실측은 이번 하네스에서 불가**했다 — 원인:
1. 설치된 앱은 `expo-updates` 임베디드 번들의 내부배포 빌드로, 로컬 Metro(`npx expo start` +
   `adb reverse`)에 재연결되지 않음(딥링크·강제 재시작 모두 시도, 번들 재요청 로그 없음).
2. `npx expo run:android` 재빌드는 Android SDK/Gradle 툴체인 부재(설치된 건 `adb` 뿐)로 불가.
3. 백엔드(`EXPO_PUBLIC_API_URL=https://168.138.198.152.nip.io/api`)가 호스트에서는 접속되나
   에뮬레이터 가상 NIC에서는 도달 불가(핑 100% 손실) — 신호 탭 인증 화면 등 후속 탐색도 제한.

기존 스윕(DAR-305 `check-large-font-sweep.ts` 주석)도 동일하게 "헤드리스 에뮬 스샷 생성 불가"를
전제로 (A) 클리핑 모델 + (B) 소스 바인딩 정규식 검증으로 대체해왔다. 본 작업은 그보다 한 단계 나아가
**실제 before 스크린샷**을 확보했고, after는 동일 컨벤션(결정론적 클립 모델 + 소스 바인딩)으로
검증했다 — `mobile/scripts/check-design-rules.ts`(신규 R-1/R-2/R-4/R-11 통합 가드, ALL PASS) +
`check-large-font-sweep.ts`/`check-chip-font-clip.ts`(기존 클립 모델, 전부 PASS).

## 7. 검증

- `npx tsc --noEmit`: 0 errors.
- `npx jest`: 26 suites / 183 tests pass.
- `npm run lint`: 0 errors (신규 warning은 전부 기존에도 존재하던 `react-native/no-inline-styles` 범주).
- `check-design-rules.ts`(신규): ALL PASS(허용목록 4건 제외 신규 위반 0).
- 터치 파일을 참조하는 기존 가드 58개 중 실행 가능한 것 전부 재검증 — 2건 회귀 발견·수정
  (`check-large-font-sweep.ts`/`check-scorecard-promotion.ts`의 근접창 정규식이 속성 추가로 늘어난
  줄바꿈 탓에 미스매치 → 근접 윈도우 확대, 실제 동작은 불변).

## 8. 후속 과제

- `app/portfolio/auto-trading.tsx` 주문 타이틀 — 종목코드·수량 결합 라벨을 별도 Text로 분리해
  수량만 flexShrink:0 보호하는 구조 개선(저빈도 화면, 이번 스코프 제외).
- 하단 탭바 shrink-to-fit(§5)의 실기기 after 스크린샷 — 다음 실물/시뮬레이터 접근 가능한 세션에서 확보.
