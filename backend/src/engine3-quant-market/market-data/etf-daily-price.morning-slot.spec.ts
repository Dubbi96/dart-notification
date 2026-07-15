/**
 * etf-daily-price.morning-slot.spec.ts — ETF 일봉 이른 아침 수집 슬롯 (데이터 축적 T+1 지연 해소).
 *
 * 검증(실 DB·네트워크 없음): 08:00 아침 크론 존재·KST 발화, 기존 19:10 EOD 경로
 *   (collectEtfDailyPricesCron·SSOT) 재호출(새 수집 로직 없음), 단일 실행 락 재사용.
 */

import 'reflect-metadata';

import { EtfDailyPriceCollector } from './etf-daily-price.collector';
import { KisEtfDailySource } from './kis-etf-daily.source';
import { PrismaService } from '../../prisma/prisma.service';

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

function cronOpts(method: string): { cronTime?: unknown; timeZone?: unknown } | undefined {
  const fn = (EtfDailyPriceCollector.prototype as unknown as Record<string, unknown>)[method];
  return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn as object) as
    | { cronTime?: unknown; timeZone?: unknown }
    | undefined;
}

function makeCollector(): EtfDailyPriceCollector {
  const prisma = {
    etfDailyPrice: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaService;
  const source = {
    sourceName: 'KIS',
    isAvailable: () => false, // 소스 비활성 → graceful no-op(경로 위임만 검증)
    fetchDailyBars: jest.fn().mockResolvedValue([]),
  } as unknown as KisEtfDailySource;
  return new EtfDailyPriceCollector(prisma, source);
}

describe('EtfDailyPriceCollector — 이른 아침 수집 슬롯', () => {
  it('collectEtfDailyPricesMorningCron 은 08:00 (KST) 로 발화', () => {
    const opts = cronOpts('collectEtfDailyPricesMorningCron');
    expect(opts).toBeDefined();
    expect(opts?.cronTime).toBe('0 8 * * 1-5');
    expect(opts?.timeZone).toBe('Asia/Seoul');
  });

  it('아침 슬롯은 기존 19:10 EOD 경로(collectEtfDailyPricesCron)를 재호출한다(SSOT)', async () => {
    const collector = makeCollector();
    const spy = jest
      .spyOn(collector, 'collectEtfDailyPricesCron')
      .mockResolvedValue({ skipped: true });

    const now = new Date('2026-07-08T08:00:00+09:00');
    await collector.collectEtfDailyPricesMorningCron(now);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(now);
  });

  it('단일 실행 락 — 진행 중이면 아침 슬롯도 이번 회차 skip', async () => {
    const collector = makeCollector();
    (collector as unknown as { isCollecting: boolean }).isCollecting = true;

    const r = await collector.collectEtfDailyPricesMorningCron(
      new Date('2026-07-08T08:00:00+09:00'),
    );

    expect(r).toEqual({ skipped: true });
  });
});
