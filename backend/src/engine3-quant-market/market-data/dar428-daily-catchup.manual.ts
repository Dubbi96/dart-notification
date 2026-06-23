/**
 * DAR-428 검증/백필 수동 러너 — EOD 일봉 전진수집 cron 의 실제 본문을 1회 실행한다.
 *
 *   npx ts-node -r dotenv/config .../dar428-daily-catchup.manual.ts
 *
 * `collectDailyPrices()`(= @Cron 30 18 본문)를 직접 호출해:
 *   1) 마지막 적재일(6/18)~최신 가용일(KRX 프로브) 갭(6/19·6/22)을 멱등 백필하고,
 *   2) CronRunLog(market.daily-collect)에 실행 헬스를 남긴다(DAR-428 신규 래핑).
 * 운영 cron 과 동일 코드 경로 — 백필과 동작재현을 한 번에 충족한다. AI 미개입.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { PrismaService } from '../../prisma/prisma.service';

async function main(): Promise<void> {
  const logger = new Logger('DAR428DailyCatchup');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const scheduler = app.get(KrxMarketDataScheduler);
    const prisma = app.get(PrismaService);

    const before = await prisma.stockDailyPrice.aggregate({ _max: { tradeDate: true } });
    logger.log(`[before] daily_max=${before._max.tradeDate}`);

    const result = await scheduler.collectDailyPrices();
    logger.log(`[catchup] ${JSON.stringify(result)}`);

    const after = await prisma.stockDailyPrice.aggregate({ _max: { tradeDate: true } });
    logger.log(`[after] daily_max=${after._max.tradeDate}`);

    const lastRun = await prisma.cronRunLog.findFirst({
      where: { jobKey: 'market.daily-collect' },
      orderBy: { startedAt: 'desc' },
    });
    logger.log(`[cronRunLog] ${JSON.stringify(lastRun)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[DAR428DailyCatchup] 실패:', err);
    process.exit(1);
  });
