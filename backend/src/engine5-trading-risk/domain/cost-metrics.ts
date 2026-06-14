// 비용 지표 계산기 — 순수 Rule (M10-A, DAR-16)
// AI 금지영역: AI 비용 측정은 집계만, AI 사용 결정 불가.

import { CostMetrics, CostMetricsInput } from './paper-trade.types';

/**
 * 비용 지표 계산 (순수 함수)
 * - costPerDisclosure: AI비용 / 공시수 (공시당 평균 AI비용)
 * - costPerSignal: AI비용 / 신호수
 * - costPerTrade: AI비용 / 거래수
 * - aiCostToNetPnlRatio: AI비용 / 순익 (순익이 0 이하면 측정 불가 → null)
 *
 * 규약은 paper-simulation/simulation-metrics.ts 와 통일: 순익이 양수일 때만
 * 비율이 유의미하다. 손실(음수)·손익 0 구간에서는 비율이 무의미하므로 null.
 * (과거 -1 센티넬은 "비용=손실 절대값"인 정당한 음수 비율과 충돌해 폐기.)
 */
export function calculateCostMetrics(input: CostMetricsInput): CostMetrics {
  const safe = (n: number) => (n > 0 ? n : null);

  const costPerDisclosure = safe(input.totalDisclosures)
    ? input.totalAiCostKrw / input.totalDisclosures
    : 0;

  const costPerSignal = safe(input.totalSignals)
    ? input.totalAiCostKrw / input.totalSignals
    : 0;

  const costPerTrade = safe(input.totalTrades)
    ? input.totalAiCostKrw / input.totalTrades
    : 0;

  const aiCostToNetPnlRatio =
    input.totalNetPnl > 0
      ? input.totalAiCostKrw / input.totalNetPnl
      : null; // 순익 0 이하 → 측정 불가

  return {
    costPerDisclosure,
    costPerSignal,
    costPerTrade,
    aiCostToNetPnlRatio,
  };
}
