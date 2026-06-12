# DAR-160 — 시장지수(KOSPI/KOSDAQ) 조회 API + 홈 시장 배지 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: medium · effort: small
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-160-market-index-api`

## 배경/문제
MarketIndex(코스피 0001 / 코스닥 1001 일봉)가 매일 적재되고 event-study·market-regime.service에서 내부 소비되지만, **외부로 읽는 엔드포인트가 0건**이다. 사용자는 신호를 보면서도 그날의 시장 국면(상승/하락)을 알 수 없다.

## 근거 (코드)
- `backend/prisma/schema.prisma:724` — `MarketIndex`(0001/1001 일봉) 매일 적재.
- event-study / `market-regime.service.ts` 내부 소비만, 읽기 엔드포인트 없음.

## 해결 방향 (구현 자유)
- 백엔드(Engine3): `GET /market-data/indices/latest` 추가. KOSPI·KOSDAQ 각각 최신 종가 + 전일대비 등락률(%) + 거래일자 반환. market-data 컨트롤러에 GET 추가(엔진 경계 준수). 상대경로 import.
- 모바일: `useMarketIndices()` React Query 훅. 홈 헤더에 "시장 한눈에" 배지(코스피/코스닥 지수·등락률 색상). 신호 화면에는 시장 국면 맥락 보조 표시로 재사용 가능.

## 영향 파일
- `backend/src/engine3-quant-market/market-data/market-data.controller.ts`, `market-data.service.ts`
- `mobile/app/(tabs)/`(홈 헤더), `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] `GET /market-data/indices/latest`가 KOSPI·KOSDAQ 최신 지수·등락률·일자 반환
- [ ] 홈 헤더에 시장 배지 노출, 데이터 없을 때 깨지지 않음
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범 · 문서 동기화(`docs/api-specification.md`)
