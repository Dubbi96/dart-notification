/**
 * stock-price.port.ts — 종목 가격 데이터 포트 (M5-A, DAR-9)
 *
 * 의존성 역전(DIP): 엔진은 이 인터페이스에만 의존하며,
 * 실제 DB/API 어댑터는 주입 시 결정된다.
 */

export interface IStockDailyPrice {
  stockCode: string;
  tradeDate: string; // YYYYMMDD
  closePrice: number;
  volume: number;
}

export interface IStockPricePort {
  getPriceWindow(
    stockCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<IStockDailyPrice[]>;
}

export const STOCK_PRICE_PORT = 'STOCK_PRICE_PORT';
