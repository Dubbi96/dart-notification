// backend/src/engine1-disclosure/pipeline/tables-offload.scheduler.spec.ts
// DAR-399: tables 오프로드 스케줄러 — 겹침 가드/throw 흡수/recorder itemCount 회귀.
// DAR-503: 주말 창에서만 드레인, 주중은 WINDOW_SKIPPED + recordSkip.

import {
  TablesOffloadDrainResult,
  TablesOffloadDrainService,
} from './tables-offload-drain.service';
import { TablesOffloadScheduler } from './tables-offload.scheduler';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

// KST 벽시계 기준 결정론 시각(TZ 무관 — Intl 고정). 헤비 창=주말.
const WEEKEND = new Date('2026-07-04T03:00:00Z'); // KST 토 12:00
const WEEKDAY = new Date('2026-07-06T03:00:00Z'); // KST 월 12:00

function result(
  over: Partial<TablesOffloadDrainResult> = {},
): TablesOffloadDrainResult {
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

describe('TablesOffloadScheduler (DAR-399)', () => {
  let drain: { drainOnce: jest.Mock };

  beforeEach(() => {
    drain = { drainOnce: jest.fn().mockResolvedValue(result()) };
  });

  it('recorder 없이도 드레인 실행(RAN) — 주말 창', async () => {
    const sched = new TablesOffloadScheduler(
      drain as unknown as TablesOffloadDrainService,
    );
    expect(await sched.drainOffload(WEEKEND)).toBe('RAN');
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
    const sched = new TablesOffloadScheduler(
      drain as unknown as TablesOffloadDrainService,
    );
    const first = sched.drainOffload(WEEKEND);
    const second = await sched.drainOffload(WEEKEND);
    expect(second).toBe('SKIPPED');
    release();
    expect(await first).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('드레인 throw 도 흡수해 RAN, 락 해제(다음 사이클 진입 가능)', async () => {
    drain.drainOnce
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(result());
    const sched = new TablesOffloadScheduler(
      drain as unknown as TablesOffloadDrainService,
    );
    expect(await sched.drainOffload(WEEKEND)).toBe('RAN');
    expect(await sched.drainOffload(WEEKEND)).toBe('RAN');
    expect(drain.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('recorder 에 offloaded 건수를 itemCount 로 기록', async () => {
    drain.drainOnce.mockResolvedValue(result({ offloaded: 9 }));
    const recorder = {
      record: jest
        .fn()
        .mockImplementation(
          async (
            _key: string,
            run: () => Promise<TablesOffloadDrainResult>,
            opts: { countOf: (r: TablesOffloadDrainResult) => number },
          ) => {
            const r = await run();
            opts.countOf(r);
            return r;
          },
        ),
    };
    const sched = new TablesOffloadScheduler(
      drain as unknown as TablesOffloadDrainService,
      recorder as unknown as CronRunRecorderService,
    );
    await sched.drainOffload(WEEKEND);
    expect(recorder.record).toHaveBeenCalledWith(
      CRON_JOB_KEYS.TABLES_OFFLOAD_DRAIN,
      expect.any(Function),
      expect.objectContaining({ countOf: expect.any(Function) }),
    );
  });

  // ── DAR-503: 주중 헤비 창 밖 정지 ──────────────────────────────
  it('주중(헤비 창 밖)은 WINDOW_SKIPPED — drainOnce 미호출, recordSkip 기록', async () => {
    const recorder = { record: jest.fn(), recordSkip: jest.fn() };
    const sched = new TablesOffloadScheduler(
      drain as unknown as TablesOffloadDrainService,
      recorder as unknown as CronRunRecorderService,
    );
    expect(await sched.drainOffload(WEEKDAY)).toBe('WINDOW_SKIPPED');
    expect(drain.drainOnce).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(recorder.recordSkip).toHaveBeenCalledWith(
      CRON_JOB_KEYS.TABLES_OFFLOAD_DRAIN,
    );
  });

  it('주중이라도 recorder 미주입이면 조용히 WINDOW_SKIPPED', async () => {
    const sched = new TablesOffloadScheduler(
      drain as unknown as TablesOffloadDrainService,
    );
    expect(await sched.drainOffload(WEEKDAY)).toBe('WINDOW_SKIPPED');
    expect(drain.drainOnce).not.toHaveBeenCalled();
  });
});
