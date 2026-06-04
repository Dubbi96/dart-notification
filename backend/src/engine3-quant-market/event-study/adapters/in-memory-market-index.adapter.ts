/**
 * in-memory-market-index.adapter.ts — 인메모리 시장 지수 어댑터 (테스트용)
 * M5-A DAR-9: Fixture 테스트에서 실제 DB 없이 동작 검증
 */
import { IMarketIndexPort, IMarketIndexPrice } from '../ports/market-index.port';

export class InMemoryMarketIndexAdapter implements IMarketIndexPort {
  constructor(private readonly data: IMarketIndexPrice[]) {}

  async getIndexWindow(
    indexCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<IMarketIndexPrice[]> {
    return this.data
      .filter(
        p =>
          p.indexCode === indexCode &&
          p.tradeDate >= fromDate &&
          p.tradeDate <= toDate,
      )
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }
}
