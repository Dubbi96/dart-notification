# DAR-159 — 종목별 신호 조회(corpCode 필터) + 종목 상세 신호 배지 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: high · effort: small
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-159-signal-by-corpcode`

## 배경/문제
TradingSignal은 corpCode를 PK/FK와 인덱스로 보유하지만, 신호 조회 where절에 corpCode 필터가 없다. 종목 상세 화면(`company/[corpCode].tsx`)은 event-study·philosophy-fit·persona-fusion만 보여줄 뿐, **해당 종목의 BUY 등급/점수/진입준비 여부**를 노출하지 못한다.

## 근거 (코드)
- `backend/prisma/schema.prisma:889,948` — `TradingSignal.corpCode` PK/FK + 인덱스 존재.
- `backend/src/engine3-quant-market/signals/signals.service.ts:210-218` — where절은 `disclosure.isBackfill`/grade/persona/eventType/entryReady만, corpCode 없음.
- `mobile/app/company/[corpCode].tsx` — event-study·philosophy-fit·persona-fusion 카드만, 종목 신호 배지 없음.

## 해결 방향 (구현 자유)
- 백엔드(Engine3): 두 안 중 택1. (a) 기존 signals 목록 필터에 `corpCode` optional 추가(where 반영). (b) `GET /companies/:corpCode/signal` 전용 엔드포인트로 해당 종목 최신 신호(등급·buyScore·entryReady·생성시각) 단건 반환. 백필 신호 배제 방어 필터 유지. 상대경로 import.
- 모바일: `useCompanySignal(corpCode)` React Query 훅. 종목 상세 상단에 신호 배지(등급 색상 칩 + 점수 + 진입준비 표시). 신호 없으면 "신호 없음" 빈상태.

## 영향 파일
- `backend/src/engine3-quant-market/signals/signals.service.ts`, `signals.controller.ts`(+ dto)
- `mobile/app/company/[corpCode].tsx`, `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] corpCode로 해당 종목 최신 신호(등급·점수·진입준비) 조회 가능, 백필 신호 미노출
- [ ] 종목 상세에 신호 배지 노출, 신호 없는 종목은 빈상태로 흡수
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범 · 문서 동기화(`docs/api-specification.md`)
