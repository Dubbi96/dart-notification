/**
 * ETF 과거 일봉 백필 수동 러너 (DAR-490 [견고화 W1·P11]).
 *
 *   npx ts-node -r dotenv/config .../etf-daily-backfill.manual.ts [minStartYmd] [endYmd]
 *   예: ... 20200101            → 2020-01-01 하한부터 오늘까지 가능한 최장(유니버스 4종)
 *   예: ... 20200101 20260630   → 2020-01-01 ~ 2026-06-30
 *   예: report                  → 적재 없이 현재 커버리지 리포트만 출력
 *
 * KIS 기간별시세(FHKST03010100)를 날짜 구간 페이지네이션으로 반복 호출해 유니버스 과거 일봉을
 * EtfDailyPrice 에 멱등 적재하고(손상행 배제), 창별 KIS 원본 응답을 S3(객체 스토리지)에 콜드 보관한다.
 * 백필 후 종목별 시작일·행수·갭(누락 거래일 추정)을 커버리지 리포트로 출력한다(P16 게이트 근거).
 *
 * ★KIS 키 미설정 시 적재 0(실호출 0) — 기존 DB 로 커버리지만 출력. AI 미개입·읽기 전용 시세.
 * ★상시 크론 아님(일일 증분은 P10 EtfDailyPriceCollector 크론이 담당). 재실행 안전(멱등).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { EtfDailyBackfillService } from './etf-daily-backfill.service';

async function main(): Promise<void> {
  const logger = new Logger('DAR490EtfDailyBackfill');
  const reportOnly = process.argv[2] === 'report';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(EtfDailyBackfillService);

    if (reportOnly) {
      const coverage = await service.coverageReport();
      logger.log(`[ETF백필] 커버리지 리포트:\n${JSON.stringify(coverage, null, 2)}`);
      return;
    }

    const minStartYmd = process.argv[2] || undefined;
    const endYmd = process.argv[3] || undefined;
    const result = await service.backfill({ minStartYmd, endYmd });
    logger.log(`[ETF백필] 결과:\n${JSON.stringify(result, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[DAR490EtfDailyBackfill] 실패:', err);
    process.exit(1);
  });
