/**
 * 내부자·대량보유 지분변동 수동 수집 스크립트 (DAR-87).
 *
 * 실행: npx ts-node -r dotenv/config src/engine1-disclosure/insider-holdings/collect-insider-holdings.manual.ts [limit] [corpCode...]
 *   예(우선종목 50개): ... collect-insider-holdings.manual.ts 50
 *   예(특정 종목):     ... collect-insider-holdings.manual.ts 0 00126380 00164779
 *
 * DART majorstock/elestock 정형 엔드포인트를 InsiderHoldingChange에 멱등 적재한다.
 * DART_API_KEY 미설정 시 graceful 종료. AI 미개입 — 순수 Rule 데이터 수집.
 *
 * ⚠️ DB 반영(마이그레이션 적용)과 실수집 실행은 사용자 승인 사항.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { InsiderHoldingsService } from './insider-holdings.service';

async function main(): Promise<void> {
  const logger = new Logger('CollectInsiderHoldingsManual');
  const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
  const limit = limitArg && limitArg > 0 ? limitArg : undefined;
  const corpCodes = process.argv.slice(3).filter(Boolean);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(InsiderHoldingsService);
    const result = await service.collectBatch({
      limit,
      corpCodes: corpCodes.length > 0 ? corpCodes : undefined,
      triggeredBy: 'MANUAL',
    });
    logger.log(`지분변동 수집 결과: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
