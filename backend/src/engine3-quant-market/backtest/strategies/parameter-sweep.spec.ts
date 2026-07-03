/**
 * DAR-485 — parameter-sweep.ts 순수 모듈 단위 테스트(견고화 W3·P24)
 *
 * 1. buildSweepGrid: baseline + 축별 이웃(OAT)·clamp·불변성
 * 2. toSweepSnapshot: Infinity/NaN → null 방어
 * 3. classifyAxis: LOW_SAMPLE/FRAGILE/SENSITIVE/MODERATE/STABLE 경계
 * 4. buildSweepReport: 축 조립·overall 최악·최민감축·표본부족 경로
 */
import { StrategyParams, PerformanceMetrics } from '../ports/backtest.types';
import {
  buildSweepGrid,
  buildSweepReport,
  classifyAxis,
  toSweepSnapshot,
  SweepMetricSnapshot,
  SweepPoint,
  SWEEP_AXES,
  SWEEP_LOW_SAMPLE_TRADES,
  SWEEP_READONLY_NOTICE,
} from './parameter-sweep';

const BASE: StrategyParams = {
  minBuyScore: 40,
  entryRule: 'NEXT_OPEN',
  exitRules: { takeProfitPct: 20, stopLossPct: -8, maxHoldDays: 20 },
  sizeRule: 'EQUAL_WEIGHT',
  maxPositions: 20,
  initialCapital: 10_000_000,
};

function snap(overrides: Partial<SweepMetricSnapshot> = {}): SweepMetricSnapshot {
  return {
    totalReturn: 10,
    winRate: 55,
    profitFactor: 1.5,
    mdd: -12,
    sharpe: 1,
    totalTrades: 30,
    ...overrides,
  };
}

describe('buildSweepGrid — 이웃값 그리드(OAT)', () => {
  it('표준 프리셋 → baseline + 4축×2 = 9개 파라미터 집합', () => {
    const grid = buildSweepGrid(BASE);
    expect(grid).toHaveLength(9);
    expect(grid[0].direction).toBe('baseline');
    expect(grid[0].params).toBe(BASE);
  });

  it('축별 이웃값이 정확히 ±스텝 clamp 반영(손절 ±2·익절 ±5·보유일 ±5·점수 ±5)', () => {
    const grid = buildSweepGrid(BASE);
    const find = (axis: string, dir: string) =>
      grid.find((p) => p.axisKey === axis && p.direction === dir)!;

    expect(find('stopLoss', 'down').params.exitRules.stopLossPct).toBe(-10);
    expect(find('stopLoss', 'up').params.exitRules.stopLossPct).toBe(-6);
    expect(find('takeProfit', 'down').params.exitRules.takeProfitPct).toBe(15);
    expect(find('takeProfit', 'up').params.exitRules.takeProfitPct).toBe(25);
    expect(find('holdDays', 'down').params.exitRules.maxHoldDays).toBe(15);
    expect(find('holdDays', 'up').params.exitRules.maxHoldDays).toBe(25);
    expect(find('minBuyScore', 'down').params.minBuyScore).toBe(35);
    expect(find('minBuyScore', 'up').params.minBuyScore).toBe(45);
  });

  it('OAT — 한 축만 흔들고 나머지는 baseline 고정', () => {
    const grid = buildSweepGrid(BASE);
    const slDown = grid.find((p) => p.axisKey === 'stopLoss' && p.direction === 'down')!;
    // 손절만 -10, 익절·보유일·점수는 baseline 그대로
    expect(slDown.params.exitRules.stopLossPct).toBe(-10);
    expect(slDown.params.exitRules.takeProfitPct).toBe(BASE.exitRules.takeProfitPct);
    expect(slDown.params.exitRules.maxHoldDays).toBe(BASE.exitRules.maxHoldDays);
    expect(slDown.params.minBuyScore).toBe(BASE.minBuyScore);
  });

  it('clamp 로 원값과 같아지는 이웃은 제외(보유일 1 → down clamp(-4)=1=원값 skip)', () => {
    const tightHold: StrategyParams = { ...BASE, exitRules: { ...BASE.exitRules, maxHoldDays: 1 } };
    const grid = buildSweepGrid(tightHold);
    const holdPoints = grid.filter((p) => p.axisKey === 'holdDays');
    // down = clamp(1-5)=1 == 원값 → 제외, up = clamp(6)=6 만 유지
    expect(holdPoints).toHaveLength(1);
    expect(holdPoints[0].direction).toBe('up');
    expect(holdPoints[0].params.exitRules.maxHoldDays).toBe(6);
  });

  it('손절은 음수(≤-1) 유지 clamp — 익절은 양수(≥1) 유지', () => {
    const shallow: StrategyParams = {
      ...BASE,
      exitRules: { ...BASE.exitRules, stopLossPct: -1, takeProfitPct: 3 },
    };
    const grid = buildSweepGrid(shallow);
    const slUp = grid.find((p) => p.axisKey === 'stopLoss' && p.direction === 'up');
    // up = clamp(-1+2=1) → min(-1,1) = -1 == 원값 → 제외
    expect(slUp).toBeUndefined();
    const tpDown = grid.find((p) => p.axisKey === 'takeProfit' && p.direction === 'down')!;
    // down = clamp(3-5=-2) → max(1,-2) = 1
    expect(tpDown.params.exitRules.takeProfitPct).toBe(1);
  });

  it('원본 base 를 변경하지 않는다(불변)', () => {
    const snapshot = JSON.stringify(BASE);
    buildSweepGrid(BASE);
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });
});

describe('toSweepSnapshot — Infinity/NaN 방어', () => {
  const metrics = (over: Partial<PerformanceMetrics>): PerformanceMetrics =>
    ({
      totalReturn: 12,
      annualizedReturn: 12,
      winRate: 60,
      avgWin: 5,
      avgLoss: -3,
      profitFactor: 2,
      mdd: -10,
      sharpe: 1.2,
      totalTrades: 40,
      wonTrades: 24,
      lostTrades: 16,
      avgHoldDays: 7,
      monthlyReturns: {},
      byEventType: {},
      byPersona: {},
      worstTrades: [],
      realWorldGate: {} as PerformanceMetrics['realWorldGate'],
      passedGate: false,
      ...over,
    }) as PerformanceMetrics;

  it('profitFactor=Infinity → null, sharpe=NaN → null', () => {
    const s = toSweepSnapshot(metrics({ profitFactor: Infinity, sharpe: NaN }));
    expect(s.profitFactor).toBeNull();
    expect(s.sharpe).toBeNull();
    expect(s.totalReturn).toBe(12);
    expect(s.totalTrades).toBe(40);
  });

  it('유한값은 그대로 통과', () => {
    const s = toSweepSnapshot(metrics({}));
    expect(s.profitFactor).toBe(2);
    expect(s.sharpe).toBe(1.2);
    expect(s.mdd).toBe(-10);
  });
});

describe('classifyAxis — 판정 경계', () => {
  it('baseline 표본 < 임계 → LOW_SAMPLE', () => {
    expect(classifyAxis(SWEEP_LOW_SAMPLE_TRADES - 1, 100, 5, false)).toBe('LOW_SAMPLE');
  });

  it('부호 뒤집힘 → FRAGILE', () => {
    expect(classifyAxis(30, 25, 1.25, true)).toBe('FRAGILE');
  });

  it('절대변동 미미(<3%p) → STABLE', () => {
    expect(classifyAxis(30, 2, 10, false)).toBe('STABLE');
  });

  it('상대변동 ≥0.5 → SENSITIVE', () => {
    expect(classifyAxis(30, 12, 0.6, false)).toBe('SENSITIVE');
  });

  it('상대변동 [0.25,0.5) → MODERATE', () => {
    expect(classifyAxis(30, 8, 0.3, false)).toBe('MODERATE');
  });

  it('상대변동 <0.25 → STABLE', () => {
    expect(classifyAxis(30, 8, 0.2, false)).toBe('STABLE');
  });

  it('흔들 이웃 없음(null) → STABLE', () => {
    expect(classifyAxis(30, null, null, false)).toBe('STABLE');
  });
});

/** 그리드 각 점에 snapshot 을 매핑하는 헬퍼. */
function resultsFor(
  grid: SweepPoint[],
  fn: (p: SweepPoint) => SweepMetricSnapshot,
): Array<{ point: SweepPoint; snapshot: SweepMetricSnapshot }> {
  return grid.map((point) => ({ point, snapshot: fn(point) }));
}

describe('buildSweepReport — 축 조립·overall·최민감축', () => {
  it('혼합 시나리오: takeProfit FRAGILE(부호뒤집힘)·holdDays SENSITIVE·minBuyScore MODERATE·stopLoss STABLE', () => {
    const grid = buildSweepGrid(BASE);
    const results = resultsFor(grid, (p) => {
      if (p.direction === 'baseline') return snap({ totalReturn: 20, totalTrades: 30 });
      switch (p.axisKey) {
        case 'stopLoss':
          return snap({ totalReturn: p.direction === 'down' ? 19 : 21, totalTrades: 30 }); // swing ≤1 → STABLE
        case 'takeProfit':
          return snap({ totalReturn: p.direction === 'down' ? -5 : 30, totalTrades: 30 }); // down 부호뒤집힘 → FRAGILE
        case 'holdDays':
          return snap({ totalReturn: p.direction === 'down' ? 30 : 35, totalTrades: 30 }); // swing 15, rel .75 → SENSITIVE
        case 'minBuyScore':
          return snap({ totalReturn: p.direction === 'down' ? 24 : 26, totalTrades: 30 }); // swing 6, rel .3 → MODERATE
        default:
          return snap();
      }
    });

    const report = buildSweepReport({
      presetKey: 'test',
      presetLabel: '테스트',
      window: { startDate: '2025-01-01', endDate: '2025-12-31' },
      base: BASE,
      results,
    });

    const verdictOf = (axis: string) => report.axes.find((a) => a.axisKey === axis)!.verdict;
    expect(verdictOf('stopLoss')).toBe('STABLE');
    expect(verdictOf('takeProfit')).toBe('FRAGILE');
    expect(verdictOf('holdDays')).toBe('SENSITIVE');
    expect(verdictOf('minBuyScore')).toBe('MODERATE');

    // overall = 최악(FRAGILE), 최민감축 = 상대변동 최대(takeProfit: |−5−20|/20 = 1.25)
    expect(report.overallVerdict).toBe('FRAGILE');
    expect(report.mostSensitiveAxisKey).toBe('takeProfit');
    expect(report.lowSample).toBe(false);
    expect(report.baselineTrades).toBe(30);
    expect(report.baseline.totalReturn).toBe(20);
    expect(report.gridSize).toBe(9);
    expect(report.notice).toBe(SWEEP_READONLY_NOTICE);
    expect(report.axes).toHaveLength(SWEEP_AXES.length);
  });

  it('takeProfit 축 지표 표: baseline/down/up·델타·maxAbsSwing 정합', () => {
    const grid = buildSweepGrid(BASE);
    const results = resultsFor(grid, (p) => {
      if (p.direction === 'baseline') return snap({ totalReturn: 20, totalTrades: 30 });
      if (p.axisKey === 'takeProfit')
        return snap({ totalReturn: p.direction === 'down' ? 12 : 26, totalTrades: 30 });
      return snap({ totalReturn: 20, totalTrades: 30 });
    });
    const report = buildSweepReport({
      presetKey: 'test',
      presetLabel: '테스트',
      window: { startDate: '2025-01-01', endDate: '2025-12-31' },
      base: BASE,
      results,
    });
    const tp = report.axes.find((a) => a.axisKey === 'takeProfit')!;
    const row = tp.metrics.find((m) => m.metric === 'totalReturn')!;
    expect(row.baseline).toBe(20);
    expect(row.down).toBe(12);
    expect(row.up).toBe(26);
    expect(row.downDelta).toBe(-8);
    expect(row.upDelta).toBe(6);
    expect(row.maxAbsSwing).toBe(8);
    expect(tp.baselineParam).toBe(20);
    expect(tp.downParam).toBe(15);
    expect(tp.upParam).toBe(25);
  });

  it('baseline 표본 부족 → overall LOW_SAMPLE·최민감축 null·전 축 LOW_SAMPLE', () => {
    const grid = buildSweepGrid(BASE);
    const results = resultsFor(grid, (p) =>
      snap({ totalReturn: p.direction === 'baseline' ? 5 : 40, totalTrades: 8 }),
    );
    const report = buildSweepReport({
      presetKey: 'test',
      presetLabel: '테스트',
      window: { startDate: '2025-01-01', endDate: '2025-12-31' },
      base: BASE,
      results,
    });
    expect(report.lowSample).toBe(true);
    expect(report.overallVerdict).toBe('LOW_SAMPLE');
    expect(report.mostSensitiveAxisKey).toBeNull();
    expect(report.axes.every((a) => a.verdict === 'LOW_SAMPLE')).toBe(true);
  });

  it('baseline 결과 누락 → 예외(그리드 무결성)', () => {
    expect(() =>
      buildSweepReport({
        presetKey: 'test',
        presetLabel: '테스트',
        window: { startDate: '2025-01-01', endDate: '2025-12-31' },
        base: BASE,
        results: [],
      }),
    ).toThrow(/baseline/);
  });
});
