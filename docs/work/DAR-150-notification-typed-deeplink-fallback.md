# DAR-150 — 알림 타입별 딥링크 폴백 라우팅(dead tap 해소) (bug)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: high · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-150-notification-typed-deeplink-fallback`

## 배경/증상
알림 인박스에서 SIGNAL/EXIT/THESIS_VIOLATED 타입 알림을 탭해도, 백엔드가 `deepLink`를 미충전한 경우 아무 화면도 열리지 않고 읽음처리만 된다. disclosure 폴백만 존재해 비공시 타입은 dead tap이 된다.

## 근거 (코드)
- `app/(tabs)/notifications/index.tsx:142-154` — `handleNotificationPress`가 `resolveDeepLink`이 null이면 읽음처리만 수행하고 라우팅 없음.
- `utils/deeplink.ts:37` — `resolveDeepLink`는 (1) `deepLink` 화이트리스트, (2) `disclosureRcpNo` 폴백만 처리. SIGNAL/EXIT/THESIS_VIOLATED는 disclosure가 null이라 백엔드가 deepLink 미충전 시 대상 도출 불가.

## 해결 방향 (구현 자유)
- 알림 페이로드의 타입·refId를 활용한 타입별 폴백 추가: SIGNAL → `/signals/{refId}`, EXIT/THESIS_VIOLATED → `/portfolio`(또는 가능 시 해당 포지션) 등. 화이트리스트(`ALLOWED_DEEPLINK_PREFIXES`) 신뢰 경계는 유지.
- 폴백으로도 대상을 못 만들면 스낵바로 "해당 항목을 열 수 없습니다" 안내하여 무반응(dead tap) 제거.

## 영향 파일
- `utils/deeplink.ts`
- `app/(tabs)/notifications/index.tsx`

## 수용 기준 (DoD)
- [ ] SIGNAL/EXIT/THESIS_VIOLATED 알림 탭 시 적절한 화면으로 이동(또는 안내 스낵바 노출), 무반응 없음
- [ ] 임의 라우팅 방지(화이트리스트 prefix 경계) 유지
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
