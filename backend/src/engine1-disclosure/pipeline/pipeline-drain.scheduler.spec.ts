import { PipelineDrainScheduler } from './pipeline-drain.scheduler';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { PipelineDrainResult } from './pipeline.types';

/** DAR-126 — 폐루프 드레인 cron 의 recorder 래핑·itemCount·throw 흡수 검증. */
describe('PipelineDrainScheduler (DAR-126)', () => {
  const drainResult: PipelineDrainResult = {
    enqueuedMissingDocuments: 1,
    parse: { success: 3, failed: 1 },
    events: { success: 2, failed: 0, needsReview: 1 },
    durationMs: 10,
  };

  function makePipeline(impl?: () => Promise<PipelineDrainResult>) {
    return {
      drainOnce: jest
        .fn()
        .mockImplementation(impl ?? (() => Promise.resolve(drainResult))),
    } as unknown as PipelineIntegrityService;
  }

  it('recorder 로 PIPELINE_DRAIN 잡을 감싸고 전진건수를 itemCount 로 기록한다', async () => {
    const pipeline = makePipeline();
    const record = jest
      .fn()
      .mockImplementation(
        async (_key: string, fn: () => Promise<PipelineDrainResult>, opts: { countOf: (r: PipelineDrainResult) => number }) => {
          const r = await fn();
          // countOf = parse.success(3) + events.success(2) + needsReview(1) = 6
          expect(opts.countOf(r)).toBe(6);
          return r;
        },
      );
    const recorder = { record } as unknown as CronRunRecorderService;

    const scheduler = new PipelineDrainScheduler(pipeline, recorder);
    await scheduler.drainPipeline();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.PIPELINE_DRAIN);
    expect(pipeline.drainOnce).toHaveBeenCalled();
  });

  it('recorder 미주입 환경에서도 drainOnce 를 직접 실행한다', async () => {
    const pipeline = makePipeline();
    const scheduler = new PipelineDrainScheduler(pipeline);
    await scheduler.drainPipeline();
    expect(pipeline.drainOnce).toHaveBeenCalled();
  });

  it('drainOnce 가 throw 해도 스케줄러는 예외를 흡수한다(cron 유지)', async () => {
    const pipeline = makePipeline(() => Promise.reject(new Error('boom')));
    const scheduler = new PipelineDrainScheduler(pipeline);
    // 예외 흡수 후에도 사이클은 RAN 으로 종료(끝까지 진입했으므로 SKIPPED 아님).
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
  });

  // ── DAR-229: 겹침 가드(in-flight 락) ──────────────────────────────
  it('드레인 진행 중 겹친 cron 은 즉시 SKIPPED — drainOnce 를 중복 호출하지 않는다', async () => {
    // 첫 드레인을 게이트로 in-flight 상태에 고정한다(release 전까지 미완).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline = makePipeline(async () => {
      await gate;
      return drainResult;
    });
    const scheduler = new PipelineDrainScheduler(pipeline);

    // 1) 첫 사이클 시작 — drainOnce 진입 후 gate 에서 대기(미완).
    const first = scheduler.drainPipeline();
    await Promise.resolve(); // 마이크로태스크 flush → drainOnce 실제 호출 보장
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);

    // 2) 겹친 사이클 — 즉시 SKIPPED, drainOnce 재호출 없음.
    await expect(scheduler.drainPipeline()).resolves.toBe('SKIPPED');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);

    // 3) 첫 사이클 완료 → 락 해제.
    release();
    await expect(first).resolves.toBe('RAN');

    // 4) 락 해제 후 다음 사이클은 정상 진입(drainOnce 2회째 호출).
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('throw 로 끝난 사이클도 락을 해제해 다음 사이클이 진입한다(finally 보장)', async () => {
    const pipeline = makePipeline(() => Promise.reject(new Error('boom')));
    const scheduler = new PipelineDrainScheduler(pipeline);

    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    // 직전 사이클이 예외로 끝났어도 isDraining 이 false 로 풀려 재진입 가능.
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });
});
