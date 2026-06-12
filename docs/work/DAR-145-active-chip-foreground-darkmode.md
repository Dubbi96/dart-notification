# DAR-145 — 활성 칩·탭 흰색 하드코딩 → primaryForeground (다크모드 대비) (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: high · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-145-active-chip-foreground-darkmode`

## 배경/증상
활성 칩·세그먼트 탭의 전경색이 `#FFFFFF`로 하드코딩돼 테마를 우회한다. 다크모드 primary(`#818CF8`) 위 흰 텍스트는 ≈3.0:1로 AA 미달이라 활성 라벨이 흐릿하게 보인다.

## 근거 (코드)
- 활성 배경 `colors.primary` 위 `#FFFFFF` 하드코딩:
  - `mobile/app/disclosures/index.tsx:215,221,252`
  - `mobile/app/(tabs)/home/index.tsx:161,181,187`
  - `mobile/app/(tabs)/portfolio/index.tsx:269`
  - `mobile/components/signals/SignalExplorer.tsx:75`
- 다크 primary `#818CF8` 위 흰 텍스트 ≈3.0:1 → AA 미달.
- 테마에 `primaryForeground`(다크=navy950) 토큰 존재 → 활성 배경 위 ≈6.4:1.

## 해결 방향 (구현 자유)
- 위 사용처의 하드코딩 `#FFFFFF`를 전량 `colors.primaryForeground`로 교체해 테마 우회를 제거한다.
- light/dark 모두에서 활성 칩 전경 대비가 AA를 충족하는지 확인.

## 영향 파일
- `mobile/app/disclosures/index.tsx`
- `mobile/app/(tabs)/home/index.tsx`
- `mobile/app/(tabs)/portfolio/index.tsx`
- `mobile/components/signals/SignalExplorer.tsx`

## 수용 기준 (DoD)
- [ ] 활성 칩·탭 전경이 `primaryForeground`로 통일, light/dark 양쪽 AA 충족·라벨 가독 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 테마 토큰 사용(하드코딩 색상/매직넘버 금지)
