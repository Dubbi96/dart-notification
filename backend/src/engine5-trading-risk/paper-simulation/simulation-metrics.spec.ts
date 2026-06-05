import {
  calculateSimulationMetrics,
  SimulationMetricsInput,
} from './simulation-metrics';

function base(): SimulationMetricsInput {
  return {
    signalOutcomes: [],
    exitOutcomes: [],
    initialCapital: 10_000_000,
    currentEquity: 10_000_000,
    realizedNetPnl: 0,
    unrealizedPnl: 0,
    totalAiCostKrw: 0,
  };
}

describe('calculateSimulationMetrics (순수 Rule)', () => {
  it('표본 0건이면 적중률·Exit정확도·AI비율을 null로 정직 표기(통과 위장 금지)', () => {
    const m = calculateSimulationMetrics(base());
    expect(m.hitRateD5).toBeNull();
    expect(m.hitRateSampleSize).toBe(0);
    expect(m.exitAccuracyD3).toBeNull();
    expect(m.exitAccuracySampleSize).toBe(0);
    expect(m.aiCostToNetPnlRatio).toBeNull();
    expect(m.gates.hitRatePass).toBeNull();
    expect(m.gates.exitAccuracyPass).toBeNull();
    expect(m.gates.aiCostRatioPass).toBeNull();
    // 누적수익률은 0% (원금=평가자산) → cumulativeReturnPass false
    expect(m.cumulativeReturnPct).toBe(0);
    expect(m.gates.cumulativeReturnPass).toBe(false);
  });

  it('신호 적중률: D+5 미도달(null) 표본은 제외하고 도달 표본만 집계', () => {
    const m = calculateSimulationMetrics({
      ...base(),
      signalOutcomes: [
        { d5ReturnPct: 3.2 },   // hit
        { d5ReturnPct: -1.5 },  // miss
        { d5ReturnPct: 0.1 },   // hit
        { d5ReturnPct: null },  // 미도달 — 제외
      ],
    });
    expect(m.hitRateSampleSize).toBe(3);
    expect(m.hitRateD5).toBeCloseTo(2 / 3, 5);
    expect(m.gates.hitRatePass).toBe(true); // 0.667 ≥ 0.55
  });

  it('적중률 0.55 미만이면 게이트 미통과', () => {
    const m = calculateSimulationMetrics({
      ...base(),
      signalOutcomes: [
        { d5ReturnPct: 1 },
        { d5ReturnPct: -1 },
        { d5ReturnPct: -2 },
        { d5ReturnPct: -3 },
      ],
    });
    expect(m.hitRateD5).toBeCloseTo(0.25, 5);
    expect(m.gates.hitRatePass).toBe(false);
  });

  it('Exit 정확도: EXIT 후 D+3 추가 하락(음수)이면 손절 적중', () => {
    const m = calculateSimulationMetrics({
      ...base(),
      exitOutcomes: [
        { d3ReturnPct: -2.0 }, // 추가 하락 → 손절 옳음(적중)
        { d3ReturnPct: -0.5 }, // 적중
        { d3ReturnPct: 1.2 },  // 반등 → 손절 틀림
        { d3ReturnPct: null }, // 미도달 — 제외
      ],
    });
    expect(m.exitAccuracySampleSize).toBe(3);
    expect(m.exitAccuracyD3).toBeCloseTo(2 / 3, 5);
    expect(m.gates.exitAccuracyPass).toBe(true);
  });

  it('누적 수익률·순익: 평가자산>원금이면 양수, netPnl=실현+미실현', () => {
    const m = calculateSimulationMetrics({
      ...base(),
      currentEquity: 10_500_000,
      realizedNetPnl: 300_000,
      unrealizedPnl: 200_000,
    });
    expect(m.cumulativeReturnPct).toBeCloseTo(5, 5); // (10.5M-10M)/10M
    expect(m.netPnl).toBe(500_000);
    expect(m.gates.cumulativeReturnPass).toBe(true);
  });

  it('AI비용/순익: 순익>0이면 비율 산출, 목표 ≤20% 판정', () => {
    const m = calculateSimulationMetrics({
      ...base(),
      realizedNetPnl: 1_000_000,
      totalAiCostKrw: 150_000, // 15%
    });
    expect(m.aiCostToNetPnlRatio).toBeCloseTo(0.15, 5);
    expect(m.gates.aiCostRatioPass).toBe(true);
  });

  it('AI비용/순익: 순익 0 이하면 측정 불가(null)·게이트 null', () => {
    const m = calculateSimulationMetrics({
      ...base(),
      realizedNetPnl: -50_000,
      unrealizedPnl: 0,
      totalAiCostKrw: 10_000,
    });
    expect(m.netPnl).toBe(-50_000);
    expect(m.aiCostToNetPnlRatio).toBeNull();
    expect(m.gates.aiCostRatioPass).toBeNull();
  });

  it('초기 원금 0이면 누적수익률 0으로 안전 처리(0 나누기 회피)', () => {
    const m = calculateSimulationMetrics({ ...base(), initialCapital: 0, currentEquity: 5 });
    expect(m.cumulativeReturnPct).toBe(0);
  });
});
