// 졸업지표 조회 서비스 (M10, DAR-40 / DAR-68)
// G1 적중률·G2 누적수익·G3 AI비용/순익·G5 Exit정확도를 누적 데이터로 산출.
// DAR-68: 위험조정(Sharpe·MDD)·벤치마크 초과수익(vs KOSPI alpha) 추가 산출.
// AI 금지영역: 집계만 수행. AI 개입 0.

import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_SIMULATION_CONFIG,
  SimulationConfig,
} from './domain/simulation.config';
import {
  AiCostEfficiencyResult,
  BenchmarkAlphaResult,
  CumulativeReturnResult,
  ExitAccuracyResult,
  HitRateResult,
  RiskAdjustedResult,
  calcAiCostEfficiency,
  calcBenchmarkAlpha,
  calcCumulativeReturn,
  calcExitAccuracy,
  calcHitRate,
  calcRiskAdjusted,
} from './domain/graduation-metrics.calculator';
import { GRADUATION_BENCHMARK_INDEX_CODE } from './domain/graduation-gates';
import { ISimulationPort, SIMULATION_PORT } from './ports/simulation.port';

export interface GraduationMetrics {
  portfolioId: string;
  asOf: string; // ISO
  /** G1 적중률 (D+5) */
  hitRate: HitRateResult;
  /** G2 누적 수익률 */
  cumulativeReturn: CumulativeReturnResult;
  /** G3 AI비용/순익 */
  aiCostEfficiency: AiCostEfficiencyResult;
  /** G5 Exit 정확도 (D+3) */
  exitAccuracy: ExitAccuracyResult;
  /** 위험조정 지표(Sharpe·MDD) — DAR-68 */
  riskAdjusted: RiskAdjustedResult;
  /** 벤치마크(KOSPI) 대비 초과수익(alpha) — DAR-68 */
  benchmarkAlpha: BenchmarkAlphaResult;
  config: {
    hitRateHorizonDays: number;
    exitAccuracyHorizonDays: number;
    usdKrwRate: number;
  };
}

@Injectable()
export class GraduationMetricsService {
  constructor(@Inject(SIMULATION_PORT) private readonly port: ISimulationPort) {}

  async getMetrics(
    portfolioIdArg?: string,
    config: SimulationConfig = DEFAULT_SIMULATION_CONFIG,
  ): Promise<GraduationMetrics> {
    const portfolioId =
      portfolioIdArg ?? (await this.port.resolveSimPortfolioId());

    const [state, hitSamples, exitSamples, aiCostKrw, equityCurve] =
      await Promise.all([
        this.port.getCumulativeState(portfolioId),
        this.port.getHitRateSamples(portfolioId, config.hitRateHorizonDays),
        this.port.getExitAccuracySamples(
          portfolioId,
          config.exitAccuracyHorizonDays,
        ),
        this.port.getAiCostKrw(config.usdKrwRate),
        this.port.getEquityCurve(portfolioId),
      ]);

    const cumulativeReturn = calcCumulativeReturn(
      state.initialCapital,
      state.currentValue,
    );

    // 벤치마크 alpha — 운용 기간(평가액 시계열 시작~끝)의 시장지수 수익률과 비교.
    // 평가액 스냅샷이 없으면 기간을 특정할 수 없으므로 벤치마크 조회를 생략한다(측정 불가).
    const sortedEquity = [...equityCurve].sort((a, b) =>
      a.snapshotDate < b.snapshotDate ? -1 : a.snapshotDate > b.snapshotDate ? 1 : 0,
    );
    const benchmarkSeries =
      sortedEquity.length >= 2
        ? await this.port.getBenchmarkSeries(
            GRADUATION_BENCHMARK_INDEX_CODE,
            sortedEquity[0].snapshotDate,
            sortedEquity[sortedEquity.length - 1].snapshotDate,
          )
        : [];

    return {
      portfolioId,
      asOf: new Date().toISOString(),
      hitRate: calcHitRate(hitSamples),
      cumulativeReturn,
      aiCostEfficiency: calcAiCostEfficiency(aiCostKrw, state.netPnlKrw),
      exitAccuracy: calcExitAccuracy(exitSamples),
      riskAdjusted: calcRiskAdjusted(equityCurve),
      benchmarkAlpha: calcBenchmarkAlpha(
        GRADUATION_BENCHMARK_INDEX_CODE,
        cumulativeReturn.returnPct,
        benchmarkSeries,
      ),
      config: {
        hitRateHorizonDays: config.hitRateHorizonDays,
        exitAccuracyHorizonDays: config.exitAccuracyHorizonDays,
        usdKrwRate: config.usdKrwRate,
      },
    };
  }
}
