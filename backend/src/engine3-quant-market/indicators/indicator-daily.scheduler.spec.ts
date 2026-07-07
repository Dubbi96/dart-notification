/**
 * indicator-daily.scheduler.spec.ts — 일일 기술지표 계산 크론.
 *
 * 검증(실 DB 없음): 2슬롯(18:50/21:10) 동일 경로(SSOT)·mode='latest' 위임, 겹침 가드(SKIPPED),
 *   CronRunRecorder 래핑(키·countOf·isSkipped), 오류 흡수(throw 금지 — cron 유지),
 *   recorder 미주입 graceful. 계산 로직은 IndicatorBackfillService 재사용(중복 0)이 계약.
 */

import {
  IndicatorDailyScheduler,
  INDICATOR_DAILY_SKIP_MESSAGE,
} from './indicator-daily.scheduler';
import { IndicatorBackfillService, IndicatorBackfillResult } from './indicator-backfill.service';
import { CronRunRecorderService, RecordOptions } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

const okResult: IndicatorBackfillResult = {
  stocksProcessed: 3,
  indicatorsWritten: 3,
  stocksSkippedNoData: 1,
  targetDates: ['20260706'],
};

function makeBackfill(result: IndicatorBackfillResult = okResult) {
  const backfill = jest.fn().mockResolvedValue(result);
  return {
    service: { backfill } as unknown as IndicatorBackfillService,
    backfill,
  };
}

/**
 * 실제 CronRunRecorder 거동을 모사하는 fake — fn 실행 후 SUCCESS/SKIPPED 판정,
 * throw 시 FAILED 기록 후 동일 예외 재던짐(스케줄러의 흡수 계약 검증용).
 */
function makeRecorder() {
  const records: {
    jobKey: string;
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    itemCount: number;
  }[] = [];
  const record = jest.fn(
    async <T>(
      jobKey: string,
      fn: () => Promise<T>,
      options: RecordOptions<T> = {},
    ): Promise<T> => {
      try {
        const result = await fn();
        const skipped = options.isSkipped?.(result) ?? false;
        records.push({
          jobKey,
          status: skipped ? 'SKIPPED' : 'SUCCESS',
          itemCount: skipped ? 0 : (options.countOf?.(result) ?? 0),
        });
        return result;
      } catch (error) {
        records.push({ jobKey, status: 'FAILED', itemCount: 0 });
        throw error;
      }
    },
  );
  return {
    recorder: { record } as unknown as CronRunRecorderService,
    record,
    records,
  };
}

describe('IndicatorDailyScheduler — 일일 기술지표 크론', () => {
  it('18:50 슬롯 — backfill(mode=latest) 를 호출하고 결과를 그대로 반환한다', async () => {
    const { service, backfill } = makeBackfill();
    const scheduler = new IndicatorDailyScheduler(service);

    const result = await scheduler.calculateDailyIndicators();

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith({ mode: 'latest' });
    expect(result).toEqual(okResult);
  });

  it('21:10 재시도 슬롯 — 18:50 정시와 동일 경로(SSOT)·동일 mode=latest 를 공유한다', async () => {
    const { service, backfill } = makeBackfill();
    const scheduler = new IndicatorDailyScheduler(service);

    const first = await scheduler.calculateDailyIndicators();
    const retry = await scheduler.retryCalculateDailyIndicators();

    expect(backfill).toHaveBeenCalledTimes(2);
    expect(backfill).toHaveBeenNthCalledWith(1, { mode: 'latest' });
    expect(backfill).toHaveBeenNthCalledWith(2, { mode: 'latest' });
    // 멱등 upsert 라 재시도가 무해 — 두 슬롯 모두 정상 결과 반환.
    expect(first).toEqual(okResult);
    expect(retry).toEqual(okResult);
  });

  it('겹침 가드 — 이전 계산 진행 중이면 backfill 재호출 없이 SKIP 메시지로 조기 반환한다', async () => {
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
    const overlapped = await scheduler.retryCalculateDailyIndicators();

    expect(overlapped.message).toBe(INDICATOR_DAILY_SKIP_MESSAGE);
    expect(overlapped.indicatorsWritten).toBe(0);
    expect(backfill).toHaveBeenCalledTimes(1);

    release(okResult);
    await expect(inFlight).resolves.toEqual(okResult);
  });

  it('락은 완료 후 해제된다 — 첫 실행 종료 뒤 다음 슬롯은 정상 실행', async () => {
    const { service, backfill } = makeBackfill();
    const scheduler = new IndicatorDailyScheduler(service);

    await scheduler.calculateDailyIndicators();
    const second = await scheduler.retryCalculateDailyIndicators();

    expect(backfill).toHaveBeenCalledTimes(2);
    expect(second.message).toBeUndefined();
  });

  describe('CronRunRecorder 래핑 (market.indicator-daily)', () => {
    it('성공 시 SUCCESS + itemCount=indicatorsWritten(적재 행수)으로 기록한다', async () => {
      const { service } = makeBackfill();
      const { recorder, record, records } = makeRecorder();
      const scheduler = new IndicatorDailyScheduler(service, recorder);

      const result = await scheduler.calculateDailyIndicators();

      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.INDICATOR_DAILY);
      expect(CRON_JOB_KEYS.INDICATOR_DAILY).toBe('market.indicator-daily');
      expect(records).toEqual([
        { jobKey: 'market.indicator-daily', status: 'SUCCESS', itemCount: 3 },
      ]);
      expect(result).toEqual(okResult);
    });

    it('겹침 조기반환은 SKIPPED(실패 아님·itemCount 0)로 기록한다', async () => {
      const { service, backfill } = makeBackfill();
      let release: (r: IndicatorBackfillResult) => void = () => undefined;
      backfill.mockImplementation(
        () =>
          new Promise<IndicatorBackfillResult>((resolve) => {
            release = resolve;
          }),
      );
      const { recorder, records } = makeRecorder();
      const scheduler = new IndicatorDailyScheduler(service, recorder);

      const inFlight = scheduler.calculateDailyIndicators();
      await scheduler.retryCalculateDailyIndicators();

      expect(records[0]).toEqual({
        jobKey: 'market.indicator-daily',
        status: 'SKIPPED',
        itemCount: 0,
      });

      release(okResult);
      await inFlight;
    });

    it('backfill 오류 — recorder 에 FAILED 를 남기되 예외는 흡수한다(★throw 금지·cron 유지)', async () => {
      const { service, backfill } = makeBackfill();
      backfill.mockRejectedValue(new Error('DB connection lost'));
      const { recorder, records } = makeRecorder();
      const scheduler = new IndicatorDailyScheduler(service, recorder);

      // throw 없이 message 로 정직 보고.
      const result = await scheduler.calculateDailyIndicators();

      expect(records[0]).toEqual({
        jobKey: 'market.indicator-daily',
        status: 'FAILED',
        itemCount: 0,
      });
      expect(result.indicatorsWritten).toBe(0);
      expect(result.message).toBe('DB connection lost');
    });

    it('오류 후 락이 해제되어 다음 슬롯이 정상 재시도된다(자가복구)', async () => {
      const { service, backfill } = makeBackfill();
      backfill
        .mockRejectedValueOnce(new Error('일시 오류'))
        .mockResolvedValueOnce(okResult);
      const { recorder, records } = makeRecorder();
      const scheduler = new IndicatorDailyScheduler(service, recorder);

      await scheduler.calculateDailyIndicators();
      const retry = await scheduler.retryCalculateDailyIndicators();

      expect(retry).toEqual(okResult);
      expect(records.map((r) => r.status)).toEqual(['FAILED', 'SUCCESS']);
    });
  });

  it('recorder 미주입(테스트·부분 모듈) 시에도 본업은 그대로 수행한다(graceful)', async () => {
    const { service, backfill } = makeBackfill();
    const scheduler = new IndicatorDailyScheduler(service);

    const result = await scheduler.calculateDailyIndicators();

    expect(backfill).toHaveBeenCalledWith({ mode: 'latest' });
    expect(result).toEqual(okResult);
  });

  it('recorder 미주입 + backfill 오류 — 예외를 흡수하고 message 로 보고한다', async () => {
    const { service, backfill } = makeBackfill();
    backfill.mockRejectedValue(new Error('boom'));
    const scheduler = new IndicatorDailyScheduler(service);

    const result = await scheduler.calculateDailyIndicators();

    expect(result.message).toBe('boom');
    expect(result.indicatorsWritten).toBe(0);
  });
});
