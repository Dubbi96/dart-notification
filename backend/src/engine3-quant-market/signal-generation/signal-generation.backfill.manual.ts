/**
 * 과거 공시 point-in-time 신호 백필 1회 실행 스크립트 — DAR-389 운영 증거용.
 *
 * 실행:
 *   npx ts-node -r dotenv/config \
 *     src/engine3-quant-market/signal-generation/signal-generation.backfill.manual.ts
 *
 * 환경변수 옵션(전부 선택):
 *   BACKFILL_START_RCPDT=YYYYMMDD   처리 하한(포함)
 *   BACKFILL_END_RCPDT=YYYYMMDD     처리 상한(포함)
 *   BACKFILL_BATCH_SIZE=500         배치당 이벤트 수
 *   BACKFILL_THROTTLE_MS=0          배치 간 지연(ms)
 *   BACKFILL_MAX_EVENTS=            경계 실행용 최대 이벤트 수
 *   BACKFILL_OVERWRITE=false        기존 신호 재채점 여부
 *
 * ★엄격 point-in-time: 가격·지표·지수는 공시일(rcpDt)까지의 데이터로만 산출(as-of 절단).
 * ★AI 미개입 — 순수 Rule BuyScore → TradingSignal persist. 통지 enqueue 없음.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import {
  BackfillSignalOptions,
  SignalGenerationService,
} from './signal-generation.service';

function envNum(key: string): number | undefined {
  const v = process.env[key];
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  const logger = new Logger('SignalGenBackfillManual');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(SignalGenerationService);
    const options: BackfillSignalOptions = {
      startRcpDt: process.env.BACKFILL_START_RCPDT || undefined,
      endRcpDt: process.env.BACKFILL_END_RCPDT || undefined,
      batchSize: envNum('BACKFILL_BATCH_SIZE'),
      throttleMs: envNum('BACKFILL_THROTTLE_MS'),
      maxEvents: envNum('BACKFILL_MAX_EVENTS'),
      overwrite: process.env.BACKFILL_OVERWRITE === 'true',
    };
    logger.log(`옵션: ${JSON.stringify(options)}`);
    const result = await service.generateBackfillSignals(options);
    logger.log(`결과: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[SignalGenBackfillManual] 실패:', err);
    process.exit(1);
  });
