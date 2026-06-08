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
const ORIGINAL_REAL_FLAG = process.env.PAPER_SIM_REAL_FEED;
const ORIGINAL_OFFSET = process.env.PAPER_SIM_REAL_YEAR_OFFSET;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  else process.env.PAPER_SIM_SYNTHETIC_FEED = ORIGINAL_FLAG;
  if (ORIGINAL_REAL_FLAG === undefined) delete process.env.PAPER_SIM_REAL_FEED;
  else process.env.PAPER_SIM_REAL_FEED = ORIGINAL_REAL_FLAG;
  if (ORIGINAL_OFFSET === undefined) delete process.env.PAPER_SIM_REAL_YEAR_OFFSET;
  else process.env.PAPER_SIM_REAL_YEAR_OFFSET = ORIGINAL_OFFSET;
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

describe('SimulationPriceSourceService — REAL_THEN_SYNTHETIC 하이브리드(DAR-137)', () => {
  function realFeed() {
    delete process.env.PAPER_SIM_SYNTHETIC_FEED;
    process.env.PAPER_SIM_REAL_FEED = '1';
  }

  describe('mode — 플래그 우선순위', () => {
    it('PAPER_SIM_REAL_FEED 가 SYNTHETIC 플래그보다 우선(하이브리드)', () => {
      const svc = makeService(makePrismaMock());
      process.env.PAPER_SIM_REAL_FEED = '1';
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      expect(svc.mode).toBe('REAL_THEN_SYNTHETIC');
      expect(svc.isSynthetic).toBe(false); // 합성 전용 가드(레거시 재기준)는 미적용
      expect(svc.seedsSynthetic).toBe(true); // 폴백분 시드는 필요
    });
    it('REAL 플래그만 → 하이브리드, 합성만 → SYNTHETIC, 둘 다 없음 → REAL', () => {
      const svc = makeService(makePrismaMock());
      delete process.env.PAPER_SIM_REAL_FEED;
      delete process.env.PAPER_SIM_SYNTHETIC_FEED;
      expect(svc.mode).toBe('REAL');
      process.env.PAPER_SIM_SYNTHETIC_FEED = '1';
      expect(svc.mode).toBe('SYNTHETIC');
      process.env.PAPER_SIM_REAL_FEED = 'on';
      expect(svc.mode).toBe('REAL_THEN_SYNTHETIC');
    });
  });

  describe('latestPriceRow — 종목별 실가 우선·합성 폴백(혼합 금지)', () => {
    it('실데이터 있는 종목: 매핑된 실 거래일로 StockDailyPrice 조회, source=REAL·sourceDate=원일자', async () => {
      realFeed();
      process.env.PAPER_SIM_REAL_YEAR_OFFSET = '1';
      const prisma = makePrismaMock();
      // resolveSource 존재성 확인 + 본 조회 모두 실데이터 반환
      (prisma.stockDailyPrice.findFirst as AnyFn).mockImplementation(
        async ({ where }: { where: { tradeDate: { lte: string } } }) => {
          // 매핑(2026→2025) 확인: 쿼리 하한은 2025 거래일이어야 한다.
          expect(where.tradeDate.lte.startsWith('2025')).toBe(true);
          return {
            openPrice: 300, highPrice: 320, lowPrice: 295, closePrice: 310,
            volume: BigInt(5000), tradeDate: '20250605',
          };
        },
      );
      const svc = makeService(prisma);
      const row = await svc.latestPriceRow('00126380', '20260608');
      expect(row?.source).toBe('REAL');
      expect(row?.closePrice).toBe(310);
      expect(row?.sourceDate).toBe('20250605'); // 2026 아님 — 원일자 정직 고지
      expect(prisma.simulatedDailyPrice.findFirst).not.toHaveBeenCalled();
    });

    it('실데이터 없는 종목: 합성으로 폴백, source=SYNTHETIC', async () => {
      realFeed();
      const prisma = makePrismaMock();
      (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue(null); // 실데이터 없음
      (prisma.simulatedDailyPrice.findFirst as AnyFn).mockResolvedValue({
        openPrice: 100, highPrice: 110, lowPrice: 90, closePrice: 105,
        volume: BigInt(1000), tradeDate: '20260606',
      });
      const svc = makeService(prisma);
      const row = await svc.latestPriceRow('99999999', '20260608');
      expect(row?.source).toBe('SYNTHETIC');
      expect(row?.closePrice).toBe(105);
    });
  });

  describe('closesAfter — 동일 소스 일관(실가 D+N)', () => {
    it('실데이터 종목은 매핑 실날짜 초과 종가를 StockDailyPrice 에서', async () => {
      realFeed();
      const prisma = makePrismaMock();
      // resolveSource 존재성 확인은 실데이터 있음
      (prisma.stockDailyPrice.findFirst as AnyFn).mockResolvedValue({ tradeDate: '20250604' });
      (prisma.stockDailyPrice.findMany as AnyFn).mockImplementation(
        async ({ where }: { where: { tradeDate: { gt: string } } }) => {
          expect(where.tradeDate.gt.startsWith('2025')).toBe(true);
          return [{ closePrice: 311 }, { closePrice: 312 }];
        },
      );
      const svc = makeService(prisma);
      const out = await svc.closesAfter('00126380', '20260605', 3);
      expect(out).toEqual([{ closePrice: 311 }, { closePrice: 312 }]);
      expect(prisma.simulatedDailyPrice.findMany).not.toHaveBeenCalled();
    });
  });

  describe('실가 변동 평가 — 시뮬 날짜 전진이 실 종가 변동을 부른다(DoD 핵심)', () => {
    it('연속 시뮬 거래일 2일은 서로 다른 매핑 실 종가를 반환(무변동 아님)', async () => {
      realFeed();
      process.env.PAPER_SIM_REAL_YEAR_OFFSET = '1';
      // 실 일봉 시계열(날짜→종가). 매핑 lte 하한 이하의 최신행을 흉내낸다.
      const realSeries: Record<string, number> = {
        '20250608': 1000,
        '20250609': 1042,
        '20250610': 1018,
      };
      const prisma = makePrismaMock();
      (prisma.stockDailyPrice.findFirst as AnyFn).mockImplementation(
        async ({ where }: { where: { tradeDate: { lte: string } } }) => {
          const bound = where.tradeDate.lte;
          const day = Object.keys(realSeries)
            .filter((d) => d <= bound)
            .sort()
            .pop();
          if (!day) return null;
          return {
            openPrice: realSeries[day], highPrice: realSeries[day],
            lowPrice: realSeries[day], closePrice: realSeries[day],
            volume: BigInt(1), tradeDate: day,
          };
        },
      );
      const svc = makeService(prisma);
      const d1 = await svc.latestPriceRow('00126380', '20260608');
      const d2 = await svc.latestPriceRow('00126380', '20260609');
      expect(d1?.source).toBe('REAL');
      expect(d2?.source).toBe('REAL');
      expect(d1?.closePrice).toBe(1000);
      expect(d2?.closePrice).toBe(1042); // 시뮬 날짜 1일 전진 → 실 종가 변동(평가손익 발생)
      expect(d1?.closePrice).not.toBe(d2?.closePrice);
      expect(d2?.sourceDate).toBe('20250609'); // 2026 아님 — 원일자 정직
    });
  });

  describe('realCoverage — 적재 검증·정직 고지', () => {
    it('유니버스 종목 중 실데이터 보유/미보유 집계 + 최신 실데이터 거래일', async () => {
      const prisma = makePrismaMock();
      (prisma.position.findMany as AnyFn).mockResolvedValue([
        { corpCode: 'A', stockCode: '000001' },
        { corpCode: 'B', stockCode: '000002' },
      ]);
      (prisma.tradingSignal.findMany as AnyFn).mockResolvedValue([]);
      // A 는 실데이터 있음(20251230), B 는 없음
      (prisma.stockDailyPrice.findFirst as AnyFn).mockImplementation(
        async ({ where }: { where: { corpCode: string } }) =>
          where.corpCode === 'A' ? { tradeDate: '20251230' } : null,
      );
      const svc = makeService(prisma);
      const cov = await svc.realCoverage('20251231');
      expect(cov.total).toBe(2);
      expect(cov.covered).toBe(1);
      expect(cov.uncovered).toEqual([{ corpCode: 'B', stockCode: '000002' }]);
      expect(cov.latestRealDate).toBe('20251230');
    });
  });
});
