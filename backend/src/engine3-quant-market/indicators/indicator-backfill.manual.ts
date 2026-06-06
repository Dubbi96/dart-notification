/**
 * 기술지표 백필 수동 스크립트 (DAR-50).
 *
 * 실행: npx ts-node -r dotenv/config src/engine3-quant-market/indicators/indicator-backfill.manual.ts [latest|all]
 *
 * DB 일봉(StockDailyPrice) → 순수함수 지표 계산 → technical_indicators 멱등 적재.
 * AI 미개입 — 순수 Rule 지표 계산.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { IndicatorBackfillService } from './indicator-backfill.service';

async function main(): Promise<void> {
  const logger = new Logger('IndicatorBackfillManual');
  const mode = process.argv[2] === 'all' ? 'all' : 'latest';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(IndicatorBackfillService);
    const result = await service.backfill({ mode });
    logger.log(
      `지표 백필 결과: ${JSON.stringify({ ...result, targetDates: result.targetDates.length }, null, 2)}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[IndicatorBackfillManual] 실패:', err);
    process.exit(1);
  });
