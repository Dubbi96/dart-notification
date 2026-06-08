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
    await expect(scheduler.drainPipeline()).resolves.toBeUndefined();
  });
});
