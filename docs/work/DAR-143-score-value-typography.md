# DAR-143 — 핵심 점수 수치 타이포 위계 승격 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-143-score-value-typography`

## 배경/증상
카드의 주인공인 핵심 점수 수치가 좌측 보조 라벨과 거의 동급 크기로 렌더돼 시각적 위계가 무너진다. 사용자가 한눈에 "점수"를 읽지 못한다.

## 근거 (코드)
- `mobile/components/common/ScoreGauge.tsx:94` — 점수값이 `typo.captionMedium`(14px)로 렌더돼 좌측 라벨(`typo.small` 12px)과 거의 동급. 점수가 강조되지 않음.
- `mobile/theme/typography.ts` — `amount:32`, `h2:22` 등 강조용 토큰이 존재하나 점수 표시에 미사용.
- `mobile/components/signals/BuyScoreCard.tsx:78` · `mobile/components/signals/PositionCard.tsx:48` — 헤더 라벨칩 텍스트가 surfaceSecondary 위 textSecondary 12px(≈4.4:1)로 대비 여유 적음.

## 해결 방향 (구현 자유)
- 점수값에 `typo.h2`(22px/700) 이상 토큰 적용. 색상은 기존 `buyScoreColor`/`exitScoreColor` 로직 유지(하드코딩 금지).
- 헤더 라벨칩(`BuyScoreCard.tsx:78`, `PositionCard.tsx:48`) 텍스트 대비 점검 → surfaceSecondary 위 textSecondary 12px는 `text` 토큰으로 상향하거나 fontWeight 500↑로 보강.
- 라벨과 수치의 크기 차이를 명확히 두어 카드 주인공이 점수임을 드러낸다.

## 영향 파일
- `mobile/components/common/ScoreGauge.tsx`
- `mobile/components/signals/BuyScoreCard.tsx`
- `mobile/components/signals/PositionCard.tsx`

## 수용 기준 (DoD)
- [ ] 점수 수치가 라벨 대비 명확히 큰 위계로 렌더되고, 점수 색상 로직(buy/exit) 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 테마 토큰 사용(하드코딩 색상/매직넘버 금지)
