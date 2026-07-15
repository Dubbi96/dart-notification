# 모바일(Expo) — 도메인 규칙

> 상위: 루트 `CLAUDE.md`(전역 + RN 베스트프랙티스 전체) · 역할: `docs/roadmap/roles/fe.md`
> 이 파일은 `mobile/` 작업 시 자동 로드되는 **FE 도메인 컨텍스트 패키지**다. RN 성능/접근성/상태관리 상세 규칙은 루트 `CLAUDE.md`를 정본으로 따른다.

## 스택 (고정)

- React Native **Expo** · 네비게이션 **Expo Router**(파일 기반) · UI **React Native Paper + StyleSheet**
- 서버 상태 **React Query** / 클라이언트 상태 **Zustand** — 둘을 혼용하지 않음(서버 데이터를 Zustand에 복제 금지)
- 저장소 **expo-secure-store** (AsyncStorage 금지 — Expo Go 미지원)
- 테마 **Teal** — `theme/colors.ts`의 `lightColors`/`darkColors` 토큰만 사용(하드코딩 색상 금지)
- 아이콘 **Feather**(thin stroke) 선호 · NativeWind/Tailwind **금지**
- Path alias: `@components` `@theme` `@hooks` `@services` `@stores` `@app-types`(NOT `@types`) `@utils`

## FE 소유 영역 (`roles/fe.md`)

| 영역 | 위치 |
|---|---|
| 화면 | `app/**/*.tsx` (Expo Router), `app/(tabs)/_layout.tsx` |
| 컴포넌트 | `components/**` (공통 + 도메인별) |
| 서버 상태 훅 | `hooks/**` — `useSignals`·`usePortfolio`·`useOrderRequest` 등 |
| 클라이언트 상태 | `stores/**` — Persona 선택·Kill Switch·미읽음 배지 |
| 푸시·딥링크 | Expo 푸시 권한/토큰 등록, 딥링크 라우팅(`gongsion://`) |
| 차트 | 주가/지표 시각화 (M4 이후 단계 도입) |

## 핵심 규칙 (루트 CLAUDE.md 요약)

- 함수형 컴포넌트만, Props 인터페이스 필수, `any` 금지. variant/size 패턴.
- 긴 리스트는 `FlatList`/`FlashList`(+ `keyExtractor`·`getItemLayout`·`initialNumToRender`). `ScrollView` 금지.
- `renderItem`/자식 전달 함수는 `useCallback`, 비싼 계산은 `useMemo`, 인라인 객체/함수 지양.
- 모든 API 호출은 React Query 훅으로 래핑(`hooks/`). 컴포넌트에서 직접 axios/fetch 금지. 서비스 함수는 `services/`.
- `queryKey` 컨벤션 `[entity, ...params]`. 쓰기 후 `invalidateQueries`.
- 터치 영역 ≥ 44pt, 의미있는 `accessibilityLabel`/`accessibilityRole`.

## 도메인-백엔드 계약

- 신호/승인/포지션 데이터는 백엔드 엔진(Engine3 신호·Engine4 포트폴리오·Engine5 주문)의 API 응답을 따른다 — `docs/api-specification.md`.
- **AI는 참고 정보**다. 최종 주문 승인 UI는 사용자 명시 액션이며, 자동 승인 UI를 만들지 않는다(정책: `roles/plan-policy.md`).

## 업데이트 규율 (expo-updates / EAS Update)

stale APK 배포 사고(2026-06-25 단타 시각 버그 수정 미반영 실재) 재발 방지 — 바이너리/JS 이중 레일을 반드시 구분한다.

- **네이티브 의존성 변경 = 바이너리 재빌드 필수**: 네이티브 모듈 추가/제거/버전 변경, Expo SDK 업그레이드, `app.json`의 네이티브 영역(plugins·android·ios) 변경 시 `eas build`로 새 APK/AAB를 만들어 재배포한다. 이 경우 EAS Update만 내보내면 안 된다.
- **JS-only 수정 = EAS Update 채널 배포**: TS/TSX·에셋 등 JS 번들만 바뀐 핫픽스는 `eas update --channel <프로파일 채널>`로 배포한다. 채널은 `eas.json` 빌드 프로파일과 1:1(production/preview/oci) — 빌드가 태어난 채널로만 업데이트가 도달한다.
- **runtimeVersion 정책 준수 (미준수 시 크래시)**: 정책은 `app.json`의 `runtimeVersion: { "policy": "appVersion" }` — 즉 `version` 필드가 네이티브 호환성 경계다. 네이티브가 변한 빌드는 반드시 `version`을 올려서 구 바이너리에 신 JS가 배달되지 않게 한다. 네이티브 변경 후 버전 미상승 상태로 `eas update`를 내보내면 구 APK가 신 번들을 받아 **앱이 크래시**한다.
- 런타임에서 `expo-updates`를 직접 import하는 코드는 작성하지 않는다(기본 launch 체크 동작 사용). 커스텀 업데이트 UX가 필요해지면 별도 이슈로 설계 후 도입한다.

## DoD

- `npm run lint` 통과 · 타입 에러 0 · Expo Go에서 동작 확인(secure-store 등 네이티브 제약 준수).

### 크로스플랫폼 회귀 가드 (필수) — 정본: [`docs/mobile-cross-platform-issues.md`](../docs/mobile-cross-platform-issues.md)

2026-06-07 refreshControl 커스텀 래퍼가 RN 0.85 Fabric(Android)에서 **모든 FlatList를 백지화**한 장기 버그 재발 방지. 리스트/스크롤 화면 작업 시 아래를 만족해야 완료:

1. **`refreshControl` prop에 커스텀 컴포넌트 금지** — ESLint `no-restricted-syntax`로 강제(에러). FlatList는 `refreshing`/`onRefresh` props, ScrollView는 RN 코어 `<RefreshControl>` 엘리먼트만 직접 전달. (`AppRefreshControl` 류 래퍼 제거됨 — 재도입 금지)
2. **`keyExtractor` 고유성 점검** — 키가 모든 데이터에서 충돌 불가능한지 확인(`${corpCode}-${stockCode}`처럼 복수 포지션 충돌 주의 → 고유 id 또는 `-${index}` 포함). 정적 린트로 의미적 충돌은 못 잡으니 리뷰 체크 필수.
3. **신규 리스트 화면은 iOS+Android 양쪽 렌더 확인** — iOS `xcrun simctl`(스크린샷), Android `adb shell screencap`로 헤더·아이템·빈상태가 실제로 그려지는지 교차 검증(Android 단독 백지 회귀 차단).
