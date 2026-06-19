/**
 * 시장지수 최신값 (GET /market-data/indices/latest, DAR-160).
 * 백엔드 MarketIndexQuote 1:1. 데이터가 1건뿐이면 등락 필드는 null.
 */
export interface MarketIndexQuote {
  indexCode: string; // 0001=KOSPI, 1001=KOSDAQ
  indexName: string;
  market: 'KOSPI' | 'KOSDAQ';
  tradeDate: string; // 최신 거래일 YYYYMMDD
  closeIndex: number; // 최신 종가지수
  prevCloseIndex: number | null; // 전일 종가지수 (없으면 null)
  change: number | null; // 전일대비 등락폭 (포인트)
  changePercent: number | null; // 전일대비 등락률 (%)
  // DAR-367: 인접 거래일 |Δ| 가 물리적으로 불가능(>±20%)하면 전일 종가 오염으로 보고 등락 필드를
  // null 로 숨긴 케이스. suspect=true 면 배지는 등락 대신 '점검중' 폴백을 띄운다(과거 데이터 미정합 시).
  suspect?: boolean;
}
