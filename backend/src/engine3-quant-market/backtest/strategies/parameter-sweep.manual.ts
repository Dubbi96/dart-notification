/**
 * 전략 파라미터 민감도 스윕 수동 스크립트 (DAR-485, 견고화 W3·P24).
 *
 * 실행:
 *   npx ts-node -r dotenv/config \
 *     src/engine3-quant-market/backtest/strategies/parameter-sweep.manual.ts \
 *     <presetKey> <startDate:YYYY-MM-DD> <endDate:YYYY-MM-DD>
 *   예) ... parameter-sweep.manual.ts conservative-value 2025-06-19 2026-06-19
 *
 * 프리셋 파라미터 이웃값 그리드(손절 ±2%p·익절 ±5%p·보유일 ±5일·minBuyScore ±5)를 러너 재사용
 * point-in-time 리플레이로 실행 → 이웃 대비 성과 안정성 리포트를 출력한다.
 *
 * ★ read-only — BacktestRun/Trade 영속 0. 운용·측정 트랙 무접촉.
 * ★★ AI 자동 파라미터 조정 금지 — 측정·리포트만. 반영은 docs/trading/strategy-rulebook.md §8 변경 절차로만.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { ParameterSweepService } from './parameter-sweep.service';
import { STRATEGY_KEYS } from './strategy-presets';
import { SWEEP_VERDICT_LABEL } from './parameter-sweep';

async function main(): Promise<void> {
  const logger = new Logger('ParameterSweepManual');
  const [presetKey, startDate, endDate] = process.argv.slice(2);

  if (!presetKey || !startDate || !endDate) {
    logger.error(
      `인자 부족. 사용법: <presetKey> <startDate> <endDate> (키: ${STRATEGY_KEYS.join(' | ')})`,
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(ParameterSweepService);
    const report = await service.run({ presetKey, startDate, endDate });

    logger.log(
      `프리셋=[${report.presetLabel}] overall=${report.overallVerdict}(${SWEEP_VERDICT_LABEL[report.overallVerdict]}) · baseline 거래 ${report.baselineTrades}건 · 최민감축=${report.mostSensitiveAxisKey ?? '-'}`,
    );
    logger.log(`baseline 성과: ${JSON.stringify(report.baseline)}`);
    for (const axis of report.axes) {
      logger.log(
        `축[${axis.axisLabel} ±${axis.step}${axis.unit}] ${axis.verdict} · ` +
          `1차변동 ${axis.primaryAbsSwing?.toFixed(2) ?? '-'}%p(상대 ${axis.primaryRelSwing?.toFixed(2) ?? '-'}) · ` +
          `부호뒤집힘=${axis.signFlip}`,
      );
    }
    // 전체 상세(지표별 표)는 JSON 으로.
    logger.log(`상세 리포트:\n${JSON.stringify(report, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[ParameterSweepManual] 실패:', err);
    process.exit(1);
  });
