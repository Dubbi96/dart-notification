// DAR-493 — 게이트 판정 리포트 순수 함수 결정론 검증.

import {
  computeMaxDrawdownPct,
  computeBuyHoldReturnPct,
  computeBuyHoldMddPct,
  buildTrackGateMetrics,
  assembleGateReport,
} from './gate-report';
import { TrackBacktestResult, BacktestTrade, DatedBar } from './two-tier-backtest.types';

function trade(net: number, holdDays = 1): BacktestTrade {
  return {
    assetCode: 'X',
    entryDate: '20230102',
    entryPrice: 1000,
    shares: 10,
    exitDate: '20230103',
    exitPrice: 1000 + net / 10,
    costs: 5,
    grossPnl: net + 5,
    netPnl: net,
    returnPct: net / 100,
    holdDays,
    reason: 'T',
  };
}

function result(trades: BacktestTrade[], finalEquity: number, sampleCount = trades.length): TrackBacktestResult {
  return {
    styleTag: 'test',
    trades,
    equityCurve: [
      { date: '20230101', equity: 10_000_000 },
      { date: '20230201', equity: finalEquity },
    ],
    sampleCount,
    initialCapital: 10_000_000,
    finalEquity,
  };
}

describe('computeMaxDrawdownPct', () => {
  it('peak-to-trough 낙폭(%)', () => {
    // 100 → 120(peak) → 90 → 110 : MDD = (90-120)/120 = -25%
    const curve = [100, 120, 90, 110].map((e, i) => ({ date: `2023010${i + 1}`, equity: e }));
    expect(computeMaxDrawdownPct(curve)).toBeCloseTo(-25, 6);
  });

  it('단조 증가 → 0', () => {
    const curve = [100, 110, 120].map((e, i) => ({ date: `2023010${i + 1}`, equity: e }));
    expect(computeMaxDrawdownPct(curve)).toBe(0);
  });
});

describe('computeBuyHoldReturnPct', () => {
  it('첫 시가 진입(비용 반영)·마지막 종가 마크', () => {
    const bars: DatedBar[] = [
      { date: '20230102', open: 1000, high: 1000, low: 1000, close: 1000 },
      { date: '20230103', open: 1100, high: 1100, low: 1100, close: 1200 },
    ];
    // 진입 = 1000*(1.003)*(1.00015) ≈ 1003.15 / 마크 1200 → ~19.6%
    const r = computeBuyHoldReturnPct(bars);
    expect(r).toBeGreaterThan(19);
    expect(r).toBeLessThan(20);
  });

  it('바 부족 → 0', () => {
    expect(computeBuyHoldReturnPct([])).toBe(0);
  });
});

describe('buildTrackGateMetrics', () => {
  it('승률·PF·엣지 양수 판정', () => {
    // 3승(+100 each) 1패(-50) / totalReturn 계산은 finalEquity 로.
    const r = result([trade(100), trade(100), trade(100), trade(-50)], 10_500_000);
    const m = buildTrackGateMetrics(r, 2.0, { minTrades: 4 });
    expect(m.totalTrades).toBe(4);
    expect(m.winRatePct).toBeCloseTo(75, 6);
    expect(m.profitFactor).toBeCloseTo(300 / 50, 6);
    expect(m.totalReturnPct).toBeCloseTo(5, 6); // 10.5M/10M-1
    expect(m.edgePositive).toBe(true); // 5% > 벤치 2%
    expect(m.verdict).toBe('EDGE_POSITIVE');
  });

  it('벤치마크 미달 → NO_EDGE(엣지 아님)', () => {
    const r = result([trade(100), trade(100), trade(100), trade(100)], 10_100_000);
    const m = buildTrackGateMetrics(r, 5.0, { minTrades: 4 }); // totalReturn 1% < 벤치 5%
    expect(m.edgePositive).toBe(false);
    expect(m.verdict).toBe('NO_EDGE');
  });

  it('표본 부족 → LOW_SAMPLE(엣지 양수라도)', () => {
    const r = result([trade(100), trade(100)], 10_500_000);
    const m = buildTrackGateMetrics(r, 0, { minTrades: 8 });
    expect(m.verdict).toBe('LOW_SAMPLE');
  });

  it('손실 0 & 이익>0 → PF Infinity', () => {
    const r = result([trade(100), trade(50)], 10_150_000);
    const m = buildTrackGateMetrics(r, 0, { minTrades: 2 });
    expect(m.profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it('lowPowerNote 가 note 에 포함된다(코어 정직 라벨)', () => {
    const r = result([trade(100)], 10_100_000);
    const m = buildTrackGateMetrics(r, 0, { minTrades: 1, lowPowerNote: '월단위 검증력 낮음' });
    expect(m.note).toContain('월단위 검증력 낮음');
  });
});

describe('computeBuyHoldMddPct', () => {
  it('종가 시계열 peak-to-trough MDD', () => {
    const bars: DatedBar[] = [100, 120, 90, 110].map((c, i) => ({
      date: `2023010${i + 1}`,
      open: c,
      high: c,
      low: c,
      close: c,
    }));
    // 120 → 90 : (90-120)/120 = -25%
    expect(computeBuyHoldMddPct(bars)).toBeCloseTo(-25, 6);
  });
});

describe('buildTrackGateMetrics — 코어 위험조정 게이트(DAR-494·§8 승인)', () => {
  it('수익률<벤치라도 벤치×0.9 이상 && MDD 개선이면 엣지 양수(엄격 기준이면 탈락)', () => {
    // 전략 +9%(MDD 0, 단조증가) · 벤치 +10%(MDD -30%). 엄격: 9%>10% = false. 위험조정: 9%≥9% && 0>-30 = true.
    const r = result([trade(100), trade(100), trade(100), trade(-50)], 10_900_000);
    const strict = buildTrackGateMetrics(r, 10, { minTrades: 4 });
    expect(strict.edgePositive).toBe(false);
    const adj = buildTrackGateMetrics(r, 10, { minTrades: 4, riskAdjusted: { benchmarkMddPct: -30 } });
    expect(adj.totalReturnPct).toBeCloseTo(9, 6);
    expect(adj.edgePositive).toBe(true);
    expect(adj.verdict).toBe('EDGE_POSITIVE');
    expect(adj.note).toContain('위험조정');
  });

  it('MDD 미개선(전략 MDD ≤ 벤치 MDD)이면 위험조정이라도 탈락', () => {
    // 전략 최종 +10%지만 중간 -40% 낙폭(벤치 -30%보다 깊음) → MDD 미개선 → false.
    const deep: TrackBacktestResult = {
      styleTag: 'core',
      trades: [trade(100), trade(100)],
      equityCurve: [
        { date: '20230101', equity: 10_000_000 },
        { date: '20230115', equity: 6_000_000 }, // -40% 낙폭
        { date: '20230201', equity: 11_000_000 },
      ],
      sampleCount: 24,
      initialCapital: 10_000_000,
      finalEquity: 11_000_000,
    };
    const adj = buildTrackGateMetrics(deep, 10, { minTrades: 2, riskAdjusted: { benchmarkMddPct: -30 } });
    expect(adj.mddPct).toBeCloseTo(-40, 6);
    expect(adj.edgePositive).toBe(false); // 수익률·floor 충족해도 MDD 미개선으로 탈락
  });

  it('수익률이 벤치×0.9 미달이면 위험조정이라도 탈락', () => {
    const r = result([trade(100)], 10_500_000); // +5%
    const adj = buildTrackGateMetrics(r, 10, { minTrades: 1, riskAdjusted: { benchmarkMddPct: -30 } }); // floor 9% > 5%
    expect(adj.edgePositive).toBe(false);
  });
});

describe('assembleGateReport', () => {
  it('두 트랙 모두 엣지 양수여야 overall 양수', () => {
    const pos = buildTrackGateMetrics(result([trade(100), trade(100)], 10_500_000), 0, { minTrades: 2 });
    const neg = buildTrackGateMetrics(result([trade(-100), trade(-100)], 9_500_000), 0, { minTrades: 2 });
    expect(assembleGateReport(pos, pos).overallEdgePositive).toBe(true);
    expect(assembleGateReport(pos, neg).overallEdgePositive).toBe(false);
  });

  it('activationNote 는 사람 결정임을 명시', () => {
    const m = buildTrackGateMetrics(result([trade(100)], 10_100_000), 0, { minTrades: 1 });
    expect(assembleGateReport(m, m).activationNote).toContain('통합자');
  });
});
