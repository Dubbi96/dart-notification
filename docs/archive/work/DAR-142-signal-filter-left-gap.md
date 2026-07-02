# DAR-142 — 신호 필터 칩 행 좌측 공백 (bug)

> 등록: 2026-06-08 (사용자 리포트, Android 에뮬레이터 실측) · layer: mobile · severity: low · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-142-signal-filter-left-gap`
> 📦 아카이브(2026-07-02) — 해소 경위: PR #99(fix/DAR-141-142-ui-bugs)는 머지 없이 클로즈됐고, 실제 해소는 DAR-196 필터 토글 전면 재작업(커밋 74eefdb0) + 에뮬레이터 검증. 원인으로 지목된 `flexGrow:1` 스타일은 SignalExplorer.tsx에 미수정 잔존하나 증상은 재현되지 않음.

## 증상
신호(Signals) 화면 `전체 신호 탐색` 필터 영역 — `등급 / 투자성향 / 이벤트` 칩 행에서 **왼쪽에 불필요한 공백**. 칩 행 좌측 시작 정렬이 어색하게 떨어져 있음.

## 재현
1. 로그인 → 하단탭 `신호` 진입
2. 스크롤하여 `전체 신호 탐색` 섹션의 등급/투자성향/이벤트 칩 행 확인 → 칩 행 왼쪽 공백

## 원인 가설
`mobile/components/signals/SignalExplorer.tsx` 의 `FilterChipRow`(39-88)가 가로 `ScrollView`이고, `contentContainerStyle={styles.chipRow}`(282-286)에 `flexGrow: 1` + `paddingHorizontal: spacing.lg`가 함께 적용됨. 가로 ScrollView contentContainer의 `flexGrow: 1`은 콘텐츠가 폭을 못 채울 때 레이아웃을 늘려 정렬이 어긋날 수 있음(좌측 공백/정렬 이상 유발 의심). 섹션 헤더(`filterLabel`, `sortRow`)의 좌측 정렬(`spacing.lg`)과 칩 행 첫 칩의 정렬 일관성 함께 점검.

## 해결 방향 (구현 자유)
- `chipRow`의 `flexGrow: 1` 제거 또는 정렬 보정, 칩 행 첫 칩이 섹션 라벨(`등급`/`투자성향`/`이벤트`)과 좌측 정렬 일치하도록.
- 등급/투자성향/이벤트 3개 행 모두 일관 적용. 테마 토큰 사용(하드코딩 금지).

## 영향 파일
- `mobile/components/signals/SignalExplorer.tsx` (`FilterChipRow`, `styles.chipRow`/`filterLabel`)

## 수용 기준 (DoD)
- [ ] 등급/투자성향/이벤트 칩 행 좌측 공백 제거 — 첫 칩이 섹션 라벨과 좌측 정렬 일치
- [ ] 가로 스크롤·칩 선택 동작 정상 (회귀 없음)
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
