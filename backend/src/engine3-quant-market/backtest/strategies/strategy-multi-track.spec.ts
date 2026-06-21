import { BacktestRunnerService } from '../backtest-runner.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { PriceConstraintService } from '../constraint/price-constraint.service';
import { InMemoryPriceDataAdapter } from '../ports/in-memory-price-data.adapter';
import {
  DisclosureSignal,
  StrategyParams,
  BacktestCostParams,
  DailyPrice,
} from '../ports/backtest.types';

/**
 * DAR-404 — 다중 트랙 결정론 검증.
 *
 * 동일한 신호·가격 시퀀스를 '진입/청산/사이징 룰이 다른 전략'으로 돌리면 서로 다른 트랙
 * (청산 사유·수익률·체결 수량)이 결정론적으로 나오는지 확인한다. 이것이 '전략 변형 4종을
 * 각각 백테스트해 비교한다'는 본 이슈의 핵심 동작이다(미래정보 0 — 동일 in-memory 데이터).
 */
describe('전략 변형 다중 트랙 결정론 (DAR-404)', () => {
  const calendar = new MarketCalendarService();
  const constraint = new PriceConstraintService();

  const costs: BacktestCostParams = {
    commissionRate: 0.00015,
    taxRate: 0.0018,
    slippagePct: 0.003,
  };

  function makePrice(date: string, open: number, close: number, low: number): DailyPrice {
    return { date, open, high: Math.max(open, close) * 1.02, low, close, volume: 1_000_000 };
  }

  // 005930: 01-09 진입(시가 100) → 01-10 -7% 하락(저가 92) → 01-12 +15.6% 회복.
  const PRICES: Record<string, DailyPrice[]> = {
    '005930': [
      makePrice('2024-01-08', 100, 100, 99),
      makePrice('2024-01-09', 100, 100, 99),
      makePrice('2024-01-10', 95, 93, 92),
      makePrice('2024-01-11', 96, 100, 95),
      makePrice('2024-01-12', 110, 116, 108),
    ],
  };
  const TRADING_DAYS = ['2024-01-08', '2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12'];

  const signal: DisclosureSignal = {
    rcpNo: 'RCP404',
    corpCode: 'A005930',
    stockCode: '005930',
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    disclosureAt: new Date('2024-01-08T10:00:00+09:00'), // 장중 → 다음 거래일(01-09) 진입
    buyScore: 90,
  };

  function strat(over: Partial<StrategyParams>): StrategyParams {
    return {
      minBuyScore: 50,
      entryRule: 'NEXT_OPEN',
      exitRules: { takeProfitPct: 20, stopLossPct: -10, maxHoldDays: 20 },
      sizeRule: 'EQUAL_WEIGHT',
      maxPositions: 10,
      initialCapital: 10_000_000,
      ...over,
    };
  }

  async function runTrack(strategy: StrategyParams) {
    const adapter = new InMemoryPriceDataAdapter(PRICES, TRADING_DAYS);
    const runner = new BacktestRunnerService(adapter, calendar, constraint);
    const trades = await runner.run([signal], strategy, costs, '2024-01-08', '2024-01-12');
    return trades;
  }

  it('손절 폭이 다른 두 전략은 동일 데이터에서 다른 트랙(청산사유·수익률)을 만든다', async () => {
    // 타이트 손절 -5(단기모멘텀류): 01-10 -7% 에서 손절.
    const tight = await runTrack(strat({ exitRules: { takeProfitPct: 10, stopLossPct: -5, maxHoldDays: 5 } }));
    // 느슨 손절 -10(이벤트엣지류): 손절 미발화 → 보유 후 종료일 강제청산(+).
    const loose = await runTrack(strat({ exitRules: { takeProfitPct: 20, stopLossPct: -10, maxHoldDays: 20 } }));

    expect(tight).toHaveLength(1);
    expect(loose).toHaveLength(1);

    expect(tight[0].exitReason).toBe('STOP_LOSS');
    expect(tight[0].returnPct!).toBeLessThan(0);

    expect(loose[0].exitReason).toBe('FORCE_EXIT');
    expect(loose[0].returnPct!).toBeGreaterThan(0);

    // 결정론: 두 트랙의 수익률은 명백히 다르다.
    expect(tight[0].returnPct).not.toBeCloseTo(loose[0].returnPct!, 2);
  });

  it('SCORE_WEIGHT 는 고점수 신호에 EQUAL_WEIGHT 보다 더 큰 체결 수량을 싣는다', async () => {
    const equal = await runTrack(strat({ sizeRule: 'EQUAL_WEIGHT' }));
    const scored = await runTrack(strat({ sizeRule: 'SCORE_WEIGHT' })); // buyScore 90 → 1.4배 예산

    expect(scored[0].entryShares).toBeGreaterThan(equal[0].entryShares);
    // 90점 → 0.5 + 0.9 = 1.4배. 균등 대비 약 1.4배 수량(체결 정수 반올림 오차 허용).
    expect(scored[0].entryShares / equal[0].entryShares).toBeCloseTo(1.4, 1);
  });
});
