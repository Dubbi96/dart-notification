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
  // DAR-371: 가격 출처 — 'REALTIME'(KIS 실시간 지수) | 'EOD'(KRX 일봉 종가).
  // EOD 는 tradeDate 가 '종가 기준일'이라 배지가 'YYYY-MM-DD 종가 기준' 라벨로 신선도를 정직하게
  // 표기한다(stale 을 현재로 오인 방지). REALTIME 은 '실시간' 라벨. 구버전 응답 호환 위해 옵셔널.
  source?: 'REALTIME' | 'EOD';
  // REALTIME 일 때 서버 조회 시각(ISO). EOD 면 null.
  asOf?: string | null;
}
