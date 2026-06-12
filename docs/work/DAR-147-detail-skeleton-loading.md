# DAR-147 — 상세 화면 로딩 스켈레톤 통일(레이아웃 점프 제거) (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-147-detail-skeleton-loading`

## 배경/증상
리스트 화면은 SkeletonCard로 자연스럽게 로딩하지만, 상세/탭 화면은 중앙 ActivityIndicator(LoadingState)를 쓴다. 로딩→콘텐츠 전환 시 레이아웃이 크게 점프해 체감 품질이 떨어진다.

## 근거 (코드)
- 상세/탭 화면이 `LoadingState`(중앙 ActivityIndicator) 사용:
  - `mobile/app/company/[corpCode].tsx`
  - `mobile/app/signals/[id].tsx`
  - `mobile/app/portfolio/[portfolioId]/position/[positionId]/index.tsx`
  - `mobile/app/event-stats/index.tsx`
- 공통 로딩 컴포넌트: `mobile/components/common/StateView.tsx:16`.
- 리스트 화면은 SkeletonCard 기반이라 상세 화면과 로딩 UX가 불일치.

## 해결 방향 (구현 자유)
- 구조가 고정된 상세(점수카드·재무표 등)는 해당 레이아웃 형태의 `SkeletonCard` 기반 플레이스홀더로 통일해 로딩→콘텐츠 점프를 제거.
- 공통 컴포넌트(StateView/SkeletonCard) 재사용으로 일관성 확보.

## 영향 파일
- `mobile/components/common/StateView.tsx`
- `mobile/app/company/[corpCode].tsx`
- `mobile/app/signals/[id].tsx`
- `mobile/app/portfolio/[portfolioId]/position/[positionId]/index.tsx`
- `mobile/app/event-stats/index.tsx`

## 수용 기준 (DoD)
- [ ] 상세/탭 화면 로딩이 스켈레톤으로 통일되고, 로딩→콘텐츠 전환 시 레이아웃 점프 제거·에러/빈상태 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 테마 토큰 사용(하드코딩 색상/매직넘버 금지)
