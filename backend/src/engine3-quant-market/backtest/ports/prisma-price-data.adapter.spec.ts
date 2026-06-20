import { PrismaBacktestPriceAdapter } from './prisma-price-data.adapter';
import { PrismaService } from '../../../prisma/prisma.service';

interface PriceRow {
  stockCode: string;
  tradeDate: string; // YYYYMMDD
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: bigint;
}

function makePrisma(rows: PriceRow[]) {
  const findManyArgs: Array<{ where: { tradeDate: { gte: string; lte: string } } }> = [];
  const prisma = {
    stockDailyPrice: {
      findMany: jest.fn(async (args: { where: { stockCode: string; tradeDate: { gte: string; lte: string } } }) => {
        findManyArgs.push(args as never);
        return rows
          .filter(
            (r) =>
              r.stockCode === args.where.stockCode &&
              r.tradeDate >= args.where.tradeDate.gte &&
              r.tradeDate <= args.where.tradeDate.lte,
          )
          .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
      }),
      findUnique: jest.fn(async (args: { where: { stockCode_tradeDate: { stockCode: string; tradeDate: string } } }) => {
        const k = args.where.stockCode_tradeDate;
        return rows.find((r) => r.stockCode === k.stockCode && r.tradeDate === k.tradeDate) ?? null;
      }),
      groupBy: jest.fn(async (args: { where: { tradeDate: { gte: string; lte: string } } }) => {
        const dates = [
          ...new Set(
            rows
              .filter((r) => r.tradeDate >= args.where.tradeDate.gte && r.tradeDate <= args.where.tradeDate.lte)
              .map((r) => r.tradeDate),
          ),
        ].sort();
        return dates.map((tradeDate) => ({ tradeDate }));
      }),
    },
  } as unknown as PrismaService;
  return { prisma, findManyArgs };
}

const ROWS: PriceRow[] = [
  { stockCode: '005930', tradeDate: '20250619', openPrice: 70000, highPrice: 71000, lowPrice: 69000, closePrice: 70500, volume: 100000n },
  { stockCode: '005930', tradeDate: '20250620', openPrice: 70500, highPrice: 72000, lowPrice: 70000, closePrice: 71500, volume: 120000n },
  { stockCode: '005930', tradeDate: '20251231', openPrice: 80000, highPrice: 81000, lowPrice: 79000, closePrice: 80500, volume: 90000n },
  { stockCode: '000660', tradeDate: '20250620', openPrice: 50000, highPrice: 51000, lowPrice: 49500, closePrice: 50500, volume: 80000n },
];

describe('PrismaBacktestPriceAdapter — DB 일봉 PriceDataPort', () => {
  it('일봉 매핑: YYYYMMDD→YYYY-MM-DD, BigInt volume→number', async () => {
    const { prisma } = makePrisma(ROWS);
    const adapter = new PrismaBacktestPriceAdapter(prisma);
    const prices = await adapter.getDailyPrices('005930', '2025-06-19', '2025-06-20');
    expect(prices).toHaveLength(2);
    expect(prices[0]).toMatchObject({ date: '2025-06-19', open: 70000, close: 70500, volume: 100000 });
    expect(typeof prices[0].volume).toBe('number');
  });

  it('★lookahead 가드: asOf 초과 endDate 는 asOf 로 절단(미래 일봉 미반환)', async () => {
    const { prisma, findManyArgs } = makePrisma(ROWS);
    // asOf = 2025-06-20 → 2025-12-31 일봉은 반환 금지
    const adapter = new PrismaBacktestPriceAdapter(prisma, '2025-06-20');
    const prices = await adapter.getDailyPrices('005930', '2025-06-19', '2025-12-31');
    expect(prices.map((p) => p.date)).toEqual(['2025-06-19', '2025-06-20']);
    // 쿼리 자체가 asOf 로 절단되어 들어갔는지 확인
    expect(findManyArgs[0].where.tradeDate.lte).toBe('20250620');
  });

  it('getOpenPrice: asOf 초과 날짜는 null', async () => {
    const { prisma } = makePrisma(ROWS);
    const adapter = new PrismaBacktestPriceAdapter(prisma, '2025-06-20');
    expect(await adapter.getOpenPrice('005930', '2025-06-20')).toBe(70500);
    expect(await adapter.getOpenPrice('005930', '2025-12-31')).toBeNull();
  });

  it('getTradingDays: 일봉 존재일 distinct(groupBy) → asOf 절단', async () => {
    const { prisma } = makePrisma(ROWS);
    const adapter = new PrismaBacktestPriceAdapter(prisma, '2025-06-20');
    const days = await adapter.getTradingDays('2025-06-19', '2025-12-31');
    expect(days).toEqual(['2025-06-19', '2025-06-20']); // 20251231 절단
  });

  it('asOf < startDate 면 빈 배열(구간 무효)', async () => {
    const { prisma } = makePrisma(ROWS);
    const adapter = new PrismaBacktestPriceAdapter(prisma, '2025-06-18');
    expect(await adapter.getDailyPrices('005930', '2025-06-19', '2025-06-20')).toEqual([]);
    expect(await adapter.getTradingDays('2025-06-19', '2025-06-20')).toEqual([]);
  });
});
