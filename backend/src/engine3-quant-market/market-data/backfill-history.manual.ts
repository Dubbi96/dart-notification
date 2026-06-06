/**
 * 히스토리컬 일봉 백필 수동 스크립트 (DAR-50).
 *
 * 실행: npx ts-node -r dotenv/config src/engine3-quant-market/market-data/backfill-history.manual.ts [days] [endDate]
 *   예: npx ts-node -r dotenv/config src/engine3-quant-market/market-data/backfill-history.manual.ts 60 20260604
 *
 * 과거 N거래일(기본 60)의 KRX 일봉을 StockDailyPrice 에 멱등 적재한다.
 * KRX_API_KEY 미설정 시 graceful 리턴. AI 미개입 — 순수 시세 수집.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';

async function main(): Promise<void> {
  const logger = new Logger('BackfillHistoryManual');
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 60;
  const endDate = process.argv[3] || undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const scheduler = app.get(KrxMarketDataScheduler);
    const result = await scheduler.backfillDailyPrices({ days, endDate });
    logger.log(`백필 결과: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[BackfillHistoryManual] 실패:', err);
    process.exit(1);
  });
