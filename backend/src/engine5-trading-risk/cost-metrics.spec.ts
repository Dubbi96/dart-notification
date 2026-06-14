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

  it('순익 0이면 aiCostToNetPnlRatio = null (측정 불가)', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 50,
      totalSignals: 10,
      totalTrades: 2,
      totalAiCostKrw: 5000,
      totalNetPnl: 0,
    });
    expect(result.aiCostToNetPnlRatio).toBeNull();
  });

  it('순익 음수(손실)면 aiCostToNetPnlRatio = null — 비용=손실 절대값이어도 센티넬 충돌 없음', () => {
    // 과거 -1 센티넬 규약: 비용/순익 = 5000/-5000 = -1 이 정당값과 충돌해
    // "순익 0(측정 불가)"과 구분 불가였다. null 통일로 두 경우 모두 측정 불가로 명확.
    const result = calculateCostMetrics({
      totalDisclosures: 50,
      totalSignals: 10,
      totalTrades: 2,
      totalAiCostKrw: 5000,
      totalNetPnl: -5000, // 손실. 양수비용/음수순익 = -1 (과거 충돌 케이스)
    });
    expect(result.aiCostToNetPnlRatio).toBeNull();
  });

  it('순익 음수면 무의미한 음수 비율을 반환하지 않는다', () => {
    const result = calculateCostMetrics({
      totalDisclosures: 50,
      totalSignals: 10,
      totalTrades: 2,
      totalAiCostKrw: 3000,
      totalNetPnl: -200000, // 큰 손실
    });
    expect(result.aiCostToNetPnlRatio).toBeNull();
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
