# DAR-153 — 시세·점수 상세 화면 새로고침(RefreshControl/focus refetch) (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-153-detail-pull-to-refresh`

## 배경/증상
신호 상세·기업 상세·포지션 상세는 시세/점수 등 변동 데이터를 보여주지만 pull-to-refresh가 없어, 화면을 떠났다 다시 들어와야만 갱신된다. 실시간성이 중요한 화면에서 데이터가 정체된다.

## 근거 (코드)
- `app/signals/[id].tsx:168` — ScrollView, RefreshControl 없음.
- `app/company/[corpCode].tsx` — 판단 탭 외 탭들도 ScrollView 기반, 수동 새로고침 없음.
- `app/portfolio/[portfolioId]/position/[positionId]/index.tsx:84` — ScrollView, 새로고침 없음.

## 해결 방향 (구현 자유)
- 각 ScrollView에 `RefreshControl` 추가 → 해당 화면 React Query 쿼리 `refetch` 연결.
- 또는 `useFocusEffect`로 화면 포커스 시 `refetch`(과도한 호출 방지 위해 staleTime/조건 고려).
- 둘 중 화면 특성에 맞게 적용(시세성 강한 화면은 RefreshControl 권장).

## 영향 파일
- `app/signals/[id].tsx`
- `app/company/[corpCode].tsx`
- `app/portfolio/[portfolioId]/position/[positionId]/index.tsx`

## 수용 기준 (DoD)
- [ ] 세 상세 화면에서 당겨서 새로고침 또는 포커스 복귀 시 최신 데이터로 갱신
- [ ] 로딩 인디케이터 표시·중복 호출 과다 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
