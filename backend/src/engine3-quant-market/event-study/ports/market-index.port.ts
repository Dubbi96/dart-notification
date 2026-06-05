/**
 * market-index.port.ts — 시장 지수 데이터 포트 (M5-A, DAR-9)
 *
 * 의존성 역전(DIP): 엔진은 이 인터페이스에만 의존하며,
 * 실제 DB/API 어댑터는 주입 시 결정된다.
 */

export interface IMarketIndexPrice {
  indexCode: string;
  tradeDate: string; // YYYYMMDD
  closeIndex: number;
}

export interface IMarketIndexPort {
  getIndexWindow(
    indexCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<IMarketIndexPrice[]>;
}

export const MARKET_INDEX_PORT = 'MARKET_INDEX_PORT';
