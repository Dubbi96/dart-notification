/**
 * 2단 프레임 백테스트 엣지 게이트 수동 스크립트 (DAR-493, 견고화 W1·P16).
 *
 * 실행:
 *   npx ts-node -r dotenv/config \
 *     src/engine3-quant-market/two-tier-backtest/two-tier-backtest.manual.ts \
 *     [startDate:YYYYMMDD] [endDate:YYYYMMDD]
 *   예) ... two-tier-backtest.manual.ts 20200801 20260703
 *
 * EtfDailyPrice(P10/P11) → 코어 듀얼모멘텀·위성 변동성돌파 비용 반영 백테스트 → 엣지 게이트 리포트.
 * dev DB 에 ETF 일봉 백필이 되어 있어야 report 산출(부족 시 커버리지만 출력).
 *
 * ★ read-only — BacktestRun/Trade 영속 0. 운용·측정 트랙 무접촉.
 * ★★ 게이트 불합격 시 AI 자동 파라미터 조정 금지 — 반영은 docs/trading/strategy-rulebook.md §8 절차로만.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { TwoTierBacktestService } from './two-tier-backtest.service';

async function main(): Promise<void> {
  const logger = new Logger('TwoTierGateManual');
  const [startDate, endDate] = process.argv.slice(2);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(TwoTierBacktestService);
    const result = await service.runGateReport({ startDate, endDate });

    logger.log(`커버리지: ${JSON.stringify(result.coverage)}`);
    logger.log(`note: ${result.note}`);
    if (result.report) {
      const { core, satellite, overallEdgePositive } = result.report;
      logger.log(
        `코어[${core.styleTag}] ${core.verdict} · totalReturn ${core.totalReturnPct.toFixed(2)}% · ` +
          `승률 ${core.winRatePct.toFixed(1)}% · PF ${core.profitFactor.toFixed(2)} · MDD ${core.mddPct.toFixed(2)}% · 표본 ${core.totalTrades}`,
      );
      logger.log(
        `위성[${satellite.styleTag}] ${satellite.verdict} · totalReturn ${satellite.totalReturnPct.toFixed(2)}% · ` +
          `승률 ${satellite.winRatePct.toFixed(1)}% · PF ${satellite.profitFactor.toFixed(2)} · MDD ${satellite.mddPct.toFixed(2)}% · 표본 ${satellite.totalTrades}`,
      );
      logger.log(`overall 엣지 양수 = ${overallEdgePositive}`);
      logger.log(`상세 리포트:\n${JSON.stringify(result.report, null, 2)}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
