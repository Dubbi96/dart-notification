# DAR-146 — 필터 칩·세그먼트 탭 터치 영역 44pt 확보 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-146-chip-touch-target-44pt`

## 배경/증상
필터 칩과 세그먼트 탭의 실효 터치 높이가 44pt 미만이고 hitSlop도 없어, 12px 텍스트 칩에서 오탭 위험이 높다. 같은 헤더의 browseButton은 hitSlop을 가져 일관성도 깨진다.

## 근거 (코드)
- `mobile/app/disclosures/index.tsx` — `filterChip` height:34 고정, hitSlop 없음.
- `mobile/app/(tabs)/home/index.tsx:454` — `segmentTab` paddingVertical `spacing.sm`(8) → 실효 높이 ≈36px, hitSlop 없음.
- 동일 헤더 `browseButton`은 hitSlop 보유 → 대조적으로 칩·탭만 미달.
- 접근성 기준(터치 영역 최소 44x44pt) 위반.

## 해결 방향 (구현 자유)
- 칩·세그먼트 탭의 최소 높이 44pt를 확보하거나, 시각 크기 유지가 필요하면 `hitSlop`으로 유효 터치 영역을 44pt까지 확장.
- spacing/사이즈는 `theme/` 토큰 사용(매직넘버 금지).

## 영향 파일
- `mobile/app/disclosures/index.tsx`
- `mobile/app/(tabs)/home/index.tsx`

## 수용 기준 (DoD)
- [ ] 필터 칩·세그먼트 탭의 유효 터치 영역 ≥44x44pt, 시각 레이아웃 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 테마 토큰 사용(하드코딩 색상/매직넘버 금지)
