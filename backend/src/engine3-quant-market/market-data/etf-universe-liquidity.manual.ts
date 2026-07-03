/**
 * DAR-484 유니버스 유동성 확정 수동 러너 — ETF 유니버스 각 종목의 라이브 유동성을 KIS 로 재확인한다.
 *
 *   npx ts-node -r dotenv/config .../etf-universe-liquidity.manual.ts [lookbackDays]
 *
 * 배경(정직 고지): ETF 유니버스(etf-universe.ts)의 채권·단기채 코드는 도메인 지식으로 1차 확정했다.
 * '일평균 거래대금 최상위' 라이브 재확인은 Wave 완료 후 **가동 시점의 게이트**이며(배포 정책: 프로드
 * 가동 전제 검증은 구현 이슈 범위 밖), 운영자가 이 러너로 확정한다. 각 유니버스 종목의 최근 N일 일봉을
 * KIS 기간별시세로 받아 **일평균 거래대금(원)**·거래일수를 출력한다. 결과가 상위 유동성 종목과 어긋나면
 * etf-universe.ts 의 code/name/basis 를 교체하고 근거를 주석에 남긴다(무레버리지 원칙 유지).
 *
 * ★KIS 키 미설정 시 소스 비활성으로 각 종목이 빈 결과가 된다(실호출 0). AI 미개입·읽기 전용 시세.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { KisEtfDailySource } from './kis-etf-daily.source';
import { ETF_UNIVERSE } from './etf-universe';
import { formatKstDateCompact } from '../../common/time/kst';

async function main(): Promise<void> {
  const logger = new Logger('DAR484EtfUniverseLiquidity');
  const lookbackDays = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 30;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const source = app.get(KisEtfDailySource);
    if (!source.isAvailable()) {
      logger.warn('[유동성확인] KIS 소스 비활성(키 미설정) — 실호출 0. .env 주입 후 재실행하라.');
      return;
    }

    const now = new Date();
    const endYmd = formatKstDateCompact(now);
    const startYmd = formatKstDateCompact(new Date(now.getTime() - lookbackDays * 86_400_000));
    logger.log(`[유동성확인] 구간=${startYmd}~${endYmd} 유니버스=${ETF_UNIVERSE.length}종`);

    for (const e of ETF_UNIVERSE) {
      const bars = await source.fetchDailyBars(e.code, { startYmd, endYmd });
      const days = bars.length;
      const avgTradingValue =
        days > 0 ? Math.round(bars.reduce((s, b) => s + b.tradingValue, 0) / days) : 0;
      logger.log(
        `[${e.role}] ${e.code} ${e.name} — 거래일=${days}, 일평균거래대금=${avgTradingValue.toLocaleString()}원`,
      );
    }
    logger.log('[유동성확인] 완료 — 상위 유동성과 어긋나면 etf-universe.ts 코드 교체(근거 주석).');
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[DAR484EtfUniverseLiquidity] 실패:', err);
    process.exit(1);
  });
