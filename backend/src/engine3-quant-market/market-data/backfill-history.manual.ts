/**
 * 히스토리컬 일봉 백필 수동 스크립트 (DAR-50 → DAR-376 깊이/재개 모드).
 *
 * 고정구간:  npx ts-node -r dotenv/config .../backfill-history.manual.ts [days] [endDate]
 *   예: ... 60 20260604   (endDate 부터 과거 60거래일)
 * 깊이/재개:  npx ts-node -r dotenv/config .../backfill-history.manual.ts deep [days]
 *   예: ... deep 120       (가장 오래된 적재일부터 더 과거로 120거래일 — 반복 실행 시 점진 확장)
 *
 * 과거 거래일의 KRX 일봉을 StockDailyPrice 에 멱등 적재한다(품질 가드 적용).
 * KRX_API_KEY 미설정 시 graceful 리턴. AI 미개입 — 순수 시세 수집.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';

async function main(): Promise<void> {
  const logger = new Logger('BackfillHistoryManual');
  const deepMode = process.argv[2] === 'deep';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const scheduler = app.get(KrxMarketDataScheduler);
    if (deepMode) {
      // DAR-376: 가장 오래된 적재일부터 더 과거로 이어 수집(재개 가능). 반복 실행으로 점진 확장.
      const days = process.argv[3] ? parseInt(process.argv[3], 10) : 120;
      const result = await scheduler.backfillDailyHistoryDeep({ days });
      logger.log(`깊이 백필 결과: ${JSON.stringify(result, null, 2)}`);
    } else {
      const days = process.argv[2] ? parseInt(process.argv[2], 10) : 60;
      const endDate = process.argv[3] || undefined;
      const result = await scheduler.backfillDailyPrices({ days, endDate });
      logger.log(`백필 결과: ${JSON.stringify(result, null, 2)}`);
    }
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
