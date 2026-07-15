/**
 * krx-market-data.morning-slots.spec.ts — 이른 아침 수집 슬롯 (데이터 축적 T+1 지연 해소).
 *
 * 배경: KRX OpenAPI 는 거래일 T 의 EOD 일별 데이터를 T 일 밤~T+1 새벽에 게시한다. 저녁 슬롯
 * (18:30/21:00·18:45/21:05)만으론 항상 T-1 데이터만 받아 전일분이 T+1 저녁에야 지각 적재됐다.
 *
 * 검증(실 DB 없음):
 *   - 아침 크론 3종이 존재하고 KST(Asia/Seoul)로 발화한다(06:30·08:00 일봉, 08:00 지수).
 *   - 아침 슬롯은 새 수집 로직이 아니라 기존 멱등 캐치업 경로(catchUpDailyPrices/catchUpMarketIndices)를
 *     그대로 재호출한다(SSOT 유지).
 *   - 겹침 가드(isDailyCollecting)가 동작해 진행 중이면 재수집 없이 조기 반환한다.
 */

import 'reflect-metadata';

import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { KrxApiService } from './krx-api.service';
import { DartStockStatusService } from './dart-stock-status.service';
import { PrismaService } from '../../prisma/prisma.service';

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

function cronOpts(method: string): { cronTime?: unknown; timeZone?: unknown } | undefined {
  const fn = (KrxMarketDataScheduler.prototype as unknown as Record<string, unknown>)[method];
  return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn as object) as
    | { cronTime?: unknown; timeZone?: unknown }
    | undefined;
}

function makeScheduler(): KrxMarketDataScheduler {
  const prisma = {
    stockDailyPrice: {
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    marketIndex: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    marketDataCollectionLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const krx = {
    fetchIndexDaily: jest.fn().mockResolvedValue([]),
    isWeekend: jest.fn().mockReturnValue(false),
    parseDate: jest.fn().mockReturnValue(new Date('2026-07-08')),
    formatDate: jest.fn().mockReturnValue('20260708'),
  } as unknown as KrxApiService;
  const dart = {
    deriveAllStatuses: jest.fn().mockResolvedValue(new Map()),
  } as unknown as DartStockStatusService;
  return new KrxMarketDataScheduler(prisma, krx, dart);
}

describe('KrxMarketDataScheduler — 이른 아침 수집 슬롯', () => {
  describe('cron 존재·KST 발화', () => {
    it.each([
      ['earlyMorningCollectDailyPrices', '30 6 * * 1-5'],
      ['morningBackstopCollectDailyPrices', '0 8 * * 1-5'],
      ['morningCollectMarketIndices', '0 8 * * 1-5'],
    ])('%s 는 %s (KST) 로 발화', (method, expr) => {
      const opts = cronOpts(method);
      expect(opts).toBeDefined();
      expect(opts?.cronTime).toBe(expr);
      expect(opts?.timeZone).toBe('Asia/Seoul');
    });
  });

  describe('기존 캐치업 경로 재사용(SSOT)', () => {
    it('06:30 슬롯 — catchUpDailyPrices(CRON) 재호출(새 수집 로직 없음)', async () => {
      const scheduler = makeScheduler();
      const spy = jest.spyOn(scheduler, 'catchUpDailyPrices').mockResolvedValue({
        target: '20260708',
        lastLoaded: '20260707',
        filledDates: ['20260708'],
        emptyDates: [],
        totalSaved: 100,
        totalSkipped: 0,
      });

      const r = await scheduler.earlyMorningCollectDailyPrices();

      expect(spy).toHaveBeenCalledWith('CRON');
      expect(r.totalSaved).toBe(100);
    });

    it('08:00 일봉 백스톱 — 동일 catchUpDailyPrices 경로 재호출', async () => {
      const scheduler = makeScheduler();
      const spy = jest.spyOn(scheduler, 'catchUpDailyPrices').mockResolvedValue({
        target: '20260708',
        lastLoaded: '20260708',
        filledDates: [],
        emptyDates: [],
        totalSaved: 0,
        totalSkipped: 0,
      });

      await scheduler.morningBackstopCollectDailyPrices();

      expect(spy).toHaveBeenCalledWith('CRON');
    });

    it('08:00 지수 — catchUpMarketIndices(CRON) 경로 재호출', async () => {
      const scheduler = makeScheduler();
      const spy = jest.spyOn(scheduler, 'catchUpMarketIndices').mockResolvedValue({
        target: '20260708',
        lastLoaded: '20260707',
        filledDates: ['20260708'],
        totalSaved: 2,
        quarantined: 0,
      });

      const r = await scheduler.morningCollectMarketIndices();

      expect(spy).toHaveBeenCalledWith('CRON');
      expect(r.totalSaved).toBe(2);
    });
  });

  describe('겹침 가드', () => {
    it('일봉 수집 진행 중이면 아침 슬롯은 재수집 없이 조기 반환한다', async () => {
      const scheduler = makeScheduler();
      // 진행 중 상태 재현 — catchUpDailyPrices 가 가드로 즉시 반환해야 한다.
      (scheduler as unknown as { isDailyCollecting: boolean }).isDailyCollecting = true;

      const r = await scheduler.earlyMorningCollectDailyPrices();

      expect(r.message).toBe('이전 작업 진행 중');
      expect(r.totalSaved).toBe(0);
    });
  });
});
