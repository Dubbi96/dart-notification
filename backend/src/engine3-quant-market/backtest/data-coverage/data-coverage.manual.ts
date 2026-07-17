/**
 * 백테스트 검증 창(11년) 데이터 커버리지 감사 수동 스크립트 (DAR-544).
 *
 * 실행:
 *   npx ts-node -r dotenv/config \
 *     src/engine3-quant-market/backtest/data-coverage/data-coverage.manual.ts \
 *     [startYear=2015] [endYear=2026]
 *
 * 연도별 가격(stock_daily_prices)·공시(disclosures) 커버리지 + 11년 게이트 준비도를 출력한다.
 *
 * ★ read-only — 어떤 테이블에도 쓰지 않는다(BacktestRun/PaperTrade 영속 0, M10 무접촉).
 * ★ 측정 인프라만 — 결과의 코드 반영은 docs/trading/strategy-rulebook.md §8 변경 절차로만(§8.4).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import {
  DataCoverageService,
  DEFAULT_COVERAGE_START_YEAR,
  DEFAULT_COVERAGE_END_YEAR,
} from './data-coverage.service';

async function main(): Promise<void> {
  const logger = new Logger('DataCoverageManual');
  const [startArg, endArg] = process.argv.slice(2);
  const startYear = startArg ? Number(startArg) : DEFAULT_COVERAGE_START_YEAR;
  const endYear = endArg ? Number(endArg) : DEFAULT_COVERAGE_END_YEAR;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(DataCoverageService);
    const report = await service.audit({ startYear, endYear });

    logger.log(
      `커버리지 감사 ${report.window.startYear}~${report.window.endYear} → 판정=${report.summary.verdict} (gateReady=${report.summary.gateReady})`,
    );
    logger.log(
      `총 가격 ${report.summary.totalPriceRows.toLocaleString()}행 · 총 공시 ${report.summary.totalDisclosureRows.toLocaleString()}행 · 결측=[${report.summary.missingYears.join(',') || '-'}] · 부분=[${report.summary.partialYears.join(',') || '-'}]`,
    );
    logger.log('── 연도별 커버리지 ──');
    for (const y of report.years) {
      const pct = y.price.coveragePct === null ? '-' : `${y.price.coveragePct}%${y.price.coveragePctReliable ? '' : '~'}`;
      logger.log(
        `${y.year} [${y.status}]${y.isFullYear ? '' : '(부분)'} 가격 ${y.price.rows.toLocaleString()}행 · 거래일 ${y.price.tradingDays}/${y.price.expectedTradingDays}(${pct}) · 종목 ${y.price.distinctStocks} | 공시 ${y.disclosure.rows.toLocaleString()}행 · 기업 ${y.disclosure.distinctCorps}`,
      );
    }
    for (const note of report.summary.notes) logger.log(`※ ${note}`);
    logger.log(`상세 리포트:\n${JSON.stringify(report, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[DataCoverageManual] 실패:', err);
    process.exit(1);
  });
