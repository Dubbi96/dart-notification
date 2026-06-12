# DAR-155 — 공시 카드·상세에서 기업 바로가기 + 관심 추가 퀵액션 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: medium · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-155-disclosure-company-quickaction`

## 배경/증상
공시 목록/알림에서 종목 허브로 가려면 공시 카드 → 공시 상세 → 기업명 행을 거쳐야 하는 2홉 동선이다. 관심기업 등록은 기업 상세까지 가야 해 3탭이 필요하다. 자주 쓰는 동작이 너무 멀다.

## 근거 (코드)
- `app/disclosures/index.tsx:102` — 카드 탭이 `/disclosure/{rcpNo}`로만 이동, 종목 직행 없음.
- `app/disclosure/[id].tsx:117` — 종목으로 가려면 공시 상세의 기업명 행을 추가로 탭(2홉).
- `app/disclosure/[id].tsx:137-147,301` — 헤더 액션이 북마크·공유뿐, 관심등록 없음 → 관심 추가는 기업 상세까지 3탭.

## 해결 방향 (구현 자유)
- 공시 카드에 기업명 보조 탭 영역을 두어 `/company/{corpCode}` 바로가기 제공(카드 본 탭은 공시 상세 유지).
- 공시 상세 헤더에 watchlist 토글 추가 — 기존 `useAddToWatchlist`(및 제거 훅) 재사용.
- 터치 타깃·a11y 라벨 확보, 보조 탭과 본 탭 영역 충돌 없도록 분리.

## 영향 파일
- `app/disclosures/index.tsx`
- `app/disclosure/[id].tsx`

## 수용 기준 (DoD)
- [ ] 공시 카드에서 기업 허브로 1탭 이동, 공시 상세에서 관심 토글 1탭 가능
- [ ] watchlist 토글 상태가 서버 상태와 동기(React Query invalidate)
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
