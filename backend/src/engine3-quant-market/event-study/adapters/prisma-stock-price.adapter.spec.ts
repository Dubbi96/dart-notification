/**
 * prisma-stock-price.adapter.spec.ts — 종목 일봉 가격 조회 어댑터 (DAR-398)
 *
 * EventStudy noPrices 진단의 핵심: 가격은 stock_daily_prices.stockCode 키로 저장된다.
 * 공시(disclosure)엔 stockCode 가 없고 corpCode 만 있으므로, 오케스트레이터가
 * company.stockCode 로 풀어 넘긴 값으로 조회해야 존재하는 일봉을 찾는다.
 * 이 어댑터가 stockCode + tradeDate 윈도(gte/lte)로 정확히 질의함을 못박는다.
 */
import { PrismaStockPriceAdapter } from './prisma-stock-price.adapter';

describe('PrismaStockPriceAdapter.getPriceWindow() — corpCode→stockCode→가격 연결', () => {
  it('stockCode + tradeDate 윈도로 stock_daily_prices 를 조회해 존재하는 일봉을 찾는다', async () => {
    const findMany = jest.fn(async (_arg: any) => [
      { stockCode: '189300', tradeDate: '20250701', closePrice: 12345, volume: 1000n },
      { stockCode: '189300', tradeDate: '20250702', closePrice: 12500, volume: 2000n },
    ]);
    const prisma = { stockDailyPrice: { findMany } } as any;
    const adapter = new PrismaStockPriceAdapter(prisma);

    const rows = await adapter.getPriceWindow('189300', '20250520', '20250915');

    // 핵심 연결: where 가 stockCode(=company.stockCode 로 풀린 값)와 거래일 윈도여야 한다
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.stockCode).toBe('189300');
    expect(arg.where.tradeDate).toEqual({ gte: '20250520', lte: '20250915' });
    expect(arg.orderBy).toEqual({ tradeDate: 'asc' });

    // 존재하는 일봉을 찾아 도메인 형태로 매핑(BigInt volume → number)
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      stockCode: '189300',
      tradeDate: '20250701',
      closePrice: 12345,
      volume: 1000,
    });
    expect(typeof rows[1].volume).toBe('number');
  });

  it('corpCode 가 아닌 stockCode 로만 조회한다 (잘못된 키 조회 방지)', async () => {
    const findMany = jest.fn(async (_arg: any) => []);
    const prisma = { stockDailyPrice: { findMany } } as any;
    const adapter = new PrismaStockPriceAdapter(prisma);

    await adapter.getPriceWindow('005930', '20250101', '20250201');

    const arg = findMany.mock.calls[0][0];
    // corpCode(8자리) 같은 다른 키가 섞이지 않아야 한다
    expect(arg.where).not.toHaveProperty('corpCode');
    expect(arg.where.stockCode).toBe('005930');
  });
});
