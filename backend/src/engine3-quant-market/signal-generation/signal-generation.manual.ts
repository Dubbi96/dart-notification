/**
 * 수동 1회 신호 생성 스크립트 — DAR-41 DoD 증거용.
 *
 * 실행: npx ts-node -r dotenv/config src/engine3-quant-market/signal-generation/signal-generation.manual.ts
 * 또는: npx ts-node src/engine3-quant-market/signal-generation/signal-generation.manual.ts
 *
 * AI 미개입 — 순수 Rule BuyScore → TradingSignal persist.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SignalGenerationService } from './signal-generation.service';

async function main(): Promise<void> {
  const logger = new Logger('SignalGenManual');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(SignalGenerationService);
    const result = await service.generateMissingSignals('MANUAL');
    logger.log(`결과: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[SignalGenManual] 실패:', err);
    process.exit(1);
  });
