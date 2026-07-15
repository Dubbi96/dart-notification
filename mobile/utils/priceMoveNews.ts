/**
 * 갭분석 W7·W6(d) — 급변동(PRICE_MOVE) 알림의 네이버금융 종목 뉴스 링크아웃 유틸.
 *
 * ★외부 브라우저 링크아웃 전용(수집·저장 0 — 라이선스 무관). 공시온의 포지셔닝은
 *   'DART 1차 원문 기반'이고, 뉴스는 시차·누락이 있는 2차 채널이므로 앱 내 수집·표시 없이
 *   원문 채널(네이버금융)로만 내보낸다(백엔드 price-move.domain.ts 와 URL 형식 동일).
 *
 * refId 계약: 백엔드 PRICE_MOVE 알림의 refId = `<stockCode 6자리>-<YYYYMMDD>`
 *   (backend price-move.domain.ts priceMoveRefId — 종목당 1일 1회 멱등 자연키).
 */

/** PRICE_MOVE refId(`005930-20260716`)에서 종목코드(6자리)를 파싱. 형식 불일치는 null. */
export function stockCodeFromPriceMoveRefId(refId: string | null | undefined): string | null {
  if (!refId) return null;
  const match = /^(\d{6})-\d{8}$/.exec(refId);
  return match ? match[1] : null;
}

/** 네이버금융 종목 뉴스 URL(외부 브라우저 링크아웃 전용). */
export function naverStockNewsUrl(stockCode: string): string {
  return `https://finance.naver.com/item/news.naver?code=${stockCode}`;
}
