/**
 * in-memory-stock-price.adapter.ts — 인메모리 종목 가격 어댑터 (테스트용)
 * M5-A DAR-9: Fixture 테스트에서 실제 DB 없이 동작 검증
 */
import { IStockPricePort, IStockDailyPrice } from '../ports/stock-price.port';

export class InMemoryStockPriceAdapter implements IStockPricePort {
  constructor(private readonly data: IStockDailyPrice[]) {}

  async getPriceWindow(
    stockCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<IStockDailyPrice[]> {
    return this.data
      .filter(
        p =>
          p.stockCode === stockCode &&
          p.tradeDate >= fromDate &&
          p.tradeDate <= toDate,
      )
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }
}
