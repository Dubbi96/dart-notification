# DAR-165 — 워치리스트 신규 공시 unread 배지 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: medium · effort: medium
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-165-watchlist-unread-badge`

## 배경/문제
워치리스트 아이템은 `lastDisclosureDate`(max rcpDt)만 파생할 뿐, "마지막으로 본 이후 신규 공시 N건"을 세지 않는다. 재방문 시 관심종목에 새 공시가 쌓였는지 한눈에 알 수 없어 재방문 유인이 약하다.

## 근거 (코드)
- `backend/src/watchlist/watchlist.service.ts:42-46` — `latestMap.get(item.corpCode)`로 `lastDisclosureDate`만 파생, 신규 카운트 없음.

## 해결 방향 (구현 자유)
- 백엔드(횡단 watchlist): 워치리스트 아이템에 `lastViewedAt`(사용자가 해당 종목을 마지막 조회한 시각) 추적 + 그 이후 신규 공시 수(`newDisclosureCount`) 파생. lastViewedAt 갱신용 `POST /watchlist/:corpCode/viewed`(또는 종목 상세 진입 시 갱신). 신규 카운트는 rcpDt > lastViewedAt 집계. 스키마에 lastViewedAt 컬럼 추가 시 마이그레이션 커밋. 상대경로 import.
- 모바일: 워치리스트 아이템에 점 배지 + 신규 건수. 종목 상세 진입 시 viewed 갱신 mutation → `queryClient.invalidateQueries(['watchlist'])`.

## 영향 파일
- `backend/src/watchlist/watchlist.service.ts`, `watchlist.controller.ts`, `backend/prisma/schema.prisma`(lastViewedAt 추가 시)
- `mobile/app/.../watchlist`, `mobile/app/company/[corpCode].tsx`, `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`, `docs/database-schema.md`(스키마 변경 시)

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] 워치리스트 아이템에 lastViewedAt 이후 신규 공시 수 파생 + 점 배지 노출, 상세 진입 시 viewed 갱신으로 배지 소거
- [ ] 스키마 변경(lastViewedAt) 시 마이그레이션 커밋 + `database-schema.md` 갱신 (컬럼 없이 구현하면 "스키마 변경 없음" 명시)
- [ ] AI 금지영역 미침범 · 문서 동기화(`docs/api-specification.md`)
