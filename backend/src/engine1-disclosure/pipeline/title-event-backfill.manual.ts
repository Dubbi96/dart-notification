/**
 * 제목 기반 과거 공시 이벤트 백필 수동 스크립트 (W4 신호 검증).
 *
 * 목적: 연속 백필로 적재된 과거 공시(1999~) 중 DisclosureEvent 가 없는 행을 라이브와
 *   동일한 제목 분류 룰(classifyByReportName, confidence ≥ 0.85)로 분류해 이벤트를
 *   생성한다 — Event Study 관측치 확장(n≈1,093 → 수만)의 직접 레버.
 *
 * ★ DART 쿼터 소비 0 — 문서 fetch·파싱 트리거 없음(DB read + createMany 만).
 * ★ 멱등 — 이벤트 기존재 시 스킵(disclosureEvent is null 술어) + skipDuplicates.
 *
 * 실행:
 *   npm run backfill:title-events                          # 기본(스캔 200,000)
 *   npm run backfill:title-events -- 50000                 # 스캔 상한 지정
 *   npm run backfill:title-events -- 50000 20180101 X123   # 커서(rcpDt, rcpNo) 이후 재개
 *   (동일 경로: npx ts-node -r dotenv/config src/engine1-disclosure/pipeline/title-event-backfill.manual.ts)
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { TitleEventBackfillService } from './title-event-backfill.service';

async function main(): Promise<void> {
  const logger = new Logger('TitleEventBackfillManual');
  const [scanLimitRaw, startAfterRcpDt, startAfterRcpNo] = process.argv.slice(2);
  const scanLimit = scanLimitRaw ? Number.parseInt(scanLimitRaw, 10) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(TitleEventBackfillService);

    const before = await service.getProgress();
    logger.log(`시작 전 진행: ${JSON.stringify(before)}`);

    const result = await service.backfillOnce({
      scanLimit: Number.isFinite(scanLimit) ? scanLimit : undefined,
      startAfterRcpDt,
      startAfterRcpNo,
    });
    logger.log(`백필 결과: ${JSON.stringify(result)}`);

    const after = await service.getProgress();
    logger.log(`종료 후 진행: ${JSON.stringify(after)}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
