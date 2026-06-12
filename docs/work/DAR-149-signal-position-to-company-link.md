# DAR-149 — 신호·포지션 상세 → 기업 허브 링크 연결 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: mobile · severity: high · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-149-signal-position-to-company-link`

## 배경/증상
매수·매도 신호 상세와 포지션 상세에서 종목명을 헤더로 보여주지만, 종목 허브(`/company/{corpCode}`)로 이동하는 동선이 없다. 사용자가 신호/포지션을 본 뒤 해당 기업의 종합 정보로 갈 수 없어 막다른 길이 된다.

## 근거 (코드)
- `app/signals/[id].tsx:185` — `signal.corpName`을 헤더 타이틀로 표시하나, 이동 링크는 관련공시 섹션(`app/signals/[id].tsx:279-297`)뿐.
- `types/signal.types.ts:52,84` — `TradingSignal`/`ExitSignal` 모두 `corpCode` 보유.
- `app/portfolio/[portfolioId]/position/[positionId]/index.tsx:88` — 종목명 표시. 이동 링크는 Thesis 섹션(`:117-134`)뿐.
- `types/portfolio.types.ts:13` — `Position`에 `corpCode` 보유.
- 결과: 매수/매도/포지션 어느 화면에서도 종목 허브로 직접 진입 불가.

## 해결 방향 (구현 자유)
- 신호/포지션 상세의 종목명(또는 종목 헤더 영역)을 탭 가능한 요소로 만들어 `router.push('/company/' + corpCode)` 연결.
- 가능 시 "관심기업 추가" 퀵액션(`useAddToWatchlist`)을 동반 배치하여 한 화면에서 허브 이동·관심 등록을 모두 처리.
- 탭 가능 영역은 터치 타깃 44x44pt·`accessibilityRole="link"`·`accessibilityLabel` 확보.

## 영향 파일
- `app/signals/[id].tsx`
- `app/portfolio/[portfolioId]/position/[positionId]/index.tsx`

## 수용 기준 (DoD)
- [ ] 매수·매도 신호 상세, 포지션 상세에서 종목명 탭 시 `/company/{corpCode}`로 이동
- [ ] corpCode 부재 등 예외 시 안전 처리(링크 비활성 또는 미노출)
- [ ] `npm run lint` 통과 · 타입 에러 0
- [ ] **크로스플랫폼 가드**: iOS(`simctl`) + Android(`adb screencap`) 양쪽 확인 (정본: `docs/mobile-cross-platform-issues.md`)
