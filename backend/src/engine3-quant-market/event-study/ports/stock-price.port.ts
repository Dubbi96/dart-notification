/**
 * stock-price.port.ts — 종목 가격 데이터 포트 (M5-A, DAR-9)
 *
 * 의존성 역전(DIP): 엔진은 이 인터페이스에만 의존하며,
 * 실제 DB/API 어댑터는 주입 시 결정된다.
 *
 * DAR-77: 다자산 추상화를 위해 assetClass 를 가산형(선택, 기본 KR_STOCK)으로 확장.
 * 자산군을 넘기지 않는 현행 KR 호출은 그대로 동작한다.
 */
import { AssetClass } from '../../../common/asset/asset-class';

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
    /** 자산군 (기본 KR_STOCK). 현행 KR 호출은 생략 가능. */
    assetClass?: AssetClass,
  ): Promise<IStockDailyPrice[]>;
}

export const STOCK_PRICE_PORT = 'STOCK_PRICE_PORT';
