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

## DoD

- `npm run lint` 통과 · 타입 에러 0 · Expo Go에서 동작 확인(secure-store 등 네이티브 제약 준수).
