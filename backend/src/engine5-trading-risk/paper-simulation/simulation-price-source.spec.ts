/**
 * simulation-price-source.spec.ts — 시세 소스 추상화 단위테스트 (DAR-124, DB 미사용)
 *
 * 검증: 모드 플래그(실데이터 vs 합성), 소스별 올바른 테이블 조회(혼합 금지), 합성 유니버스
 *   준비가 결정적·라벨된(SYNTHETIC) 멱등 적재를 수행함, 실데이터 모드 prepareUniverse no-op.
 */

import {
  SimulationPriceSourceService,
  SYNTHETIC_PERSIST_TRADING_DAYS,
} from './simulation-price-source.service';

type AnyFn = jest.Mock;

function makePrismaMock() {
  return {
    simulatedDailyPrice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
    stockDailyPrice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    position: { findMany: jest.fn() },
    tradingSignal: { findMany: jest.fn() },
  };
}

function makeService(prisma: ReturnType<typeof makePrismaMock>) {
  // PrismaService 타입은 구조적으로 충분 — 사용 메서드만 모킹.
  return new SimulationPriceSourceService(prisma as never);
}

const ORIGINAL_FLAG = process.env.PAPER_SIM_SYNTHETIC_FEED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  else process.env.PAPER_SIM_SYNTHETIC_FEED = ORIGINAL_FLAG;
  jest.clearAllMocks();
});

describe('SimulationPriceSourceService — 시세 소스(DAR-124)', () => {
  describe('isSynthetic — 모드 플래그', () => {
    it('미설정/0/false 면 실데이터 모드', () => {
      const svc = makeService(makePrismaMock());
      delete process.env.PAPER_SIM_SYNTHETIC_FEED;
      expect(svc.isSynthetic).toBe(false);
      process.env.PAPER_SIM_SYNTHETIC_FEED = '0';
      expect(svc.isSynthetic).toBe(false);
      process.env.PAPER_SIM_SYNTHETIC_FEED = 'false';
      expect(svc.isSynthetic).toBe(false);
    });
    it('1/true/on 이면 합성 모드', () => {
      const svc = makeService(makePrismaMock());
      for (const v of ['1', 'true', 'TRUE', 'on']) {
        process.env.PAPER_SIM_SYNTHETIC_FEED = v;
        expect(svc.isSynthetic).toBe(true);
      }
    });
  });

  describe('latestPriceRow — 소스별 테이블 분리(혼합 금지)', () => {
    it('합성 모드는 SimulatedDailyPrice 만 읽고 StockDailyPrice 는 미참조', async () => {
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      const prisma = makePrismaMock();
      (prisma.simulatedDailyPrice.findFirst as AnyFn).mockResolvedValue({
        openPrice: 100, highPrice: 110, lowPrice: 90, closePrice: 105, volume: BigInt(1000),
      });
      const svc = makeService(prisma);
      const row = await svc.latestPriceRow('00126380', '20260608');
      expect(row?.closePrice).toBe(105);
      expect(prisma.simulatedDailyPrice.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.stockDailyPrice.findFirst).not.toHaveBeenCalled();
    });

    it('실데이터 모드는 StockDailyPrice 만 읽고 SimulatedDailyPrice 는 미참조', async () => {
      delete process.env.PAPER_SIM_SYNTHETIC_FEED;
      const prisma = makePrismaMock();
      (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({
        openPrice: 200, highPrice: 210, lowPrice: 190, closePrice: 205, volume: BigInt(2000),
      });
      const svc = makeService(prisma);
      const row = await svc.latestPriceRow('00126380', '20260608');
      expect(row?.closePrice).toBe(205);
      expect(prisma.stockDailyPrice.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.simulatedDailyPrice.findFirst).not.toHaveBeenCalled();
    });

    it('행이 없으면 null', async () => {
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      const prisma = makePrismaMock();
      (prisma.simulatedDailyPrice.findFirst as AnyFn).mockResolvedValue(null);
      const svc = makeService(prisma);
      expect(await svc.latestPriceRow('x', '20260608')).toBeNull();
    });
  });

  describe('closesAfter — 소스별 분리', () => {
    it('합성 모드는 SimulatedDailyPrice findMany', async () => {
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      const prisma = makePrismaMock();
      (prisma.simulatedDailyPrice.findMany as AnyFn).mockResolvedValue([{ closePrice: 1 }]);
      const svc = makeService(prisma);
      const out = await svc.closesAfter('x', '20260601', 3);
      expect(out).toEqual([{ closePrice: 1 }]);
      expect(prisma.stockDailyPrice.findMany).not.toHaveBeenCalled();
    });
  });

  describe('prepareUniverse', () => {
    it('실데이터 모드는 no-op(적재/조회 0)', async () => {
      delete process.env.PAPER_SIM_SYNTHETIC_FEED;
      const prisma = makePrismaMock();
      const svc = makeService(prisma);
      const res = await svc.prepareUniverse('pf1', '20260608');
      expect(res).toEqual({ stocks: 0, inserted: 0 });
      expect(prisma.position.findMany).not.toHaveBeenCalled();
      expect(prisma.simulatedDailyPrice.createMany).not.toHaveBeenCalled();
    });

    it('합성 모드는 유니버스(OPEN+후보) 종목에 결정적·라벨된 멱등 적재', async () => {
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      const prisma = makePrismaMock();
      (prisma.position.findMany as AnyFn).mockResolvedValue([
        { corpCode: '00126380', stockCode: '005930' },
      ]);
      (prisma.tradingSignal.findMany as AnyFn).mockResolvedValue([
        { id: 's1', corpCode: '00164779', stockCode: '000660', buyScore: 50, signal: 'WATCH' },
      ]);
      (prisma.simulatedDailyPrice.createMany as AnyFn).mockImplementation(
        async ({ data }: { data: unknown[] }) => ({ count: data.length }),
      );
      const svc = makeService(prisma);

      const res = await svc.prepareUniverse('pf1', '20260608');

      expect(res.stocks).toBe(2);
      expect(res.inserted).toBeGreaterThan(0);
      // 두 종목 모두 적재 호출
      expect(prisma.simulatedDailyPrice.createMany).toHaveBeenCalledTimes(2);

      // 적재 데이터: 모두 source='SYNTHETIC' 라벨, 정확히 PERSIST 윈도 길이, tradeDate 포함
      const firstCall = (prisma.simulatedDailyPrice.createMany as AnyFn).mock.calls[0][0];
      const rows = firstCall.data as Array<Record<string, unknown>>;
      expect(firstCall.skipDuplicates).toBe(true);
      expect(rows.length).toBeLessThanOrEqual(SYNTHETIC_PERSIST_TRADING_DAYS);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.source === 'SYNTHETIC')).toBe(true);
      expect(rows.every((r) => typeof r.volume === 'bigint')).toBe(true);
      expect(rows.some((r) => r.tradeDate === '20260608')).toBe(true);
      // 종가는 양수(매수 가능 전제)
      expect(rows.every((r) => (r.closePrice as number) > 0)).toBe(true);
    });

    it('합성 적재는 결정적(2회 실행 동일 데이터)', async () => {
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      const capture: unknown[][] = [];
      const run = async () => {
        const prisma = makePrismaMock();
        (prisma.position.findMany as AnyFn).mockResolvedValue([
          { corpCode: '00126380', stockCode: '005930' },
        ]);
        (prisma.tradingSignal.findMany as AnyFn).mockResolvedValue([]);
        (prisma.simulatedDailyPrice.createMany as AnyFn).mockImplementation(
          async ({ data }: { data: unknown[] }) => {
            capture.push(data);
            return { count: data.length };
          },
        );
        await makeService(prisma).prepareUniverse('pf1', '20260608');
      };
      await run();
      await run();
      expect(capture).toHaveLength(2);
      expect(capture[0]).toEqual(capture[1]); // 동일 입력 → 동일 적재 데이터(멱등)
    });
  });
});
