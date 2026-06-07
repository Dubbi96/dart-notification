import { PendingPipelineScheduler } from './pending-pipeline.scheduler';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

describe('PendingPipelineScheduler (DAR-113)', () => {
  function makeDocs(success = 5, failed = 1): DisclosureDocumentsService {
    return {
      processPendingBatch: jest
        .fn()
        .mockResolvedValue({ success, failed, durationMs: 10 }),
    } as unknown as DisclosureDocumentsService;
  }

  function makeEvents(
    success = 2,
    needsReview = 6,
    failed = 1,
  ): DisclosureEventsService {
    return {
      processPendingDisclosures: jest
        .fn()
        .mockResolvedValue({ success, needsReview, failed, durationMs: 10 }),
    } as unknown as DisclosureEventsService;
  }

  it('파싱 드레인 후 이벤트추출 드레인을 순차 호출하고 합계를 집계한다', async () => {
    const docs = makeDocs(5, 1);
    const events = makeEvents(2, 6, 1);
    const scheduler = new PendingPipelineScheduler(docs, events);

    const result = await scheduler.drainPending();

    expect(docs.processPendingBatch).toHaveBeenCalledTimes(1);
    expect(events.processPendingDisclosures).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      parsed: 5,
      failedParse: 1,
      eventsProcessed: 9, // 2 + 6 + 1
      skipped: false,
    });
  });

  it('체이닝에 의존하지 않고 이벤트추출을 명시적으로 호출한다(결정적 경로)', async () => {
    // 파싱은 성공했지만 fire-and-forget 체이닝이 이벤트를 만들지 않는 상황을 모사.
    // 스케줄러가 processPendingDisclosures를 직접 호출해 이벤트추출을 보장해야 한다.
    const docs = makeDocs(3, 0);
    const events = makeEvents(1, 2, 0);
    const scheduler = new PendingPipelineScheduler(docs, events);

    await scheduler.drainPending();

    expect(events.processPendingDisclosures).toHaveBeenCalledTimes(1);
  });

  it('이전 드레인이 진행 중이면 건너뛴다(중복 실행 방지)', async () => {
    let resolveBatch: (v: unknown) => void = () => {};
    const docs = {
      processPendingBatch: jest
        .fn()
        .mockImplementation(
          () => new Promise((res) => (resolveBatch = res)),
        ),
    } as unknown as DisclosureDocumentsService;
    const events = makeEvents();
    const scheduler = new PendingPipelineScheduler(docs, events);

    const first = scheduler.drainPending(); // 진행 중(미완료)
    const second = await scheduler.drainPending(); // 락에 막혀 즉시 skipped

    expect(second.skipped).toBe(true);
    expect(docs.processPendingBatch).toHaveBeenCalledTimes(1); // 두 번째는 본문 미진입

    resolveBatch({ success: 1, failed: 0, durationMs: 1 });
    await first;
  });

  it('recorder 주입 시 PIPELINE_DRAIN 키로 기록하고 결과를 그대로 반환한다', async () => {
    const docs = makeDocs(4, 0);
    const events = makeEvents(1, 1, 0);
    const recorder = {
      record: jest.fn((_key, fn) => fn()),
    } as unknown as CronRunRecorderService;
    const scheduler = new PendingPipelineScheduler(docs, events, recorder);

    const result = await scheduler.drainPending();

    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect((recorder.record as jest.Mock).mock.calls[0][0]).toBe(
      CRON_JOB_KEYS.PIPELINE_DRAIN,
    );
    expect(result.parsed).toBe(4);
  });

  it('본업 예외를 흡수해 Cron 스케줄을 유지한다(throw 안 함)', async () => {
    const docs = {
      processPendingBatch: jest.fn().mockRejectedValue(new Error('DART 장애')),
    } as unknown as DisclosureDocumentsService;
    const events = makeEvents();
    const scheduler = new PendingPipelineScheduler(docs, events);

    const result = await scheduler.drainPending();

    // 예외를 삼키고 0 결과 반환 — 스케줄러는 다음 주기에 재시도.
    expect(result).toEqual({
      parsed: 0,
      failedParse: 0,
      eventsProcessed: 0,
      skipped: false,
    });
    // 락이 해제되어 다음 실행이 가능해야 한다.
    expect(events.processPendingDisclosures).not.toHaveBeenCalled();
  });
});
