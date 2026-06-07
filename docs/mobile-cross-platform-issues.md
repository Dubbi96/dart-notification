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

## 교차 검증 결과(2026-06-07)
- iOS 시뮬레이터: 정상.
- Android 에뮬레이터(Pixel6 API34): refreshControl 수정 후 홈·공시목록 등 FlatList **렌더+스크롤 정상** 확인.
- Galaxy 실기기: 사용자 확인 — 카드 정상 표시.
