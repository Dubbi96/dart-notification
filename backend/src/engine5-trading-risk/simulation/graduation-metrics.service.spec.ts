/**
 * graduation-metrics.service.spec.ts — 30일 모의운용 진행률 + G1/G2/G3 결합 검증 (DAR-86)
 *
 * paper-simulation 누적(G2)·적중률(G1)·AIUsageLog 비용(G3)을 진행률과 함께 한 응답으로
 * 결합하는지, 운용 시작 전/데이터 부족이면 측정대기(과신 방지)로 정직 표기하는지 고정한다.
 * InMemorySimulationAdapter 로 DB 없이 결정론적 재현. ★ read-only·AI 미개입.
 */
import { GraduationMetricsService } from './graduation-metrics.service';
import { InMemorySimulationAdapter } from './adapters/in-memory-simulation.adapter';
import { buildGraduationReport } from './domain/graduation-gates';

function service(adapter: InMemorySimulationAdapter): GraduationMetricsService {
  return new GraduationMetricsService(adapter);
}

describe('GraduationMetricsService — 진행률·G1/G2/G3 결합 (DAR-86)', () => {
  it('운용 시작 전(데이터 없음)이면 simulationProgress.awaitingMeasurement=true', async () => {
    const adapter = new InMemorySimulationAdapter({ initialCapital: 10_000_000 });
    // startDate 미지정(null) + 표본 0 → 측정대기
    const m = await service(adapter).getMetrics();

    expect(m.simulationProgress.awaitingMeasurement).toBe(true);
    expect(m.simulationProgress.elapsedDays).toBeNull();
    expect(m.simulationProgress.remainingDays).toBeNull();
    expect(m.simulationProgress.windowDays).toBe(30);

    const report = buildGraduationReport(m);
    expect(report.simulationProgress.awaitingMeasurement).toBe(true);
    // 표본 0 → G1 LOW_SAMPLE(과신 방지)
    const g1 = report.gates.find((g) => g.id === 'G1');
    expect(g1?.lowSample).toBe(true);
    expect(g1?.pass).toBeNull();
  });

  it('운용 중이면 진행률(측정대기 false) + G1/G2/G3 현재값을 결합해 노출한다', async () => {
    const adapter = new InMemorySimulationAdapter({
      initialCapital: 10_000_000,
      aiCostKrw: 100_000,
    });
    // 과거 시작일 → 측정대기 아님
    adapter.setStartDate('2026-05-22T00:00:00.000Z');
    // G1: 적중률 표본(6/10 = 60%)
    adapter.setHitRateSamples([
      ...Array.from({ length: 6 }, () => ({ returnPct: 3 })),
      ...Array.from({ length: 4 }, () => ({ returnPct: -2 })),
    ]);

    const m = await service(adapter).getMetrics();
    const report = buildGraduationReport(m);

    // 진행률: 운용 중 → 측정대기 false, 경과/잔여 산출됨
    expect(report.simulationProgress.awaitingMeasurement).toBe(false);
    expect(report.simulationProgress.startDate).toBe('2026-05-22T00:00:00.000Z');
    expect(report.simulationProgress.elapsedDays).not.toBeNull();
    expect(report.simulationProgress.remainingDays).not.toBeNull();
    expect(report.simulationProgress.progressRatio).toBeGreaterThanOrEqual(0);
    expect(report.simulationProgress.progressRatio).toBeLessThanOrEqual(1);

    // G1 적중률(60%) 결합
    const g1 = report.gates.find((g) => g.id === 'G1');
    expect(g1?.currentValue).toBeCloseTo(60, 5);
    expect(g1?.sampleSize).toBe(10);

    // G2 누적수익(포지션 없음 → 0%)
    const g2 = report.gates.find((g) => g.id === 'G2');
    expect(g2?.currentValue).toBe(0);

    // G3 AI비용/순익 — 순익 ≤ 0 이면 측정 불가(null) 정직 표기
    const g3 = report.gates.find((g) => g.id === 'G3');
    expect(m.aiCostEfficiency.aiCostKrw).toBe(100_000);
    expect(g3?.measurable).toBe(false);
    expect(g3?.pass).toBeNull();
  });
});
