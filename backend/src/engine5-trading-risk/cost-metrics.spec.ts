// cost-metrics.spec.ts — 비용지표 fixture 테스트 (M10-A, DAR-16)
import { calculateCostMetrics } from './domain/cost-metrics';

describe('CostMetrics', () => {
  it('정상 입력 계산', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 100,
      totalSignals: 20,
      totalTrades: 5,
      totalAiCostKrw: 10000,
      totalNetPnl: 500000,
    });
    expect(result.costPerDisclosure).toBeCloseTo(100, 2);
    expect(result.costPerSignal).toBeCloseTo(500, 2);
    expect(result.costPerTrade).toBeCloseTo(2000, 2);
    expect(result.aiCostToNetPnlRatio).toBeCloseTo(0.02, 4);
  });

  it('공시 수 0이면 costPerDisclosure = 0', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 0,
      totalSignals: 10,
      totalTrades: 2,
      totalAiCostKrw: 5000,
      totalNetPnl: 100000,
    });
    expect(result.costPerDisclosure).toBe(0);
  });

  it('순익 0이면 aiCostToNetPnlRatio = -1', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 50,
      totalSignals: 10,
      totalTrades: 2,
      totalAiCostKrw: 5000,
      totalNetPnl: 0,
    });
    expect(result.aiCostToNetPnlRatio).toBe(-1);
  });

  it('AI 비용 0 → 모든 지표 0', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 100,
      totalSignals: 20,
      totalTrades: 5,
      totalAiCostKrw: 0,
      totalNetPnl: 500000,
    });
    expect(result.costPerDisclosure).toBe(0);
    expect(result.costPerSignal).toBe(0);
    expect(result.costPerTrade).toBe(0);
    expect(result.aiCostToNetPnlRatio).toBe(0);
  });

  it('신호 수 0이면 costPerSignal = 0', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 50,
      totalSignals: 0,
      totalTrades: 3,
      totalAiCostKrw: 3000,
      totalNetPnl: 200000,
    });
    expect(result.costPerSignal).toBe(0);
  });
});
