/**
 * 백테스트 러너 11년 완주 수동 스크립트 (DAR-544, 데이터게이트 §2).
 *
 * 실행:
 *   npx ts-node -r dotenv/config \
 *     src/engine3-quant-market/backtest/replay/extended-window-replay.manual.ts \
 *     [startYear=2015] [endYear=2026] [chunkYears=1]
 *   예) ... extended-window-replay.manual.ts 2015 2026 1     # 연 단위 청크 완주
 *   예) ... extended-window-replay.manual.ts 2015 2026 99    # 단일 11년 패스(MONOLITHIC)
 *
 * 확장 창을 청크로 완주시키고 청크별 완주 로그(신호·거래·성과·경과·캐시통계)를 출력한다.
 *
 * ★ read-only — BacktestRun/PaperTrade 영속 0(M10 무접촉). 측정 인프라만 — 전략 파라미터 무변경.
 * ★ 청크 경계 강제청산 → 청크별 성과 합 ≠ 단일 11년창 성과(완주·성능 프로브). §8.4 준수.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import {
  ExtendedWindowReplayService,
  DEFAULT_EXTENDED_START_YEAR,
  DEFAULT_EXTENDED_END_YEAR,
} from './extended-window-replay.service';

async function main(): Promise<void> {
  const logger = new Logger('ExtendedWindowReplayManual');
  const [startArg, endArg, chunkArg] = process.argv.slice(2);
  const startYear = startArg ? Number(startArg) : DEFAULT_EXTENDED_START_YEAR;
  const endYear = endArg ? Number(endArg) : DEFAULT_EXTENDED_END_YEAR;
  const chunkYears = chunkArg ? Number(chunkArg) : 1;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(ExtendedWindowReplayService);
    const report = await service.run({ startYear, endYear, chunkYears });

    logger.log(
      `11년 러너 완주=${report.completed} · 창 ${report.window.startDate}~${report.window.endDate} · mode=${report.mode} · 청크 ${report.totals.chunks}개`,
    );
    logger.log(
      `총 신호 ${report.totals.signals} · 총 거래 ${report.totals.trades} · 총 경과 ${report.totals.elapsedMs}ms`,
    );
    for (const c of report.chunks) {
      logger.log(
        `청크 ${c.startDate}~${c.endDate}: 신호 ${c.signals} → 거래 ${c.trades} · 수익률 ${c.totalReturnPct.toFixed(2)}% · 승률 ${c.winRatePct.toFixed(1)}% · ${c.elapsedMs}ms · 적재 ${c.priceLoads}종목`,
      );
    }
    for (const note of report.notes) logger.log(`※ ${note}`);
    logger.log(`상세 리포트:\n${JSON.stringify(report, null, 2)}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[ExtendedWindowReplayManual] 실패:', err);
    process.exit(1);
  });
