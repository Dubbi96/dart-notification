// DAR-379 — AI 백필 드레인 cron 의 recorder 래핑·itemCount·겹침가드·throw 흡수 검증.
import { AiBackfillScheduler } from './ai-backfill.scheduler';
import {
  AiBackfillDrainService,
  AiBackfillDrainResult,
} from './ai-backfill-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

function makeResult(over: Partial<AiBackfillDrainResult> = {}): AiBackfillDrainResult {
  return {
    scanned: 12,
    enqueued: 8,
    skippedByBudget: false,
    budgetBatchLimit: 100,
    dailyCostUsd: 0.1,
    dailyLimitUsd: 1.0,
    queueAvailable: true,
    ...over,
  };
}

function makeDrain(impl?: () => Promise<AiBackfillDrainResult>) {
  return {
    drainOnce: jest
      .fn()
      .mockImplementation(impl ?? (() => Promise.resolve(makeResult()))),
  } as unknown as AiBackfillDrainService;
}

describe('AiBackfillScheduler (DAR-379)', () => {
  it('recorder 로 AI_BACKFILL_DRAIN 잡을 감싸고 발행건수를 itemCount 로 기록한다', async () => {
    const drain = makeDrain();
    const record = jest
      .fn()
      .mockImplementation(
        async (
          key: string,
          fn: () => Promise<AiBackfillDrainResult>,
          opts: { countOf: (r: AiBackfillDrainResult) => number },
        ) => {
          expect(key).toBe(CRON_JOB_KEYS.AI_BACKFILL_DRAIN);
          const r = await fn();
          expect(opts.countOf(r)).toBe(8); // enqueued
          return r;
        },
      );
    const recorder = { record } as unknown as CronRunRecorderService;
    const scheduler = new AiBackfillScheduler(drain, recorder);

    const status = await scheduler.drainBackfill();

    expect(status).toBe('RAN');
    expect(record).toHaveBeenCalledTimes(1);
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('recorder 미주입 시에도 drainOnce 를 직접 호출하고 RAN 반환', async () => {
    const drain = makeDrain();
    const scheduler = new AiBackfillScheduler(drain);

    const status = await scheduler.drainBackfill();

    expect(status).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('겹침 가드 — 진행 중이면 SKIPPED, drainOnce 미호출', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const drain = makeDrain(async () => {
      await gate;
      return makeResult();
    });
    const scheduler = new AiBackfillScheduler(drain);

    const first = scheduler.drainBackfill();
    const second = await scheduler.drainBackfill(); // 첫 사이클 미완 중 진입

    expect(second).toBe('SKIPPED');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe('RAN');

    // 락 해제 후 정상 재진입 가능
    const third = await scheduler.drainBackfill();
    expect(third).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('drainOnce 예외를 흡수하고 RAN 반환(cron 스케줄 유지)·락 해제', async () => {
    const drain = makeDrain(() => Promise.reject(new Error('boom')));
    const scheduler = new AiBackfillScheduler(drain);

    const status = await scheduler.drainBackfill();
    expect(status).toBe('RAN');

    // 예외 후에도 락이 풀려 다음 사이클 진입 가능
    const drain2 = makeDrain();
    const ok = makeResult();
    (drain as unknown as { drainOnce: jest.Mock }).drainOnce.mockResolvedValueOnce(ok);
    const next = await scheduler.drainBackfill();
    expect(next).toBe('RAN');
    void drain2;
  });
});
