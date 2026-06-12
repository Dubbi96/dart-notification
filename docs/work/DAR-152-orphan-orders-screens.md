# DAR-152 — 고아 화면 orders 정리(진입점 부여 또는 제거) (bug)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-152-orphan-orders-screens`

## 배경/증상
`app/orders/pending.tsx`, `app/orders/history.tsx`는 완성돼 있으나 어떤 진입점도 없다(라우팅·딥링크·레이아웃 등록 0건). 게다가 두 화면의 CTA는 오히려 `/portfolio/trade-history`로 빠져나가 자기 자신으로 돌아오지 못한다.

## 근거 (코드)
- `app/orders/pending.tsx`, `app/orders/history.tsx` — 완성됐으나 `router.push`/`Redirect`/딥링크 참조 0건, `_layout.tsx` 미등록.
- `utils/deeplink.ts:11` — `ALLOWED_DEEPLINK_PREFIXES` 화이트리스트에 `/orders` 없음.
- `app/orders/pending.tsx:43`, `app/orders/history.tsx:41` — CTA가 `/portfolio/trade-history`로 이동.

## 해결 방향 (구현 자유)
- 두 화면을 유지한다면: 포트폴리오 또는 설정 화면에 진입점(버튼/메뉴) 부여 + `_layout.tsx` 라우트 등록. 알림 연동이 필요하면 `/orders` prefix를 deeplink 화이트리스트에 추가.
- 사용 계획이 없다면: 화면 파일 제거로 데드코드 정리.
- 결정에 맞춰 CTA 동선 정합성도 함께 정리.

## 영향 파일
- `app/orders/pending.tsx`
- `app/orders/history.tsx`
- `app/_layout.tsx` (등록 시)
- `utils/deeplink.ts` (딥링크 연동 시)

## 수용 기준 (DoD)
- [ ] orders 화면이 진입 가능한 동선을 갖거나(등록), 흔적 없이 제거됨(데드코드 0)
- [ ] 유지 시 화면 CTA 동선이 일관됨, 라우트 정상 등록
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
