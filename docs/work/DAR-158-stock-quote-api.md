# DAR-158 — 종목 최신 시세(quote) 조회 API + 가격 배지 종단연결 (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: high · effort: medium
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-158-stock-quote-api`

## 배경/문제
StockDailyPrice 일봉과 KIS 실시간가가 매일 적재되지만, 이를 **읽는 GET 엔드포인트가 없다**. `market-data.controller.ts`는 수집(collect/backfill) POST와 `collection-logs` GET만 노출한다. 그 결과 워치리스트·신호·종목 카드 어디에도 현재가/등락률 배지가 없어 적재 데이터가 화면에서 사라진다.

## 근거 (코드)
- `backend/src/engine3-quant-market/market-data/market-data.controller.ts:18-67` — `@Post('collect/*')` `@Post('backfill/daily')` `@Get('collection-logs')`뿐, 가격 읽기 GET 없음.
- `backend/src/watchlist/watchlist.service.ts:42-46` — 아이템에 `lastDisclosureDate`만 파생, 가격/등락률 없음.

## 해결 방향 (구현 자유)
- 백엔드(Engine3): `GET /market-data/quote?stockCodes=005930,000660` 추가. 각 종목에 대해 최종가 + 전일대비 등락률(%) + 최근 5일 종가 스파크라인 배열 반환. KIS 실시간가가 있으면 우선, 없으면 StockDailyPrice 최신 종가 폴백. 다건 조회 N+1 회피(in 쿼리). 엔진 경계 준수·상대경로 import.
- 모바일: `useStockQuotes(stockCodes)` React Query 훅 래핑. 워치리스트 아이템·신호 카드·종목 상세 헤더에 가격 배지(현재가·등락률 색상·미니 스파크라인) 연결. 가격 없으면 배지 미표시(빈상태 흡수).

## 영향 파일
- `backend/src/engine3-quant-market/market-data/market-data.controller.ts`, `market-data.service.ts`(또는 신규 quote 서비스)
- `mobile/services/`(market quote API), `mobile/hooks/`(useStockQuotes), 워치리스트·신호·종목 상세 화면 컴포넌트
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] `GET /market-data/quote`가 다건 stockCodes에 대해 최종가·전일대비%·5일 스파크라인 반환, 데이터 없는 종목은 null 흡수
- [ ] 워치리스트/신호/종목 상세에 가격 배지 노출, 가격 부재 시 배지 미표시로 깨지지 않음
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범 · 문서 동기화(`docs/api-specification.md`)
