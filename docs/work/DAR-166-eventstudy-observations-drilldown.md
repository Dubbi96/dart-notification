# DAR-166 — EventStudy 버킷 관측치 드릴다운 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: low · effort: medium
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-166-eventstudy-observations-drilldown`

## 배경/문제
EventStudy 통계는 버킷 집계(평균 CAR 등)만 노출하고, 버킷을 구성하는 **개별 관측치(EventStudyObservation, 각 공시별 CAR)**는 화면에 드러나지 않는다. 사용자가 "이 통계는 실제로 어떤 공시들로 만들어졌나"를 확인할 수 없어, 표본을 검증하지 못한 채 통계를 과신할 위험이 있다(과신방지 규약 위배 소지).

## 근거 (코드)
- `backend/src/engine3-quant-market/event-study/event-study.controller.ts:22` — `@Get()`은 집계만 반환.
- EventStudyObservation(버킷 내 개별 이벤트 CAR) 노출 0건.

## 해결 방향 (구현 자유)
- 백엔드(Engine3): `GET /event-study/:bucketKey/observations` 추가. 해당 버킷을 구성하는 개별 관측치(공시 식별·기업·이벤트일·CAR 등)를 페이지네이션으로 반환. bucketKey 식별자 정합 확인. 상대경로 import.
- 모바일: EventStudy 통계 카드에서 "표본 N건 보기" 드릴다운. `useEventStudyObservations(bucketKey)` React Query 훅(`useInfiniteQuery` 또는 페이지). 개별 공시·이벤트일·CAR 리스트(FlatList) 노출 — 표본 투명성 제공.

## 영향 파일
- `backend/src/engine3-quant-market/event-study/event-study.controller.ts`, `event-study.service.ts`
- `mobile/app/.../event-study`(또는 종목 상세 내 event-study 카드), `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] `GET /event-study/:bucketKey/observations`가 버킷 구성 개별 관측치를 페이지네이션 반환
- [ ] 통계 카드에서 표본 드릴다운으로 개별 공시·CAR 리스트 노출(FlatList), 빈 버킷 흡수
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범 · 과신방지 규약 정합 · 문서 동기화(`docs/api-specification.md`)
