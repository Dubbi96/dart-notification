# DAR-144 — textTertiary 가독 텍스트 대비 AA 확보 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: high · effort: medium
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-144-text-tertiary-contrast`

## 배경/증상
`textTertiary` 토큰이 WCAG AA(4.5:1)에 미달하는데, 장식이 아닌 "읽어야 하는" 가독 카피에 광범위하게 사용돼 가독성을 해친다. 자체 규정(StateView 주석)도 위반된 상태다.

## 근거 (코드)
- `mobile/theme/colors.ts:71` — light `gray400 #9CA3AF` ≈2.5:1, dark `#5C6180` ≈3.1:1 → AA(4.5:1) 미달.
- 가독 텍스트 오용처:
  - `mobile/app/settings-detail/notification-settings.tsx:179,213,268,377`
  - `mobile/app/legal/privacy.tsx:31,119`
  - `mobile/app/portfolio/trade-history.tsx:295,311`
  - `mobile/app/disclosures/index.tsx:134`
- `mobile/components/common/StateView.tsx:42` — 주석이 "읽는 텍스트는 textSecondary" 라 자체 규정하나 위 사용처가 이를 위반.

## 해결 방향 (구현 자유)
- 장식 외 가독 텍스트는 `textSecondary`로 승격(둘 중 택1 또는 병행):
  - (a) 오용처를 `textSecondary`로 일괄 승격, 또는
  - (b) `textTertiary` 토큰을 light `gray500` · dark `#7B82A0` 수준으로 전역 상향.
- 영향 범위가 넓으므로 토큰 조정 + 명백한 오용처 승격 병행을 권장.
- 토큰 우회·하드코딩 색상 금지.

## 영향 파일
- `mobile/theme/colors.ts`
- `mobile/app/settings-detail/notification-settings.tsx`
- `mobile/app/legal/privacy.tsx`
- `mobile/app/portfolio/trade-history.tsx`
- `mobile/app/disclosures/index.tsx`

## 수용 기준 (DoD)
- [ ] 가독 카피가 light/dark 양쪽에서 AA(4.5:1) 충족, 장식용 사용처 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 테마 토큰 사용(하드코딩 색상/매직넘버 금지)
