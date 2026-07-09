import {
  EventBackfillScheduler,
  DRAIN_TIMEOUT_MS,
} from './event-backfill.scheduler';
import {
  EventBackfillDrainService,
  EventBackfillDrainResult,
} from './event-backfill-drain.service';
import {
  CronRunRecorderService,
  RecordOptions,
} from '../../cron-health/cron-run-recorder.service';
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

/**
 * 드레인 타임아웃(행 방지) — drainOnce 가 무한 대기해도 DRAIN_TIMEOUT_MS 후 강제 종료되어
 * isDraining 이 해제되고(락 고착 방지), recorder 에는 FAILED 로 기록된다(다음 03:00 정상 재시도).
 *
 * prod 실증 7/9: drainOnce 가 DB 커넥션 문제로 무한 대기 → isDraining 영구 true → 후속 사이클
 * 전부 SKIPPED 로 고착(RUNNING 고착·익일 FAILED). 가짜 타이머로 이 병리 자가복구를 검증한다.
 */
describe('EventBackfillScheduler — 드레인 타임아웃(행 방지)', () => {
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

  /** 실제 CronRunRecorder 거동 모사 — fn 실행 후 SUCCESS/SKIPPED 판정, throw 시 FAILED 기록 후 재던짐. */
  function makeRecorder() {
    const records: { jobKey: string; status: 'SUCCESS' | 'SKIPPED' | 'FAILED' }[] = [];
    const record = jest.fn(
      async <T>(
        jobKey: string,
        fn: () => Promise<T>,
        options: RecordOptions<T> = {},
      ): Promise<T> => {
        try {
          const result = await fn();
          const skipped = options.isSkipped?.(result) ?? false;
          records.push({ jobKey, status: skipped ? 'SKIPPED' : 'SUCCESS' });
          return result;
        } catch (error) {
          records.push({ jobKey, status: 'FAILED' });
          throw error;
        }
      },
    );
    return { recorder: { record } as unknown as CronRunRecorderService, records };
  }

  function neverResolvingDrain(): EventBackfillDrainService & { drainOnce: jest.Mock } {
    return {
      drainOnce: jest.fn().mockReturnValue(new Promise<EventBackfillDrainResult>(() => {})),
    } as unknown as EventBackfillDrainService & { drainOnce: jest.Mock };
  }

  const isDraining = (s: EventBackfillScheduler): boolean =>
    (s as unknown as { isDraining: boolean }).isDraining;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('DRAIN_TIMEOUT_MS 상수는 10분', () => {
    expect(DRAIN_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it('무한 대기 drainOnce — 타임아웃 경계 전엔 락 유지, 경과 후 해제(RAN)', async () => {
    jest.useFakeTimers();
    const drain = neverResolvingDrain();
    const scheduler = new EventBackfillScheduler(drain);

    const p = scheduler.drainBackfill();

    // 타임아웃 직전 — 여전히 드레인 진행 중(락 유지, SKIPPED 로 후속 차단).
    await jest.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS - 1);
    expect(isDraining(scheduler)).toBe(true);

    // 타임아웃 경과 → reject → catch 흡수 → finally 락 해제.
    await jest.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toBe('RAN');
    expect(isDraining(scheduler)).toBe(false);
  });

  it('타임아웃은 recorder 에 FAILED 로 기록된다', async () => {
    jest.useFakeTimers();
    const drain = neverResolvingDrain();
    const { recorder, records } = makeRecorder();
    const scheduler = new EventBackfillScheduler(drain, recorder);

    const p = scheduler.drainBackfill();
    await jest.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS + 1);

    await expect(p).resolves.toBe('RAN');
    expect(records).toEqual([
      { jobKey: CRON_JOB_KEYS.EVENT_BACKFILL_DRAIN, status: 'FAILED' },
    ]);
    expect(isDraining(scheduler)).toBe(false);
  });

  it('타임아웃으로 락이 풀린 뒤 다음 사이클이 정상 진입한다(고착 없음)', async () => {
    jest.useFakeTimers();
    const drain = {
      drainOnce: jest
        .fn()
        .mockReturnValueOnce(new Promise<EventBackfillDrainResult>(() => {})) // 1회차: 무한 대기
        .mockResolvedValue(drainResult), // 2회차: 정상
    } as unknown as EventBackfillDrainService & { drainOnce: jest.Mock };
    const scheduler = new EventBackfillScheduler(drain);

    const first = scheduler.drainBackfill();
    await jest.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS + 1);
    await expect(first).resolves.toBe('RAN');

    await expect(scheduler.drainBackfill()).resolves.toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('타임아웃 전 drainOnce 완료 시 타이머는 정리되고 정상 RAN(누수 없음)', async () => {
    jest.useFakeTimers();
    const drain = {
      drainOnce: jest.fn().mockResolvedValue(drainResult),
    } as unknown as EventBackfillDrainService & { drainOnce: jest.Mock };
    const scheduler = new EventBackfillScheduler(drain);

    await expect(scheduler.drainBackfill()).resolves.toBe('RAN');
    // race 정착 후 finally 가 setTimeout 을 clear — 잔여 타이머 0(누수 방지).
    expect(jest.getTimerCount()).toBe(0);
    expect(isDraining(scheduler)).toBe(false);
  });
});
