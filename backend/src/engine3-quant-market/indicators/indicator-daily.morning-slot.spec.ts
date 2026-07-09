/**
 * indicator-daily.morning-slot.spec.ts — 아침 지표 계산 슬롯(08:15).
 *
 * 검증(실 DB 없음): 08:15 아침 크론 존재·KST 발화, 저녁 슬롯과 동일 경로(runDailyIndicatorsWithHealth
 *   ·backfill mode=latest·SSOT) 재발화, 겹침 가드 재사용. 08:00 아침 일봉 백스톱 직후라 전일 지표가
 *   08:30 프리플라이트·09:00 개장 전에 준비된다.
 */

import 'reflect-metadata';

import {
  IndicatorDailyScheduler,
  INDICATOR_DAILY_SKIP_MESSAGE,
} from './indicator-daily.scheduler';
import {
  IndicatorBackfillService,
  IndicatorBackfillResult,
} from './indicator-backfill.service';

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

function cronOpts(method: string): { cronTime?: unknown; timeZone?: unknown } | undefined {
  const fn = (IndicatorDailyScheduler.prototype as unknown as Record<string, unknown>)[method];
  return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn as object) as
    | { cronTime?: unknown; timeZone?: unknown }
    | undefined;
}

const okResult: IndicatorBackfillResult = {
  stocksProcessed: 3,
  indicatorsWritten: 3,
  stocksSkippedNoData: 0,
  targetDates: ['20260708'],
};

function makeBackfill(result: IndicatorBackfillResult = okResult) {
  const backfill = jest.fn().mockResolvedValue(result);
  return {
    service: { backfill } as unknown as IndicatorBackfillService,
    backfill,
  };
}

describe('IndicatorDailyScheduler — 아침 지표 슬롯(08:15)', () => {
  it('morningCalculateDailyIndicators 는 08:15 (KST) 로 발화', () => {
    const opts = cronOpts('morningCalculateDailyIndicators');
    expect(opts).toBeDefined();
    expect(opts?.cronTime).toBe('15 8 * * 1-5');
    expect(opts?.timeZone).toBe('Asia/Seoul');
  });

  it('저녁 슬롯과 동일 경로 — backfill(mode=latest) 를 호출하고 결과를 반환한다', async () => {
    const { service, backfill } = makeBackfill();
    const scheduler = new IndicatorDailyScheduler(service);

    const result = await scheduler.morningCalculateDailyIndicators();

    expect(backfill).toHaveBeenCalledWith({ mode: 'latest' });
    expect(result).toEqual(okResult);
  });

  it('겹침 가드 — 이전 계산 진행 중이면 재계산 없이 SKIP 메시지로 조기 반환', async () => {
    const { service, backfill } = makeBackfill();
    let release: (r: IndicatorBackfillResult) => void = () => undefined;
    backfill.mockImplementation(
      () =>
        new Promise<IndicatorBackfillResult>((resolve) => {
          release = resolve;
        }),
    );
    const scheduler = new IndicatorDailyScheduler(service);

    const inFlight = scheduler.calculateDailyIndicators();
    const overlapped = await scheduler.morningCalculateDailyIndicators();

    expect(overlapped.message).toBe(INDICATOR_DAILY_SKIP_MESSAGE);
    expect(backfill).toHaveBeenCalledTimes(1);

    release(okResult);
    await inFlight;
  });
});
