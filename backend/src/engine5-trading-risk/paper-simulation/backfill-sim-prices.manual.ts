/**
 * 모의운용 보유/후보 종목 실 KRX 일봉 백필 수동 스크립트 (DAR-137).
 *
 * 실행:
 *   npx ts-node -r dotenv/config \
 *     src/engine5-trading-risk/paper-simulation/backfill-sim-prices.manual.ts [days] [endDate]
 *   예: ... backfill-sim-prices.manual.ts 60 20251230
 *
 * 목적: 모의운용 유니버스(보유 OPEN + 진입 후보) 종목이 '실가격'으로 진입/Exit/스냅샷/스코어를
 *   평가할 수 있도록, 실 KRX 일봉 시계열을 StockDailyPrice 에 멱등 적재한다(실데이터).
 *
 * ★환경 시계가 미래(2026)라 실 KRX 는 2026 일봉이 없다 → endDate 는 '최신 가용 실데이터' 거래일이어야
 *   한다. 인자로 주면 그 날짜 기준, 없으면 DB 의 최신 StockDailyPrice.tradeDate(기존 실데이터 연장)를
 *   사용한다. 둘 다 없으면 환경 시계로 폴백하되 휴장(0행)만 반복될 수 있음을 경고한다.
 *
 * 적재 후 유니버스의 실데이터 커버리지를 출력한다 — 실가/합성 구분 점검(정직).
 *   하이브리드 모드(PAPER_SIM_REAL_FEED=1)에서 커버된 종목은 실가, 미커버 종목만 합성으로 폴백한다.
 *
 * 비고: KRX_API_KEY 미설정 시 백필은 graceful no-op(커버리지 리포트만). AI 미개입 — 순수 시세 수집.
 *   KRX 호출은 시장 전체 bulk(날짜당 1회)라 유니버스 종목은 자동 포함된다.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { KrxMarketDataScheduler } from '../../engine3-quant-market/market-data/krx-market-data.scheduler';
import { SimulationPriceSourceService } from './simulation-price-source.service';

/**
 * 적용할 endDate(최신 가용 실데이터 기준)를 결정한다.
 *   1) 명시 인자 우선
 *   2) DB 의 최신 StockDailyPrice.tradeDate(기존 실데이터 연장)
 *   3) 폴백: 환경 시계(today) — 미래라 휴장 반복 가능(경고)
 */
async function resolveEndDate(
  prisma: PrismaService,
  argEndDate: string | undefined,
  todayYmd: string,
): Promise<{ endDate: string; source: 'arg' | 'db-latest' | 'today-fallback' }> {
  if (argEndDate) return { endDate: argEndDate, source: 'arg' };
  const latest = await prisma.stockDailyPrice.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  if (latest) return { endDate: latest.tradeDate, source: 'db-latest' };
  return { endDate: todayYmd, source: 'today-fallback' };
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillSimPricesManual');
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 60;
  const argEndDate = process.argv[3] || undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const scheduler = app.get(KrxMarketDataScheduler);
    const priceSource = app.get(SimulationPriceSourceService);

    const todayYmd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { endDate, source } = await resolveEndDate(prisma, argEndDate, todayYmd);
    if (source === 'today-fallback') {
      logger.warn(
        `[DAR-137] endDate 미지정·DB 실데이터 없음 → 환경 시계(${endDate}) 폴백. ` +
          `미래 날짜면 KRX 가 휴장(0행)만 반환할 수 있음 — 최신 거래일을 인자로 지정 권장.`,
      );
    } else {
      logger.log(`[DAR-137] endDate=${endDate} (출처=${source}) 기준 과거 ${days}거래일 실 KRX 일봉 백필`);
    }

    const before = await priceSource.realCoverage(endDate);
    const result = await scheduler.backfillDailyPrices({ days, endDate });
    const after = await priceSource.realCoverage(endDate);

    logger.log(`[DAR-137] 백필 결과: ${JSON.stringify(result, null, 2)}`);
    logger.log(
      `[DAR-137] 모의 유니버스 실데이터 커버리지: ` +
        `${before.covered}/${before.total} → ${after.covered}/${after.total} ` +
        `(최신 실데이터 거래일=${after.latestRealDate ?? '없음'})`,
    );
    logger.log(
      `[DAR-137] ★정직: 위 'latestRealDate' 는 최신 가용 실데이터 기준 거래일이며 ` +
        `환경 시계(${todayYmd})와 다를 수 있다 — 2026 실시세로 오인 금지.`,
    );
    if (after.uncovered.length > 0) {
      logger.warn(
        `[DAR-137] 실데이터 미커버 ${after.uncovered.length}종목(하이브리드 모드 시 합성 폴백): ` +
          after.uncovered.map((u) => u.stockCode).join(', '),
      );
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[BackfillSimPricesManual] 실패:', err);
    process.exit(1);
  });
