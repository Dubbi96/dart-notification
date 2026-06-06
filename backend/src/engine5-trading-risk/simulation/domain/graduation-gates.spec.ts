// 졸업 게이트 평가기 단위 스펙 (DAR-67)
// 핵심 가드: 표본 부족 게이트는 통과로 위장하지 않고 pass=null + LOW_SAMPLE 표기(과신 방지).

import {
  buildGraduationReport,
  GRADUATION_MIN_SAMPLE,
  GRADUATION_THRESHOLDS,
} from './graduation-gates';
import { GraduationMetrics } from '../graduation-metrics.service';

function metrics(overrides: Partial<GraduationMetrics> = {}): GraduationMetrics {
  return {
    portfolioId: 'pf-1',
    asOf: '2026-06-06T00:00:00.000Z',
    hitRate: { evaluated: 10, hits: 6, hitRatePct: 60 },
    cumulativeReturn: {
      initialCapital: 10_000_000,
      currentValue: 10_500_000,
      absolutePnl: 500_000,
      returnPct: 5,
    },
    aiCostEfficiency: {
      aiCostKrw: 50_000,
      netPnlKrw: 500_000,
      netPnlAfterAiCost: 450_000,
      aiCostToNetPnlRatio: 0.1,
    },
    exitAccuracy: { evaluated: 8, correct: 5, accuracyPct: 62.5 },
    config: { hitRateHorizonDays: 5, exitAccuracyHorizonDays: 3, usdKrwRate: 1350 },
    ...overrides,
  };
}

describe('buildGraduationReport', () => {
  it('4개 게이트(G1·G2·G3·G5)를 산출한다', () => {
    const r = buildGraduationReport(metrics());
    expect(r.gates.map((g) => g.id)).toEqual(['G1', 'G2', 'G3', 'G5']);
    expect(r.totalGates).toBe(4);
  });

  it('표본 충분 + 기준 달성 시 전 게이트 통과(allPassed)', () => {
    const r = buildGraduationReport(metrics());
    expect(r.gates.every((g) => g.pass === true)).toBe(true);
    expect(r.passedCount).toBe(4);
    expect(r.allPassed).toBe(true);
    expect(r.progress).toBe(1);
    expect(r.lowSample).toBe(false);
  });

  it('G1/G5 표본 부족이면 pass=null + lowSample=true (통과 위장 금지)', () => {
    const r = buildGraduationReport(
      metrics({
        hitRate: { evaluated: GRADUATION_MIN_SAMPLE - 1, hits: 3, hitRatePct: 80 },
        exitAccuracy: { evaluated: 0, correct: 0, accuracyPct: 0 },
      }),
    );
    const g1 = r.gates.find((g) => g.id === 'G1')!;
    const g5 = r.gates.find((g) => g.id === 'G5')!;
    expect(g1.pass).toBeNull();
    expect(g1.lowSample).toBe(true);
    expect(g1.currentValue).toBeNull();
    expect(g1.sampleSize).toBe(GRADUATION_MIN_SAMPLE - 1);
    expect(g5.pass).toBeNull();
    expect(g5.lowSample).toBe(true);
    expect(r.lowSample).toBe(true);
    expect(r.allPassed).toBe(false);
  });

  it('정확히 MIN_SAMPLE 이면 표본 충분으로 평가한다(경계)', () => {
    const r = buildGraduationReport(
      metrics({
        hitRate: { evaluated: GRADUATION_MIN_SAMPLE, hits: 1, hitRatePct: 20 },
      }),
    );
    const g1 = r.gates.find((g) => g.id === 'G1')!;
    expect(g1.lowSample).toBe(false);
    expect(g1.pass).toBe(false); // 20% < 55% 기준 → 미달
    expect(g1.currentValue).toBe(20);
  });

  it('G2 누적수익은 표본 없이 항상 측정 — 0% 이하면 미달', () => {
    const r = buildGraduationReport(
      metrics({
        cumulativeReturn: {
          initialCapital: 10_000_000,
          currentValue: 9_000_000,
          absolutePnl: -1_000_000,
          returnPct: -10,
        },
      }),
    );
    const g2 = r.gates.find((g) => g.id === 'G2')!;
    expect(g2.sampleSize).toBeNull();
    expect(g2.lowSample).toBe(false);
    expect(g2.pass).toBe(false);
    expect(g2.measurable).toBe(true);
  });

  it('G3 순익 ≤ 0 (ratio=-1) 이면 측정 불가 → pass=null, measurable=false', () => {
    const r = buildGraduationReport(
      metrics({
        aiCostEfficiency: {
          aiCostKrw: 50_000,
          netPnlKrw: -100_000,
          netPnlAfterAiCost: -150_000,
          aiCostToNetPnlRatio: -1,
        },
      }),
    );
    const g3 = r.gates.find((g) => g.id === 'G3')!;
    expect(g3.pass).toBeNull();
    expect(g3.measurable).toBe(false);
    expect(g3.currentValue).toBeNull();
  });

  it('G3 비율이 기준(0.2) 초과면 미달', () => {
    const r = buildGraduationReport(
      metrics({
        aiCostEfficiency: {
          aiCostKrw: 300_000,
          netPnlKrw: 500_000,
          netPnlAfterAiCost: 200_000,
          aiCostToNetPnlRatio: 0.6,
        },
      }),
    );
    const g3 = r.gates.find((g) => g.id === 'G3')!;
    expect(g3.threshold).toBe(GRADUATION_THRESHOLDS.aiCostRatio);
    expect(g3.pass).toBe(false);
  });

  it('portfolioId·asOf 를 그대로 전달한다', () => {
    const r = buildGraduationReport(metrics({ portfolioId: 'pf-x', asOf: '2026-01-01T00:00:00.000Z' }));
    expect(r.portfolioId).toBe('pf-x');
    expect(r.asOf).toBe('2026-01-01T00:00:00.000Z');
  });
});
