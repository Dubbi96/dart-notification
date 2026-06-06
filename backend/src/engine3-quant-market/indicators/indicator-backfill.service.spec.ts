import { IndicatorBackfillService } from './indicator-backfill.service';
import { calcAllIndicators, Candle } from './indicators';

/**
 * DAR-50: DB 기반 기술지표 백필 — 멱등·정확성·모드 검증.
 */
describe('IndicatorBackfillService (DAR-50)', () => {
  /** 결정론적 일봉 시리즈 생성 (오름차순 거래일). */
  function makePrices(stockCode: string, corpCode: string, n: number) {
    const rows: Array<{
      corpCode: string;
      stockCode: string;
      tradeDate: string;
      openPrice: number;
      highPrice: number;
      lowPrice: number;
      closePrice: number;
      volume: bigint;
      tradingValue: bigint;
    }> = [];
    for (let i = 0; i < n; i++) {
      const close = 10000 + i * 50; // 단조 상승 — ma20 < close 보장
      const day = String(i + 1).padStart(2, '0');
      rows.push({
        corpCode,
        stockCode,
        tradeDate: `202601${day}`,
        openPrice: close - 20,
        highPrice: close + 30,
        lowPrice: close - 40,
        closePrice: close,
        volume: BigInt(100000 + i * 1000),
        tradingValue: BigInt((100000 + i * 1000) * close),
      });
    }
    return rows;
  }

  function buildPrisma(pricesByStock: Record<string, any[]>) {
    const upserts: any[] = [];
    const prisma = {
      stockDailyPrice: {
        findMany: jest.fn(async (args: any) => {
          if (args?.distinct) {
            return Object.keys(pricesByStock).map((stockCode) => ({ stockCode }));
          }
          return pricesByStock[args.where.stockCode] ?? [];
        }),
      },
      technicalIndicator: {
        upsert: jest.fn(async (args: any) => {
          upserts.push(args);
          return args.create;
        }),
      },
    };
    return { prisma, upserts };
  }

  it('latest 모드: 종목별 최신 거래일 1건만 적재한다', async () => {
    const prices = makePrices('000100', '00100000', 60);
    const { prisma, upserts } = buildPrisma({ '000100': prices });
    const service = new IndicatorBackfillService(prisma as any);

    const result = await service.backfill({ mode: 'latest' });

    expect(result.stocksProcessed).toBe(1);
    expect(result.indicatorsWritten).toBe(1);
    expect(upserts).toHaveLength(1);
    // 최신 거래일 = 마지막 캔들 날짜
    expect(upserts[0].where.stockCode_tradeDate.tradeDate).toBe('20260160');
  });

  it('적재 지표값이 순수 함수 calcAllIndicators 와 일치한다 (ma20/ma60/rsi 등)', async () => {
    const prices = makePrices('000100', '00100000', 60);
    const { prisma, upserts } = buildPrisma({ '000100': prices });
    const service = new IndicatorBackfillService(prisma as any);

    await service.backfill({ mode: 'latest' });

    const candles: Candle[] = prices.map((p) => ({
      date: p.tradeDate,
      open: p.openPrice,
      high: p.highPrice,
      low: p.lowPrice,
      close: p.closePrice,
      volume: Number(p.volume),
    }));
    const expected = calcAllIndicators(candles, null);

    const saved = upserts[0].create;
    expect(saved.ma20).toBeCloseTo(expected.ma20!, 6);
    expect(saved.ma60).toBeCloseTo(expected.ma60!, 6);
    expect(saved.rsi14).toBeCloseTo(expected.rsi14!, 6);
    // 단조 상승 → ma20 비null, 종가 > ma20 (entryReady ABOVE_MA20 해금 근거)
    expect(saved.ma20).not.toBeNull();
    expect(prices[prices.length - 1].closePrice).toBeGreaterThan(saved.ma20);
  });

  it('all 모드: 보유 전 거래일에 대해 1건씩 적재한다', async () => {
    const prices = makePrices('000100', '00100000', 5);
    const { prisma, upserts } = buildPrisma({ '000100': prices });
    const service = new IndicatorBackfillService(prisma as any);

    const result = await service.backfill({ mode: 'all' });

    expect(result.indicatorsWritten).toBe(5);
    expect(upserts).toHaveLength(5);
    expect(result.targetDates).toHaveLength(5);
  });

  it('멱등: 재실행해도 동일 (stockCode, tradeDate) upsert (중복 행 미발생)', async () => {
    const prices = makePrices('000100', '00100000', 30);
    const { prisma, upserts } = buildPrisma({ '000100': prices });
    const service = new IndicatorBackfillService(prisma as any);

    const r1 = await service.backfill({ mode: 'latest' });
    const r2 = await service.backfill({ mode: 'latest' });

    expect(r1.indicatorsWritten).toBe(1);
    expect(r2.indicatorsWritten).toBe(1);
    // 두 실행 모두 동일 키로 upsert (where 동일)
    expect(upserts[0].where).toEqual(upserts[1].where);
  });

  it('시세 부족 종목은 skip 처리한다', async () => {
    const { prisma } = buildPrisma({ EMPTY: [] });
    const service = new IndicatorBackfillService(prisma as any);

    const result = await service.backfill({ mode: 'latest', minCandles: 1 });

    expect(result.stocksProcessed).toBe(0);
    expect(result.stocksSkippedNoData).toBe(1);
  });
});
