/**
 * 종목 최신 시세(quote) 타입 — 백엔드 StockQuoteService 응답과 1:1 (DAR-158).
 * 가격 배지(현재가·전일대비%·5일 스파크라인) 종단연결용. 데이터 없는 종목은 null.
 */
export interface StockQuote {
  stockCode: string;
  corpCode: string | null;
  /** 최종가(원) — 실시간 우선, 폴백 최신 일봉 종가. */
  price: number;
  /** 직전 기준 종가(원). 없으면 null. */
  previousClose: number | null;
  /** 전일대비 절대 등락(원). 없으면 null. */
  change: number | null;
  /** 전일대비 등락률(%) 소수 2자리. 없으면 null. */
  changePercent: number | null;
  /** 가격 기준 일봉일(YYYYMMDD). */
  tradeDate: string | null;
  /** 가격 출처 — 'REALTIME'(KIS 신선) | 'DAILY'(일봉 종가). */
  source: 'REALTIME' | 'DAILY';
  /** 최근 종가 스파크라인(오래된→최신, 최대 5개). */
  sparkline: number[];
}

/** stockCode → StockQuote|null 맵. 조회 안 된 종목 키는 null. */
export type StockQuoteMap = Record<string, StockQuote | null>;
