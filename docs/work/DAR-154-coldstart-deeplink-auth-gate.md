# DAR-154 — 콜드스타트 딥링크 인증 게이트 경쟁 해소 (bug)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-154-coldstart-deeplink-auth-gate`

## 배경/증상
앱 종료 상태에서 알림 탭으로 콜드스타트하면, 인증/온보딩 상태와 무관하게 고정 지연(500ms) 후 딥링크 대상으로 push한다. 인증 게이트(Redirect)와 타이밍이 겹치면 비로그인 상태로 `/signals/{id}`에 진입해 401이 나거나, 라우팅이 게이트 리다이렉트에 덮여 사라진다.

## 근거 (코드)
- `hooks/useNotificationSetup.ts:91-108` — 콜드스타트 핸들러가 `resolveDeepLink(data)` 결과를 `setTimeout(() => router.push(target), 500)`로 인증/하이드레이션 무관하게 실행.
- `app/index.tsx` — Redirect 기반 인증 게이트. 위 push와 타이밍 경쟁 발생.

## 해결 방향 (구현 자유)
- 콜드스타트 딥링크 대상을 즉시 push하지 말고 pending target으로 저장(스토어/ref) → 인증·스토어 하이드레이션·온보딩 완료(게이트 통과) 후 한 번 소비.
- 비로그인 상태면 로그인 후 동선으로 이어지도록 보존, 임의 고정 지연(500ms) 의존 제거.

## 영향 파일
- `hooks/useNotificationSetup.ts`
- `app/index.tsx` (게이트 통과 시 pending target 소비 연동)

## 수용 기준 (DoD)
- [ ] 비로그인 콜드스타트 시 401/리다이렉트 덮임 없이 인증 후 대상 화면으로 정상 도달
- [ ] 로그인 상태 콜드스타트는 기존처럼 대상 화면 직접 진입
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
