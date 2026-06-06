/**
 * in-memory-stock-price.adapter.ts — 인메모리 종목 가격 어댑터 (테스트용)
 * M5-A DAR-9: Fixture 테스트에서 실제 DB 없이 동작 검증
 */
import { IStockPricePort, IStockDailyPrice } from '../ports/stock-price.port';
import {
  AssetClass,
  DEFAULT_ASSET_CLASS,
  assertSupportedAssetClass,
} from '../../../common/asset/asset-class';

export class InMemoryStockPriceAdapter implements IStockPricePort {
  constructor(private readonly data: IStockDailyPrice[]) {}

  async getPriceWindow(
    stockCode: string,
    fromDate: string,
    toDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<IStockDailyPrice[]> {
    // KR 어댑터: 비-KR 자산군은 스텁 경계(미구현)로 명시.
    assertSupportedAssetClass(assetClass, 'InMemoryStockPriceAdapter');
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
