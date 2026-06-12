# DAR-164 — 통합 검색(기업+공시) 엔드포인트 + 단일 검색바 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: medium · effort: medium
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-164-unified-search-api`

## 배경/문제
기업 검색과 공시 검색이 별개 엔드포인트로 분리돼 있어 단일 진입점이 없다. 사용자는 무엇을 찾을지에 따라 검색 위치를 바꿔야 한다. 통합 검색바 하나로 기업·공시·이벤트를 한 번에 찾는 경험이 없다.

## 근거 (코드)
- `backend/src/companies/companies.controller.ts:17` — `@Get('search')`(기업명/종목코드).
- `backend/src/engine1-disclosure/disclosures/disclosures.controller.ts:31` — `@Get('search')`(공시).
- 두 검색을 묶는 단일 엔드포인트 없음.

## 해결 방향 (구현 자유)
- 백엔드(횡단): `GET /search?q=` 추가. 기업·공시(필요 시 이벤트) 결과를 카테고리별 묶음으로 반환(`{ companies: [...], disclosures: [...] }`). 내부적으로 기존 companies/disclosures 서비스 재사용(중복 로직 금지). 각 카테고리 limit·총건수 포함. 엔진 경계 준수(Engine1 disclosure 서비스는 직접 호출 최소화, 가능하면 모듈 주입). 상대경로 import.
- 모바일: 단일 검색바 화면. `useUnifiedSearch(q)` React Query 훅(`enabled: q.length >= 2`). 결과를 기업/공시 섹션으로 구분 렌더, 각 항목 탭 시 상세 이동.

## 영향 파일
- `backend/src/`(신규 search 모듈/컨트롤러 또는 적절한 횡단 위치), companies·disclosures 서비스 재사용
- `mobile/app/.../search`, `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] `GET /search?q=`가 기업·공시 카테고리 묶음 반환, q<2 가드
- [ ] 단일 검색바에서 기업/공시 섹션 분리 노출 + 상세 이동 동작
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범 · 문서 동기화(`docs/api-specification.md`)
