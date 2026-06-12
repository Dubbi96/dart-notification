# DAR-157 — 신호 검색 결과 무한스크롤/페이지네이션 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: low · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-157-signal-search-pagination`

## 배경/증상
신호 탐색 화면에서 검색을 하면 결과가 첫 페이지로 잘린다. 무한스크롤(onEndReached)이 검색 중에는 비활성화돼, 검색 결과가 1페이지를 넘으면 나머지를 볼 수 없다.

## 근거 (코드)
- `components/signals/SignalExplorer.tsx:230-236` — `onEndReached`가 `!isSearching`일 때만 `fetchNextPage` 호출 → 검색 모드에서는 페이지 추가 로드 안 됨.

## 해결 방향 (구현 자유)
- 검색 쿼리도 `useInfiniteQuery`로 페이지네이션하여 검색 중에도 `onEndReached`에서 다음 페이지 로드.
- 백엔드 검색이 페이지네이션 미지원이면 최소한 "검색 결과 N건 중 상위 M건 표시" 안내 + 범위 한계 명시.

## 영향 파일
- `components/signals/SignalExplorer.tsx`
- (검색 데이터 훅) `hooks/` 내 신호 검색 관련 훅

## 수용 기준 (DoD)
- [ ] 검색 결과가 1페이지를 넘어도 스크롤로 추가 로드되거나, 결과 수·표시 한계를 명확히 안내
- [ ] 일반 목록 무한스크롤 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
