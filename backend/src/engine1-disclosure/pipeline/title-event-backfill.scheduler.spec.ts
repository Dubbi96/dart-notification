import {
  TitleEventBackfillScheduler,
  TITLE_BACKFILL_TIMEOUT_MS,
} from './title-event-backfill.scheduler';
import { TitleEventBackfillService } from './title-event-backfill.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/**
 * W4 신호 검증 — 제목 기반 이벤트 백필 스케줄러 단위 검증.
 * 겹침 가드·recorder 연계·예외 흡수(throw 금지)·타임아웃 행 방지를 본다.
 */
describe('TitleEventBackfillScheduler (W4 신호 검증)', () => {
  const result = {
    scanned: 10,
    matched: 4,
    created: 3,
    skippedUnmatched: 5,
    skippedLowConfidence: 1,
    exhausted: true,
    lastRcpDt: '20200101',
    lastRcpNo: 'R9',
    remainingCandidates: 7,
    durationMs: 5,
  };

  function makeDeps(overrides: { withRecorder?: boolean } = {}) {
    const service = {
      backfillOnce: jest.fn().mockResolvedValue(result),
    } as unknown as TitleEventBackfillService & { backfillOnce: jest.Mock };

    const recorder =
      overrides.withRecorder === false
        ? undefined
        : ({
            record: jest.fn(async (_key: string, run: () => Promise<unknown>) =>
              run(),
            ),
            recordSkip: jest.fn(),
          } as unknown as CronRunRecorderService & { record: jest.Mock });

    const scheduler = new TitleEventBackfillScheduler(service, recorder);
    return { service, recorder, scheduler };
  }

  it('사이클이 backfillOnce 를 1회 실행하고 recorder 에 created 를 기록한다', async () => {
    const { service, recorder, scheduler } = makeDeps();

    const status = await scheduler.runNightly();

    expect(status).toBe('RAN');
    expect(service.backfillOnce).toHaveBeenCalledTimes(1);
    expect(recorder!.record).toHaveBeenCalledTimes(1);
    const [jobKey, , opts] = (recorder!.record as jest.Mock).mock.calls[0];
    expect(jobKey).toBe(CRON_JOB_KEYS.TITLE_EVENT_BACKFILL);
    // itemCount = 이번 사이클 생성 건수(정직 카운트).
    expect(opts.countOf(result)).toBe(3);
  });

  it('recorder 미주입(@Optional) 환경에서도 백필은 수행된다', async () => {
    const { service, scheduler } = makeDeps({ withRecorder: false });

    const status = await scheduler.runNightly();

    expect(status).toBe('RAN');
    expect(service.backfillOnce).toHaveBeenCalledTimes(1);
  });

  it('이전 사이클 진행 중이면 즉시 SKIPPED(겹침 가드) — 완료 후엔 재진입 가능', async () => {
    const { service, scheduler } = makeDeps();
    let release!: () => void;
    service.backfillOnce.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(result);
        }),
    );

    const first = scheduler.runNightly(); // 진행 중(pending)
    const second = await scheduler.runNightly(); // 겹침 → 즉시 스킵
    expect(second).toBe('SKIPPED');
    expect(service.backfillOnce).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toBe('RAN');

    // 락 해제 후 다음 사이클은 정상 진입.
    const third = await scheduler.runNightly();
    expect(third).toBe('RAN');
    expect(service.backfillOnce).toHaveBeenCalledTimes(2);
  });

  it('backfillOnce 예외를 흡수하고(throw 금지) 락을 해제한다', async () => {
    const { service, scheduler } = makeDeps({ withRecorder: false });
    service.backfillOnce.mockRejectedValueOnce(new Error('DB down'));

    await expect(scheduler.runNightly()).resolves.toBe('RAN');

    // 예외 후에도 락이 풀려 다음 사이클이 실행된다.
    const next = await scheduler.runNightly();
    expect(next).toBe('RAN');
    expect(service.backfillOnce).toHaveBeenCalledTimes(2);
  });

  it('행(hang) 방지: 타임아웃이 지나면 사이클이 종료되고 락이 해제된다', async () => {
    jest.useFakeTimers();
    try {
      const { service, scheduler } = makeDeps({ withRecorder: false });
      // 영원히 정착하지 않는 promise — 무한 대기 쿼리 병리 재현.
      service.backfillOnce.mockImplementationOnce(() => new Promise(() => {}));

      const cycle = scheduler.runNightly();
      jest.advanceTimersByTime(TITLE_BACKFILL_TIMEOUT_MS + 1);
      await expect(cycle).resolves.toBe('RAN'); // 예외 흡수(throw 금지)

      // 타임아웃 후 락 해제 — 다음 사이클 정상 진입.
      service.backfillOnce.mockResolvedValueOnce(result);
      await expect(scheduler.runNightly()).resolves.toBe('RAN');
    } finally {
      jest.useRealTimers();
    }
  });
});
