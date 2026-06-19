import { buildEquityCurve } from './backtest-equity-curve';
import { SimulatedTrade } from '../ports/backtest.types';

function closedTrade(exitDateIso: string, netPnl: number): SimulatedTrade {
  return {
    rcpNo: `RCP-${exitDateIso}-${netPnl}`,
    corpCode: 'A005930',
    stockCode: '005930',
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore: 70,
    disclosureAt: new Date('2025-06-18T10:00:00+09:00'),
    isAfterMarket: false,
    entryDate: new Date(`${exitDateIso}T00:00:00Z`),
    entryPrice: 70000,
    entryShares: 10,
    entryValue: 700000,
    exitDate: new Date(`${exitDateIso}T06:00:00Z`),
    exitPrice: 70000 + netPnl / 10,
    exitShares: 10,
    exitValue: 700000 + netPnl,
    exitReason: netPnl >= 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
    commission: 0,
    tax: 0,
    slippage: 0,
    grossPnl: netPnl,
    netPnl,
    returnPct: (netPnl / 700000) * 100,
    holdDays: 3,
    wasLimitUp: false,
    wasLimitDown: false,
    wasTradingSuspended: false,
    wasAdminStock: false,
    isPartialFill: false,
    lowLiquidityFlag: false,
  };
}

describe('buildEquityCurve (DAR-385 트랙레코드 자산곡선)', () => {
  it('초기자본 시작점 + 청산 순서대로 누적 평가액', () => {
    const trades = [
      closedTrade('2025-07-01', 100_000),
      closedTrade('2025-08-01', -50_000),
      closedTrade('2025-09-01', 200_000),
    ];
    const curve = buildEquityCurve(trades, 10_000_000, '2025-06-19');

    expect(curve[0]).toEqual({
      date: '2025-06-19',
      equity: 10_000_000,
      returnPct: 0,
      drawdownPct: 0,
    });
    expect(curve).toHaveLength(4);
    expect(curve[1].equity).toBe(10_100_000);
    expect(curve[2].equity).toBe(10_050_000);
    expect(curve[3].equity).toBe(10_250_000);
    expect(curve[3].returnPct).toBeCloseTo(2.5, 5);
  });

  it('drawdownPct: 최고점 대비 낙폭(최고점이면 0, 하락 구간은 음수)', () => {
    const trades = [
      closedTrade('2025-07-01', 500_000), // peak 10.5M
      closedTrade('2025-08-01', -300_000), // 10.2M → DD = -300k/10.5M
    ];
    const curve = buildEquityCurve(trades, 10_000_000, '2025-06-19');
    expect(curve[1].drawdownPct).toBe(0); // 신고점
    expect(curve[2].drawdownPct).toBeCloseTo((-300_000 / 10_500_000) * 100, 5);
  });

  it('같은 날 복수 청산은 한 점으로 합산', () => {
    const trades = [
      closedTrade('2025-07-01', 100_000),
      closedTrade('2025-07-01', 50_000),
    ];
    const curve = buildEquityCurve(trades, 10_000_000, '2025-06-19');
    // start + 1 합산 점
    expect(curve).toHaveLength(2);
    expect(curve[1].date).toBe('2025-07-01');
    expect(curve[1].equity).toBe(10_150_000);
  });

  it('미청산(exitDate 없음) 거래는 곡선에서 제외', () => {
    const open = closedTrade('2025-07-01', 100_000);
    delete (open as { exitDate?: Date }).exitDate;
    open.netPnl = undefined;
    const curve = buildEquityCurve([open], 10_000_000, '2025-06-19');
    expect(curve).toHaveLength(1); // 시작점만
  });

  it('거래 없음 → 시작점만', () => {
    expect(buildEquityCurve([], 10_000_000, '2025-06-19')).toHaveLength(1);
  });
});
