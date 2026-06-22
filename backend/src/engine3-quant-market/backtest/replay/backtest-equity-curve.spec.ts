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

describe('buildEquityCurve (DAR-385 트랙레코드 자산곡선 · DAR-412 flat-fill)', () => {
  it('각 변동일마다 직전 달력일 flat 앵커 + 청산 순서대로 누적 평가액', () => {
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
    // 시작점 + (앵커+변동) × 3 = 7점
    expect(curve).toHaveLength(7);

    // 첫 변동 직전 앵커(2025-06-30)는 원금 유지(flat)
    expect(curve[1]).toEqual({
      date: '2025-06-30',
      equity: 10_000_000,
      returnPct: 0,
      drawdownPct: 0,
    });
    expect(curve[2]).toMatchObject({ date: '2025-07-01', equity: 10_100_000 });
    // 두 번째 변동 직전 앵커(2025-07-31)는 직전 평가액(10.1M) 유지
    expect(curve[3]).toMatchObject({ date: '2025-07-31', equity: 10_100_000 });
    expect(curve[4]).toMatchObject({ date: '2025-08-01', equity: 10_050_000 });
    expect(curve[5]).toMatchObject({ date: '2025-08-31', equity: 10_050_000 });
    expect(curve[6]).toMatchObject({ date: '2025-09-01', equity: 10_250_000 });
    expect(curve[6].returnPct).toBeCloseTo(2.5, 5);
  });

  it('flat 앵커는 거래 없는 구간을 평평하게 — 두 점 간 평가액 동일(직선 보간 방지)', () => {
    // 거래가 1건뿐(먼 미래) → 시작점에서 첫 청산까지 평평해야 한다.
    const curve = buildEquityCurve(
      [closedTrade('2026-06-15', 300_000)],
      10_000_000,
      '2025-06-22',
    );
    expect(curve).toHaveLength(3);
    expect(curve[0]).toMatchObject({ date: '2025-06-22', equity: 10_000_000 });
    // 변동 직전일 앵커 — 여전히 원금(평평)
    expect(curve[1]).toMatchObject({ date: '2026-06-14', equity: 10_000_000 });
    // 청산 시점에 계단 상승
    expect(curve[2]).toMatchObject({ date: '2026-06-15', equity: 10_300_000 });
  });

  it('drawdownPct: 최고점 대비 낙폭(최고점이면 0, 하락 구간은 음수)', () => {
    const trades = [
      closedTrade('2025-07-01', 500_000), // peak 10.5M
      closedTrade('2025-08-01', -300_000), // 10.2M → DD = -300k/10.5M
    ];
    const curve = buildEquityCurve(trades, 10_000_000, '2025-06-19');
    const peakPt = curve.find((p) => p.date === '2025-07-01');
    const ddPt = curve.find((p) => p.date === '2025-08-01');
    expect(peakPt?.drawdownPct).toBe(0); // 신고점
    expect(ddPt?.drawdownPct).toBeCloseTo((-300_000 / 10_500_000) * 100, 5);
  });

  it('같은 날 복수 청산은 한 점으로 합산', () => {
    const trades = [
      closedTrade('2025-07-01', 100_000),
      closedTrade('2025-07-01', 50_000),
    ];
    const curve = buildEquityCurve(trades, 10_000_000, '2025-06-19');
    // start + 앵커(2025-06-30) + 합산 점(2025-07-01) = 3점
    expect(curve).toHaveLength(3);
    expect(curve[curve.length - 1].date).toBe('2025-07-01');
    expect(curve[curve.length - 1].equity).toBe(10_150_000);
  });

  it('시작일 당일 청산 — 앵커 없이 시작점 갱신(중복 점 생성 금지)', () => {
    const curve = buildEquityCurve(
      [closedTrade('2025-06-19', 100_000)],
      10_000_000,
      '2025-06-19',
    );
    expect(curve).toHaveLength(1);
    expect(curve[0]).toMatchObject({ date: '2025-06-19', equity: 10_100_000 });
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
