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

interface StatusRow {
  stockCode: string;
  tradeDate: string; // YYYYMMDD
  isTradingSuspended: boolean;
  isManagement: boolean;
}

function makePrisma(rows: PriceRow[], statusRows: StatusRow[] = []) {
  const findManyArgs: Array<{ where: { tradeDate: { gte: string; lte: string } } }> = [];
  const prisma = {
    // DAR-486: 일별 종목상태 이력 — 기본 빈 배열(과거 백테스트 = forward 이력 부재 → 미설정 false).
    stockStatusDaily: {
      findMany: jest.fn(
        async (args: { where: { stockCode: string; tradeDate: { gte: string; lte: string } } }) =>
          statusRows.filter(
            (s) =>
              s.stockCode === args.where.stockCode &&
              s.tradeDate >= args.where.tradeDate.gte &&
              s.tradeDate <= args.where.tradeDate.lte,
          ),
      ),
    },
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

  // DAR-486: 일별 종목상태 이력(거래정지/관리종목) 공급 — 생존편향/상한가추격 차단 입력.
  describe('일별 종목상태 이력(StockStatusDaily) 공급', () => {
    it('이력 없으면 플래그 미설정(false) — forward 이전 과거 백테스트 거동 무변경', async () => {
      const { prisma } = makePrisma(ROWS); // status 이력 없음
      const adapter = new PrismaBacktestPriceAdapter(prisma);
      const prices = await adapter.getDailyPrices('005930', '2025-06-19', '2025-06-20');
      expect(prices[0].isTradingSuspended).toBe(false);
      expect(prices[0].isAdminStock).toBe(false);
    });

    it('이력 있으면 해당 거래일만 point-in-time 플래그 공급(거래정지→isTradingSuspended, 관리→isAdminStock)', async () => {
      const { prisma } = makePrisma(ROWS, [
        { stockCode: '005930', tradeDate: '20250619', isTradingSuspended: true, isManagement: false },
        { stockCode: '005930', tradeDate: '20250620', isTradingSuspended: false, isManagement: true },
      ]);
      const adapter = new PrismaBacktestPriceAdapter(prisma);
      const prices = await adapter.getDailyPrices('005930', '2025-06-19', '2025-06-20');
      expect(prices).toHaveLength(2);
      // 6/19 = 거래정지
      expect(prices[0]).toMatchObject({ date: '2025-06-19', isTradingSuspended: true, isAdminStock: false });
      // 6/20 = 관리종목
      expect(prices[1]).toMatchObject({ date: '2025-06-20', isTradingSuspended: false, isAdminStock: true });
    });

    it('asOf 초과 종목상태는 조회 구간이 절단되어 미반영(lookahead 가드)', async () => {
      const { prisma } = makePrisma(ROWS, [
        // asOf(2025-06-20) 초과 상태는 절단된 일봉과 함께 반환 대상에서 제외.
        { stockCode: '005930', tradeDate: '20251231', isTradingSuspended: true, isManagement: false },
      ]);
      const adapter = new PrismaBacktestPriceAdapter(prisma, '2025-06-20');
      const prices = await adapter.getDailyPrices('005930', '2025-06-19', '2025-12-31');
      expect(prices.map((p) => p.date)).toEqual(['2025-06-19', '2025-06-20']);
      expect(prices.every((p) => p.isTradingSuspended === false)).toBe(true);
    });
  });
});
