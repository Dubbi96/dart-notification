import { CachingBacktestPriceAdapter } from './caching-price-data.adapter';
import { InMemoryPriceDataAdapter } from '../ports/in-memory-price-data.adapter';
import { BacktestRunnerService } from '../backtest-runner.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { PriceConstraintService } from '../constraint/price-constraint.service';
import {
  DailyPrice,
  DisclosureSignal,
  StrategyParams,
  BacktestCostParams,
} from '../ports/backtest.types';

function makePrice(date: string, open: number, close: number): DailyPrice {
  return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * 0.98, close, volume: 100000 };
}

/** 2015~2026 전 연도에 걸친 거래일·가격 픽스처(월 1거래일 = 144일) — 11년 완주 검증용. */
function build11YearFixture(): { tradingDays: string[]; prices: DailyPrice[] } {
  const tradingDays: string[] = [];
  const prices: DailyPrice[] = [];
  let px = 10000;
  for (let y = 2015; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const date = `${y}-${String(m).padStart(2, '0')}-05`;
      tradingDays.push(date);
      px = px + ((m % 3) - 1) * 100; // 결정론적 소폭 변동
      prices.push(makePrice(date, px, px + 50));
    }
  }
  return { tradingDays, prices };
}

const STRATEGY: StrategyParams = {
  minBuyScore: 60,
  entryRule: 'NEXT_OPEN',
  exitRules: { takeProfitPct: 20, stopLossPct: -8, maxHoldDays: 20 },
  sizeRule: 'EQUAL_WEIGHT',
  maxPositions: 50,
  initialCapital: 10_000_000,
};
const COSTS: BacktestCostParams = { commissionRate: 0.00015, taxRate: 0.0018, slippagePct: 0.003 };

describe('CachingBacktestPriceAdapter (DAR-544 — 11년 러너 성능 캐시)', () => {
  const { tradingDays, prices } = build11YearFixture();

  it('창 내 조회는 내부 어댑터와 동일 결과를 반환한다(단일일·구간)', async () => {
    const inner = new InMemoryPriceDataAdapter({ '000001': prices }, tradingDays);
    const cached = new CachingBacktestPriceAdapter(inner, '2015-01-01', '2026-12-31');

    const singleBase = await inner.getDailyPrices('000001', '2020-06-05', '2020-06-05');
    const singleCached = await cached.getDailyPrices('000001', '2020-06-05', '2020-06-05');
    expect(singleCached).toEqual(singleBase);

    const rangeBase = await inner.getDailyPrices('000001', '2018-01-05', '2019-12-05');
    const rangeCached = await cached.getDailyPrices('000001', '2018-01-05', '2019-12-05');
    expect(rangeCached).toEqual(rangeBase);
    expect(rangeCached.length).toBeGreaterThan(0);
  });

  it('종목당 내부 적재는 조회 횟수와 무관하게 1회(질의 팬아웃 접기)', async () => {
    const inner = new InMemoryPriceDataAdapter({ '000001': prices }, tradingDays);
    const spy = jest.spyOn(inner, 'getDailyPrices');
    const cached = new CachingBacktestPriceAdapter(inner, '2015-01-01', '2026-12-31');

    for (const d of ['2015-03-05', '2016-07-05', '2020-01-05', '2026-12-05']) {
      await cached.getDailyPrices('000001', d, d);
    }
    // 한 종목의 여러 일자 조회 → 내부 getDailyPrices 는 창 1회만.
    expect(spy).toHaveBeenCalledTimes(1);
    const stats = cached.stats();
    expect(stats.loads).toBe(1);
    expect(stats.hits).toBe(3);
    expect(stats.cachedStocks).toBe(1);
  });

  it('창 밖 조회는 내부에 직접 위임한다(잘못된 절단 방지)', async () => {
    const inner = new InMemoryPriceDataAdapter({ '000001': prices }, tradingDays);
    const spy = jest.spyOn(inner, 'getDailyPrices');
    const cached = new CachingBacktestPriceAdapter(inner, '2016-01-01', '2016-12-31');

    // endDate 가 창(2016) 밖 → 위임.
    const out = await cached.getDailyPrices('000001', '2016-06-05', '2027-01-01');
    expect(spy).toHaveBeenCalledWith('000001', '2016-06-05', '2027-01-01', expect.anything());
    expect(cached.stats().loads).toBe(0); // 캐시 적재 없음(위임만)
    expect(out).toEqual(await inner.getDailyPrices('000001', '2016-06-05', '2027-01-01'));
  });

  it('러너 11년 완주 — 캐시 유무와 무관하게 트레이드가 동일하다(결과 불변)', async () => {
    const cal = new MarketCalendarService();
    const constraint = new PriceConstraintService();
    const inner = new InMemoryPriceDataAdapter({ '000001': prices }, tradingDays);
    const cached = new CachingBacktestPriceAdapter(inner, '2015-01-01', '2026-12-31');

    const signals: DisclosureSignal[] = [
      {
        rcpNo: 'RCP-2015',
        corpCode: 'C000001',
        stockCode: '000001',
        eventType: 'SUPPLY_CONTRACT',
        persona: 'GROWTH',
        disclosureAt: new Date('2015-01-05T10:00:00+09:00'),
        buyScore: 80,
      },
    ];

    const direct = new BacktestRunnerService(inner, cal, constraint);
    const viaCache = new BacktestRunnerService(cached, cal, constraint);
    const tradesDirect = await direct.run(signals, STRATEGY, COSTS, '2015-01-01', '2026-12-31');
    const tradesCached = await viaCache.run(signals, STRATEGY, COSTS, '2015-01-01', '2026-12-31');

    expect(tradesCached).toEqual(tradesDirect);
    expect(tradesDirect.length).toBeGreaterThan(0);
    // 11년 창을 한 종목 1회 적재로 완주.
    expect(cached.stats().loads).toBe(1);
  });
});
