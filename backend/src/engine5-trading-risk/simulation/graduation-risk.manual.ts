/**
 * DAR-68 동작 재현(결정론적) — 위험조정·벤치마크 졸업 게이트 end-to-end.
 *
 * in-memory 어댑터에 평가액 곡선 + KOSPI 지수 표본을 주입 → GraduationMetricsService →
 * buildGraduationReport 까지 흘려, G6(MDD)·G7(KOSPI alpha) 게이트와 Sharpe 참고지표가
 * 산출되는지 콘솔로 확인한다. AI 개입 0(순수 Rule). 실행: npx ts-node src/.../graduation-risk.manual.ts
 *
 * createApplicationContext logger 가 logger.log 을 억제하므로 console.log 사용(DAR-53 교훈).
 */
import { InMemorySimulationAdapter } from './adapters/in-memory-simulation.adapter';
import { GraduationMetricsService } from './graduation-metrics.service';
import { buildGraduationReport } from './domain/graduation-gates';
import { GRADUATION_BENCHMARK_INDEX_CODE } from './domain/graduation-gates';

async function main() {
  const adapter = new InMemorySimulationAdapter({
    portfolioId: 'sim-pf',
    initialCapital: 10_000_000,
    aiCostKrw: 40_000,
  });
  adapter.setHitRateSamples(
    Array.from({ length: 10 }, (_, i) => ({ returnPct: i < 6 ? 4 : -2 })),
  );
  adapter.setExitAccuracySamples(
    Array.from({ length: 8 }, (_, i) => ({
      priceAtExit: 1000,
      priceAfterHorizon: i < 5 ? 950 : 1050,
    })),
  );
  // 누적순익 확보용(G3 측정 가능) — 청산 포지션 평가에 직접 의존하지 않으므로 cumulativeState 는
  // currentValue 로 산출. 여기서는 평가액 곡선 마지막 값이 곧 G2 누적수익 기준이 되도록 setClose 생략.
  // 평가액 곡선(일별 totalValue) — 완만한 우상향 + 중간 낙폭 8%.
  adapter.setEquityCurve([
    { snapshotDate: '20260101', totalValue: 10_000_000 },
    { snapshotDate: '20260108', totalValue: 10_300_000 },
    { snapshotDate: '20260115', totalValue: 9_660_000 }, // 고점 대비 -6.2%
    { snapshotDate: '20260122', totalValue: 10_200_000 },
    { snapshotDate: '20260201', totalValue: 10_700_000 },
  ]);
  // KOSPI 지수 표본 — 같은 기간 +4% (전략은 +7% → alpha +3%).
  adapter.setBenchmarkSeries(GRADUATION_BENCHMARK_INDEX_CODE, [
    { tradeDate: '20260101', closeIndex: 2500 },
    { tradeDate: '20260201', closeIndex: 2600 },
  ]);

  const service = new GraduationMetricsService(adapter);
  const metrics = await service.getMetrics('sim-pf');
  const report = buildGraduationReport(metrics);

  console.log('[DAR-68] riskAdjusted =', JSON.stringify(metrics.riskAdjusted));
  console.log('[DAR-68] benchmarkAlpha =', JSON.stringify(metrics.benchmarkAlpha));
  console.log('[DAR-68] sharpe(report) =', report.sharpe);
  console.log('[DAR-68] gates:');
  for (const g of report.gates) {
    console.log(
      `  ${g.id} ${g.label}: cur=${g.currentValue} ${g.comparator} ${g.threshold} → pass=${g.pass} (measurable=${g.measurable}, lowSample=${g.lowSample})`,
    );
  }
  console.log(
    `[DAR-68] passedCount=${report.passedCount}/${report.totalGates} allPassed=${report.allPassed} lowSample=${report.lowSample}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
