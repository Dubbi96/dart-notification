/**
 * 재무지표 분기 시계열 백필 수동 스크립트 (DAR-55).
 *
 * 실행:
 *   npx ts-node -r dotenv/config src/engine1-disclosure/financials/backfill-financials.manual.ts [bsnsYears] [scope] [limit] [fsDiv]
 *   예(우선종목 2개연도 분기 전체): ... backfill-financials.manual.ts 2024,2023 PRIORITY
 *   예(전종목 1개연도):            ... backfill-financials.manual.ts 2024 ALL
 *
 * reprtCode 11011~11014(사업·반기·1Q·3Q) 전체를 bsnsYears × 종목으로 멱등 적재한다.
 * 자연키(corpCode+기간+보고서)라 재실행 무손상. scope:'ALL' 은 캡 해제 전종목 순회 — 대량 호출.
 * DART_API_KEY 미설정 시 graceful 종료. AI 미개입 — 순수 재무데이터 수집.
 *
 * ⚠️ 대량 DART 라이브 호출(연도×보고서×종목)은 시간 소요 — 실수집 실행은 사용자 승인 사항.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { FinancialCollectionService } from './financial-collection.service';
import { DartFsDiv } from '../dart-api/dart-api.service';

async function main(): Promise<void> {
  const bsnsYears = (process.argv[2] || String(new Date().getFullYear() - 1))
    .split(',')
    .map((y) => y.trim())
    .filter(Boolean);
  const scope = (process.argv[3] as 'PRIORITY' | 'ALL') || 'PRIORITY';
  const limit = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;
  const fsDiv = (process.argv[5] as DartFsDiv) || undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const service = app.get(FinancialCollectionService);
    const result = await service.backfillTimeSeries({
      bsnsYears,
      scope,
      limit,
      fsDiv,
      triggeredBy: 'MANUAL',
    });
    // logger.log 은 warn/error 레벨에서 억제되므로 console.log 로 결과 출력
    // eslint-disable-next-line no-console
    console.log(
      `[BackfillFinancialsManual] 결과: ${JSON.stringify(
        {
          periods: result.periods,
          totalSaved: result.totalSaved,
          totalSkipped: result.totalSkipped,
          totalFailed: result.totalFailed,
        },
        null,
        2,
      )}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[BackfillFinancialsManual] 실패:', err);
    process.exit(1);
  });
