import { EventBackfillScheduler } from './event-backfill.scheduler';
import {
  EventBackfillDrainService,
  EventBackfillDrainResult,
} from './event-backfill-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/** DAR-391 — 이벤트 추출 백필 cron 의 recorder 래핑·itemCount·throw 흡수·겹침 가드 검증. */
describe('EventBackfillScheduler (DAR-391)', () => {
  const drainResult: EventBackfillDrainResult = {
    extractScanned: 5,
    extractSuccess: 3,
    extractNeedsReview: 1,
    extractFailed: 1,
    parseEnqueued: 4,
    remainingUnextracted: 10,
    remainingUnparsed: 20,
    durationMs: 12,
  };

  function makeService(impl?: () => Promise<EventBackfillDrainResult>) {
    return {
      drainOnce: jest
        .fn()
        .mockImplementation(impl ?? (() => Promise.resolve(drainResult))),
    } as unknown as EventBackfillDrainService & { drainOnce: jest.Mock };
  }

  it('recorder 로 EVENT_BACKFILL_DRAIN 잡을 감싸고 전진건수를 itemCount 로 기록한다', async () => {
    const drain = makeService();
    const record = jest
      .fn()
      .mockImplementation(
        async (
          _key: string,
          fn: () => Promise<EventBackfillDrainResult>,
          opts: { countOf: (r: EventBackfillDrainResult) => number },
        ) => {
          const r = await fn();
          // countOf = extractSuccess(3) + extractNeedsReview(1) + parseEnqueued(4) = 8
          expect(opts.countOf(r)).toBe(8);
          return r;
        },
      );
    const recorder = { record } as unknown as CronRunRecorderService;

    const scheduler = new EventBackfillScheduler(drain, recorder);
    await scheduler.drainBackfill();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.EVENT_BACKFILL_DRAIN);
    expect(drain.drainOnce).toHaveBeenCalled();
  });

  it('recorder 미주입 환경에서도 drainOnce 를 직접 실행한다', async () => {
    const drain = makeService();
    const scheduler = new EventBackfillScheduler(drain);
    await scheduler.drainBackfill();
    expect(drain.drainOnce).toHaveBeenCalled();
  });

  it('drainOnce 가 throw 해도 스케줄러는 예외를 흡수한다(cron 유지)', async () => {
    const drain = makeService(() => Promise.reject(new Error('boom')));
    const scheduler = new EventBackfillScheduler(drain);
    await expect(scheduler.drainBackfill()).resolves.toBe('RAN');
  });

  it('드레인 진행 중 겹친 cron 은 즉시 SKIPPED — drainOnce 중복 호출 없음', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const drain = makeService(async () => {
      await gate;
      return drainResult;
    });
    const scheduler = new EventBackfillScheduler(drain);

    const first = scheduler.drainBackfill();
    await Promise.resolve(); // 마이크로태스크 flush → drainOnce 진입 보장
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);

    await expect(scheduler.drainBackfill()).resolves.toBe('SKIPPED');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toBe('RAN');

    await expect(scheduler.drainBackfill()).resolves.toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('throw 로 끝난 사이클도 락을 해제해 다음 사이클이 진입한다(finally 보장)', async () => {
    const drain = makeService(() => Promise.reject(new Error('boom')));
    const scheduler = new EventBackfillScheduler(drain);

    await expect(scheduler.drainBackfill()).resolves.toBe('RAN');
    await expect(scheduler.drainBackfill()).resolves.toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(2);
  });
});
