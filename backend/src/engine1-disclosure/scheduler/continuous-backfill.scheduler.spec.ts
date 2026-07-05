// backend/src/engine1-disclosure/scheduler/continuous-backfill.scheduler.spec.ts
// DAR-396: 연속 백필 스케줄러 — 겹침 가드, throw 흡수, recorder itemCount.
// DAR-503: 주말 창에서만 백필, 주중은 WINDOW_SKIPPED + recordSkip(DART 쿼터 보호).

import { ContinuousBackfillScheduler } from './continuous-backfill.scheduler';
import { ContinuousBackfillDrainService } from './continuous-backfill-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

// KST 벽시계 기준 결정론 시각(TZ 무관). 헤비 창=주말.
const WEEKEND = new Date('2026-07-04T03:00:00Z'); // KST 토 12:00
const WEEKDAY = new Date('2026-07-06T03:00:00Z'); // KST 월 12:00

function makeResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    chunksProcessed: 1,
    savedTotal: 42,
    fetchedTotal: 50,
    quotaExceeded: false,
    reachedEarliest: false,
    oldestWindowStart: '20250520',
    frontierAtStart: '20250619',
    durationMs: 5,
    ...over,
  };
}

describe('ContinuousBackfillScheduler (DAR-396)', () => {
  it('recorder 미주입이면 drainOnce 를 직접 호출하고 RAN 반환 — 주말 창', async () => {
    const drain = {
      drainOnce: jest.fn().mockResolvedValue(makeResult()),
    } as unknown as ContinuousBackfillDrainService;
    const scheduler = new ContinuousBackfillScheduler(drain);

    const status = await scheduler.drainBackfill(WEEKEND);

    expect(status).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('recorder 주입 시 DISCLOSURE_BACKFILL_EXTEND 키로 기록하고 itemCount=savedTotal', async () => {
    const drain = {
      drainOnce: jest.fn().mockResolvedValue(makeResult({ savedTotal: 77 })),
    } as unknown as ContinuousBackfillDrainService;
    const recorder = {
      record: jest.fn(async (_key: string, run: () => Promise<unknown>, opts: { countOf: (r: unknown) => number }) => {
        const r = await run();
        // countOf 가 savedTotal 을 반환하는지 검증
        expect(opts.countOf(r)).toBe(77);
        return r;
      }),
    } as unknown as CronRunRecorderService;
    const scheduler = new ContinuousBackfillScheduler(drain, recorder);

    const status = await scheduler.drainBackfill(WEEKEND);

    expect(status).toBe('RAN');
    expect((recorder.record as jest.Mock).mock.calls[0][0]).toBe(
      CRON_JOB_KEYS.DISCLOSURE_BACKFILL_EXTEND,
    );
  });

  it('drainOnce 가 throw 해도 흡수하고 RAN 반환(cron 스케줄 유지)', async () => {
    const drain = {
      drainOnce: jest.fn().mockRejectedValue(new Error('DART 장애')),
    } as unknown as ContinuousBackfillDrainService;
    const scheduler = new ContinuousBackfillScheduler(drain);

    await expect(scheduler.drainBackfill(WEEKEND)).resolves.toBe('RAN');
  });

  it('겹침 가드: 이전 드레인 진행 중이면 SKIPPED, drainOnce 미호출', async () => {
    let resolveDrain: (v: unknown) => void = () => {};
    const drain = {
      drainOnce: jest.fn().mockImplementation(
        () => new Promise((res) => (resolveDrain = res)),
      ),
    } as unknown as ContinuousBackfillDrainService;
    const scheduler = new ContinuousBackfillScheduler(drain);

    const first = scheduler.drainBackfill(WEEKEND); // 진행 중(미해결)
    const second = await scheduler.drainBackfill(WEEKEND); // 겹침 → SKIPPED

    expect(second).toBe('SKIPPED');
    expect((drain.drainOnce as jest.Mock)).toHaveBeenCalledTimes(1);

    resolveDrain(makeResult());
    await expect(first).resolves.toBe('RAN');
  });

  // ── DAR-503: 주중 헤비 창 밖 정지 ──────────────────────────────
  it('주중(헤비 창 밖)은 WINDOW_SKIPPED — drainOnce 미호출, recordSkip 기록', async () => {
    const drain = {
      drainOnce: jest.fn().mockResolvedValue(makeResult()),
    } as unknown as ContinuousBackfillDrainService;
    const recorder = {
      record: jest.fn(),
      recordSkip: jest.fn(),
    } as unknown as CronRunRecorderService;
    const scheduler = new ContinuousBackfillScheduler(drain, recorder);

    expect(await scheduler.drainBackfill(WEEKDAY)).toBe('WINDOW_SKIPPED');
    expect(drain.drainOnce).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(recorder.recordSkip).toHaveBeenCalledWith(
      CRON_JOB_KEYS.DISCLOSURE_BACKFILL_EXTEND,
    );
  });
});
