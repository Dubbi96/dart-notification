# DAR-151 — 모의투자 빈 상태 CTA 버튼 활성화 (bug)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-151-paper-trading-empty-cta`

## 배경/증상
모의투자 탭의 빈 상태에서 "시작하기" CTA 카피는 존재하나 버튼이 렌더되지 않아, 사용자가 모의투자를 시작할 수 없는 막다른 길이 된다.

## 근거 (코드)
- `app/(tabs)/portfolio/index.tsx:221` — `<EmptyState {...emptyStateCopy.paperTradingEmpty} />`에 `onAction` 미전달.
- `components/common/StateView.tsx:56` — `EmptyState`는 `actionLabel && onAction` 둘 다 있을 때만 액션 버튼을 렌더.
- 카피에는 "시작하기" `actionLabel`이 있으나 `onAction` 부재로 버튼 미노출.

## 해결 방향 (구현 자유)
- 모의투자 시작 핸들러를 `onAction`으로 주입(모의투자 시작 화면 라우팅 또는 시작 mutation 트리거).
- 적절한 시작 동선이 없을 경우 가장 근접한 진입 화면으로 라우팅하고 동작을 명확히.

## 영향 파일
- `app/(tabs)/portfolio/index.tsx`

## 수용 기준 (DoD)
- [ ] 모의투자 빈 상태에서 CTA 버튼이 노출되고 탭 시 시작 동선이 정상 동작
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
