/**
 * 재무지표 수집 수동 스크립트 (DAR-52).
 *
 * 실행: npx ts-node -r dotenv/config src/engine1-disclosure/financials/collect-financials.manual.ts [bsnsYear] [reprtCode] [fsDiv] [limit]
 *   예: npx ts-node -r dotenv/config src/engine1-disclosure/financials/collect-financials.manual.ts 2024 11011 CFS 50
 *
 * 우선 신호/이벤트 보유 종목의 DART 재무제표를 CompanyFinancial 에 멱등 적재한다.
 * DART_API_KEY 미설정 시 graceful 종료. AI 미개입 — 순수 재무데이터 수집.
 *
 * ⚠️ DB 반영(마이그레이션 적용)과 실수집 실행은 사용자 승인 사항.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { FinancialCollectionService } from './financial-collection.service';
import { DartReportCode, DartFsDiv } from '../dart-api/dart-api.service';

async function main(): Promise<void> {
  const logger = new Logger('CollectFinancialsManual');
  const bsnsYear = process.argv[2] || String(new Date().getFullYear() - 1);
  const reprtCode = (process.argv[3] as DartReportCode) || undefined;
  const fsDiv = (process.argv[4] as DartFsDiv) || undefined;
  const limit = process.argv[5] ? parseInt(process.argv[5], 10) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(FinancialCollectionService);
    const result = await service.collectBatch({
      bsnsYear,
      reprtCode,
      fsDiv,
      limit,
      triggeredBy: 'MANUAL',
    });
    logger.log(`재무지표 수집 결과: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[CollectFinancialsManual] 실패:', err);
    process.exit(1);
  });
