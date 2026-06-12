# DAR-148 — 저대비 색 보정(보합 손익·필터칩 도트) (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-148-low-contrast-color-cluster`

## 배경/증상
보합(0%) 손익 표기가 textTertiary로 렌더돼 거의 보이지 않고, 필터 칩의 유형색 도트가 비활성에만 표시돼 활성 시 색 단서가 사라진다. 시인성·정보 단서가 약하다.

## 근거 (코드)
- `mobile/utils/signalDisplay.ts:176` — `pnlColor` 0% 분기가 `textTertiary` 반환.
- `mobile/components/common/PriceChangeChip.tsx:26,37` — "0.00%"가 ≈2.5:1로 거의 안 보임. 칩 배경 surfaceSecondary로 대비 더 낮아짐.
- `mobile/app/disclosures/index.tsx:245-247` — `chipDot`(유형색)이 비활성 칩에만 표시되고 활성 시 사라져 색맹 단서 손실(라벨 병행이라 우선순위 낮음).

## 해결 방향 (구현 자유)
- 보합(0%)은 `textTertiary` → `textSecondary`로 상향(방향 아이콘 `minus` 병행 유지).
- 활성 칩에도 유형색 도트를 유지할지 검토(라벨 병행이므로 보조 개선).
- 토큰 우회·하드코딩 색상 금지.

## 영향 파일
- `mobile/utils/signalDisplay.ts`
- `mobile/components/common/PriceChangeChip.tsx`
- `mobile/app/disclosures/index.tsx`

## 수용 기준 (DoD)
- [ ] 보합 손익 텍스트가 AA 수준으로 가독, 상승/하락 색·아이콘 회귀 없음
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 렌더 확인 (정본: `docs/mobile-cross-platform-issues.md`)
- [ ] 테마 토큰 사용(하드코딩 색상/매직넘버 금지)
