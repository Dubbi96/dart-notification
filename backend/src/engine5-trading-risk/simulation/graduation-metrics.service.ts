// 졸업지표 조회 서비스 (M10, DAR-40)
// G1 적중률·G2 누적수익·G3 AI비용/순익·G5 Exit정확도를 누적 데이터로 산출.
// AI 금지영역: 집계만 수행. AI 개입 0.

import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_SIMULATION_CONFIG,
  SimulationConfig,
} from './domain/simulation.config';
import {
  AiCostEfficiencyResult,
  CumulativeReturnResult,
  ExitAccuracyResult,
  HitRateResult,
  calcAiCostEfficiency,
  calcCumulativeReturn,
  calcExitAccuracy,
  calcHitRate,
} from './domain/graduation-metrics.calculator';
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

    const [state, hitSamples, exitSamples, aiCostKrw] = await Promise.all([
      this.port.getCumulativeState(portfolioId),
      this.port.getHitRateSamples(portfolioId, config.hitRateHorizonDays),
      this.port.getExitAccuracySamples(
        portfolioId,
        config.exitAccuracyHorizonDays,
      ),
      this.port.getAiCostKrw(config.usdKrwRate),
    ]);

    return {
      portfolioId,
      asOf: new Date().toISOString(),
      hitRate: calcHitRate(hitSamples),
      cumulativeReturn: calcCumulativeReturn(
        state.initialCapital,
        state.currentValue,
      ),
      aiCostEfficiency: calcAiCostEfficiency(aiCostKrw, state.netPnlKrw),
      exitAccuracy: calcExitAccuracy(exitSamples),
      config: {
        hitRateHorizonDays: config.hitRateHorizonDays,
        exitAccuracyHorizonDays: config.exitAccuracyHorizonDays,
        usdKrwRate: config.usdKrwRate,
      },
    };
  }
}
