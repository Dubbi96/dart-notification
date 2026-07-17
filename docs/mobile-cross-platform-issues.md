# 모바일 크로스플랫폼 이슈 & 빌드 안정화 가이드 (Galaxy/Android)

> 2026-06-07 실기기(Galaxy)·iOS 시뮬레이터·Android 에뮬레이터 교차 검증에서 발견·해결한 이슈 정리.
> **목적: 앞으로 Galaxy(Android)에서도 화면·빌드가 안정적으로 동작하도록 재발 방지.**
> 스택: Expo SDK 56 · React Native 0.85.3 · New Architecture(Fabric) · reanimated 4 · react-native-screens 4 · Expo Go(SDK56) / expo-dev-client.

## ★최우선 — Android에서만 발생한 치명 버그 (iOS는 정상)

### 1. `refreshControl`에 커스텀 래퍼 컴포넌트 금지 (FlatList 전체 미렌더)
- **증상**: 홈·신호·알림·포트폴리오 등 거의 모든 탭에서 FlatList **헤더·아이템·빈상태 전부 백지**(Android만). iOS는 정상. 에러 없음.
- **원인**: `refreshControl={<AppRefreshControl .../>}` 처럼 **커스텀 컴포넌트를 `refreshControl` prop에 전달**하면 RN 0.85 Fabric(Android)에서 ScrollView/FlatList가 콘텐츠를 통째로 안 그린다. iOS는 이 indirection을 허용.
- **수정(적용됨)**:
  - **FlatList**: `refreshControl={<래퍼/>}` → **`refreshing={x}` + `onRefresh={y}` props** 사용(RN 권장, FlatList가 내부에서 RefreshControl 생성).
  - **ScrollView**: refreshing/onRefresh props가 없으므로 → **직접 `<RefreshControl .../>` 엘리먼트**(RN 코어, 래퍼 아님)를 `refreshControl`에 전달.
- **규칙(재발 방지)**: `refreshControl` prop에는 **절대 커스텀 컴포넌트를 넣지 말 것.** FlatList면 props, ScrollView면 코어 `<RefreshControl>` 직접.
- **자동 강제(DAR-115)**: `mobile/.eslintrc.json`의 `no-restricted-syntax` 규칙이 `refreshControl` prop에 `<RefreshControl>` 외 엘리먼트가 들어오면 **lint 에러**로 차단한다. 커스텀 래퍼 `components/common/AppRefreshControl.tsx`는 **삭제됨**(재도입 금지 — 도입해도 lint가 사용처에서 막음).
- **진단법**: FlatList가 Android에서만 백지면 → prop을 하나씩 제거(특히 refreshControl)하며 격리. bare FlatList(하드코딩 data)부터 시작.

### 2. 루트 `GestureHandlerRootView` 필수
- 루트 `app/_layout.tsx`를 `<GestureHandlerRootView style={{flex:1}}>`로 감싸야 한다(누락 시 제스처/스크롤·일부 레이아웃 불안정). 적용됨.

### 3. FlatList `keyExtractor` 고유성
- **증상**: "Encountered two children with the same key" 콘솔 에러(SimulationStatusSection 등).
- **원인**: `${corpCode}-${stockCode}` 키가 같은 종목 복수 포지션에서 충돌.
- **수정**: 고유 id 또는 index 포함(`...-${index}`). 모든 keyExtractor는 충돌 불가능하게.
- **점검(DAR-115)**: 정적 린트는 의미적 키 충돌을 못 잡으므로 **리뷰 체크 항목**으로 강제. 새 리스트 추가 시 키가 데이터 전 범위에서 유일한지 확인.

## 신규 리스트 화면 DoD 체크리스트 (DAR-115)

리스트/스크롤(`FlatList`·`ScrollView`) 화면을 추가·수정하면 아래를 만족해야 완료(`mobile/CLAUDE.md` DoD에서 링크):

- [ ] **refreshControl 안티패턴 0** — `refreshControl`에 커스텀 컴포넌트 미전달. FlatList=`refreshing`/`onRefresh` props, ScrollView=코어 `<RefreshControl>`. ESLint `no-restricted-syntax`가 자동 차단(`npm run lint` 에러 0 확인).
- [ ] **keyExtractor 고유성** — 키가 데이터 전 범위에서 충돌 불가능(고유 id 또는 `-${index}` 포함).
- [ ] **iOS+Android 양쪽 렌더 확인** — 헤더·아이템·빈상태가 두 플랫폼 모두에서 그려짐. iOS `xcrun simctl io booted screenshot ios.png`, Android `adb exec-out screencap -p > android.png`로 캡처 비교(Android 단독 백지 회귀 차단).

## 백엔드/데이터 측 (Android 무관하나 앱 빈화면 유발)

### 4. ETag 304 → RN 빈 응답
- Express 기본 ETag로 재요청 시 `304 Not Modified`(본문 없음) → RN 네트워크 계층이 캐시 본문 복원 실패 → 화면 빈값(에러 없음).
- **수정**: `backend/src/main.ts`에서 `expressInstance.set('etag', false)` (DAR-114). 동적 API엔 ETag 이득 없음.

### 5. 미적용 마이그레이션 → 500
- `calibratedConfidence` 등 컬럼 미존재로 `/signals` 500. **앱 실행 전 `npx prisma migrate deploy` 필수.**

### 6. 카카오 로그인 복귀 레이스
- `/auth/kakao/result` 1회성 소비라 폴링/딥링크 경쟁 시 인증됐는데도 로그인화면 복귀 → `isAuthenticated` 가드 추가(DAR-114).

## Galaxy 빌드/실행 권장 절차

1. **백엔드**: docker DB 기동 → `npx prisma migrate deploy` → `npm run start:dev`. health(`:3000/health`) dart/krx/llm 키 확인.
2. **Metro(LAN)**: `EXPO_PUBLIC_API_URL=http://<Mac LAN IP>:3000/api REACT_NATIVE_PACKAGER_HOSTNAME=<Mac LAN IP> npx expo start --go --lan`. Wi-Fi 변경 시 IP 재설정.
3. **Galaxy**: 같은 Wi-Fi → Expo Go에서 `exp://<LAN IP>:8081` → Bundling 완료까지 대기.
4. **검증 자동화**: iOS는 `xcrun simctl`(스크린샷·딥링크), Android는 `adb`(tap/swipe/screencap) 가능. Android 에뮬레이터: `sdkmanager`로 `emulator`+`system-images;android-34;google_apis;arm64-v8a` 설치 → AVD 생성 → `expo start --go --android`.

## 권장: 정식 dev build (Expo Go 한계 대비)
- 프로젝트에 `expo-dev-client` 존재 → 원래 **development build 전제**. Expo Go는 이번 refreshControl 류 Fabric 이슈에 취약했음(수정으로 현재는 Expo Go에서도 동작).
- 장기적으로 Galaxy 안정 배포는 **EAS Build(Android dev/preview)** 또는 로컬 `expo run:android`로 dev build 생성 권장. 네이티브 모듈 정합 보장.
- ▶ **재현 가능한 dev build 생성·Galaxy 설치·Metro LAN·CI 게이트 절차는 [`mobile-dev-build.md`](./mobile-dev-build.md) 참조 (DAR-114).**

## 교차 검증 결과(2026-06-07)
- iOS 시뮬레이터: 정상.
- Android 에뮬레이터(Pixel6 API34): refreshControl 수정 후 홈·공시목록 등 FlatList **렌더+스크롤 정상** 확인.
- Galaxy 실기기: 사용자 확인 — 카드 정상 표시.

## Maestro 에뮬 스모크 하니스 (DAR-542)

> Android 에뮬(`dar_test`) 기준 핵심 3플로우 자동화. **CI 아님 — 로컬 재현용.**
> 이 스모크는 Android FlatList 백지 회귀(위 §1)를 상시 직격하고, 핵심 사용자 동선 3종의 렌더를 앵커로 고정한다.
> DoD 연계: `harness/VERIFICATION.md` 7번(모바일 E2E 스모크)의 표준 실행체.

### 핵심 3플로우 (`mobile/.maestro/`, tag: `core`)
| # | 파일 | 검증 동선 | 앵커(testID) |
|---|------|-----------|--------------|
| ① | `01-coldstart-guest-feed.yaml` | 콜드스타트 → 게스트 홈 렌더(피드 + 에디션 요약 슬롯) | `home-feed-list` · `home-edition-summary` |
| ② | `02-dev-login.yaml` | dev-login → 신호탭 매수·에디션 브라우징(날짜 스트립 탭) | `edition-date-strip` · `edition-date-chip` · `edition-signal-list` |
| ③ | `03-disclosure-detail.yaml` | 공시 상세 → 과거 유사공시 통계 섹션 노출 | `disclosure-detail-screen` · `disclosure-reaction-section` |

보조 스모크(비-core): `04-watchlist-add` · `05-notification-inbox` · `06-settings`. 전체 실행은 `npm run e2e:smoke`(= `maestro test .maestro/`).

### 실행 진입점
```bash
# 핵심 3플로우(core 태그)만 — Maestro 자동 설치·에뮬/앱 확인·rcpNo 자동탐색 포함.
scripts/maestro-smoke.sh

# 플로우 ②(dev-login)는 백엔드 서명 JWT 필요:
DEV_ACCESS=<jwt> DEV_REFRESH=<jwt> DEV_USER_ID=<uid> scripts/maestro-smoke.sh

# 플로우 ③ 대상 공시 고정(미지정 시 GET /disclosure-events 로 이벤트 보유 rcpNo 자동탐색):
DISCLOSURE_RCP_NO=<rcpNo> scripts/maestro-smoke.sh
```
로그는 `mobile/.maestro/.logs/smoke-core.log` 로도 남는다. 종료코드 0=3플로우 그린.

### 전제(그린 런 인프라)
1. **에뮬레이터**: `dar_test`(Android) 기동 상태(`adb devices` 로 확인). `adb`(platform-tools) 필요.
2. **대상 앱**: 플로우 appId 는 `com.gongsion.app`(**Expo Go 아님**). standalone 스모크 빌드가 에뮬에 설치돼야 한다:
   - (A) 로컬 dev 빌드 — `cd mobile && npx expo run:android` (Android SDK/gradle 필요, `__DEV__` 로 dev-login 자동 활성).
   - (B) EAS 프리뷰 APK — `cd mobile && EXPO_PUBLIC_ALLOW_DEV_LOGIN=true eas build -p android --profile preview` → `adb install <apk>`.
     프리뷰/프로덕션 빌드는 `__DEV__=false` 라 **플로우 ② dev-login 게이트(`app/dev-login.tsx`)를 열려면 빌드에 `EXPO_PUBLIC_ALLOW_DEV_LOGIN=true` 를 반드시 주입**해야 한다(`eas.json` 기본 프로파일엔 미포함 → 스모크 전용 빌드 필요).
3. **백엔드**: 기본 `API_BASE=https://168.138.198.152.nip.io/api`(배포본, DAR-427). 로컬 백엔드면 `API_BASE` 로 오버라이드.
4. **플로우 ② JWT**: `DEV_ACCESS`/`DEV_REFRESH`/`DEV_USER_ID` 는 백엔드 서명 실 JWT(무효 토큰은 API 401 → 인증 우회 아님).

### 플로우 ③ 결정론 주의
`DisclosureReactionSection`(DAR-512)은 **이벤트가 추출된 공시에만 마운트**된다(유형 없으면 비교 표본 부재 → 미렌더, 설계).
따라서 게스트 피드 첫 카드는 대개 절차성 공시(이벤트 없음)라 폴백 경로가 실패할 수 있다 →
`scripts/maestro-smoke.sh` 가 `GET /disclosure-events` 에서 **이벤트 보유 + 상세 로드 가능한 rcpNo 를 자동 탐색**해 `DISCLOSURE_RCP_NO` 로 주입한다.

### 실행 상태 / 남은 블로커
- 2026-07-17 기준 에뮬(`dar_test`)엔 **Expo Go 만 설치**돼 있고 `com.gongsion.app` 스모크 빌드가 없어 **3플로우 그린 런은 미실행**(전제 2 미충족).
- 하니스 자체(플로우·testID·스크립트·rcpNo 자동탐색)는 완비. **스모크 빌드 프로비저닝(위 (A)/(B)) 후 `scripts/maestro-smoke.sh` 실행이 그린 런의 유일한 남은 단계.**
- 실패 플로우는 결함 이슈로 분리 보고한다(하니스는 유지).
