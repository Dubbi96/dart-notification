// backend/src/engine1-disclosure/pipeline/rawtext-offload.scheduler.spec.ts
// DAR-395: 오프로드 스케줄러 — 겹침 가드/throw 흡수/recorder itemCount 회귀.

import {
  RawTextOffloadDrainResult,
  RawTextOffloadDrainService,
} from './rawtext-offload-drain.service';
import { RawTextOffloadScheduler } from './rawtext-offload.scheduler';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

function result(
  over: Partial<RawTextOffloadDrainResult> = {},
): RawTextOffloadDrainResult {
  return {
    scanned: 0,
    offloaded: 0,
    failed: 0,
    remaining: 0,
    totalOffloaded: 0,
    driver: 'local',
    storageConfigured: true,
    durationMs: 1,
    ...over,
  };
}

describe('RawTextOffloadScheduler (DAR-395)', () => {
  let drain: { drainOnce: jest.Mock };

  beforeEach(() => {
    drain = { drainOnce: jest.fn().mockResolvedValue(result()) };
  });

  it('recorder 없이도 드레인 실행(RAN)', async () => {
    const sched = new RawTextOffloadScheduler(
      drain as unknown as RawTextOffloadDrainService,
    );
    expect(await sched.drainOffload()).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('이전 사이클 진행 중이면 SKIPPED(겹침 가드)', async () => {
    let release!: () => void;
    drain.drainOnce.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r(result());
        }),
    );
    const sched = new RawTextOffloadScheduler(
      drain as unknown as RawTextOffloadDrainService,
    );
    const first = sched.drainOffload(); // 진행 중(락 보유)
    const second = await sched.drainOffload(); // 즉시 차단
    expect(second).toBe('SKIPPED');
    release();
    expect(await first).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('드레인 throw 도 흡수해 RAN, 락 해제(다음 사이클 진입 가능)', async () => {
    drain.drainOnce
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(result());
    const sched = new RawTextOffloadScheduler(
      drain as unknown as RawTextOffloadDrainService,
    );
    expect(await sched.drainOffload()).toBe('RAN');
    expect(await sched.drainOffload()).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('recorder 에 offloaded 건수를 itemCount 로 기록', async () => {
    drain.drainOnce.mockResolvedValue(result({ offloaded: 7 }));
    const recorder = {
      record: jest
        .fn()
        .mockImplementation(
          async (
            _key: string,
            run: () => Promise<RawTextOffloadDrainResult>,
            opts: { countOf: (r: RawTextOffloadDrainResult) => number },
          ) => {
            const r = await run();
            opts.countOf(r);
            return r;
          },
        ),
    };
    const sched = new RawTextOffloadScheduler(
      drain as unknown as RawTextOffloadDrainService,
      recorder as unknown as CronRunRecorderService,
    );
    await sched.drainOffload();
    expect(recorder.record).toHaveBeenCalledWith(
      CRON_JOB_KEYS.RAWTEXT_OFFLOAD_DRAIN,
      expect.any(Function),
      expect.objectContaining({ countOf: expect.any(Function) }),
    );
    expect(recorder.record.mock.results[0].value).resolves.toMatchObject({
      offloaded: 7,
    });
  });
});
