import { CronRunRecorderService } from './cron-run-recorder.service';
import { CRON_JOB_KEYS } from './cron-health.jobs';

// CronRunRecorder 단위 검증 — Prisma cronRunLog 델리게이트 목 대체.
// 핵심 불변식: 본업 예외는 재던지고 FAILED 기록 / 로그 실패는 본업을 깨지 않음.
describe('CronRunRecorderService (DAR-110)', () => {
  function makePrisma() {
    const create = jest.fn().mockResolvedValue({ id: 'log-1' });
    const update = jest.fn().mockResolvedValue({});
    return {
      prisma: { cronRunLog: { create, update } } as any,
      create,
      update,
    };
  }

  it('성공 시 SUCCESS + itemCount + durationMs + finishedAt 를 기록한다', async () => {
    const { prisma, create, update } = makePrisma();
    const recorder = new CronRunRecorderService(prisma);

    const result = await recorder.record(
      CRON_JOB_KEYS.SIGNAL_GENERATE,
      async () => ({ created: 7 }),
      { countOf: (r) => r.created },
    );

    expect(result).toEqual({ created: 7 });
    expect(create).toHaveBeenCalledWith({
      data: { jobKey: 'signal.generate', triggeredBy: 'CRON', status: 'RUNNING' },
      select: { id: true },
    });
    const updateArg = update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'log-1' });
    expect(updateArg.data.status).toBe('SUCCESS');
    expect(updateArg.data.itemCount).toBe(7);
    expect(typeof updateArg.data.durationMs).toBe('number');
    expect(updateArg.data.finishedAt).toBeInstanceOf(Date);
    expect(updateArg.data.errorMessage).toBeNull();
  });

  it('countOf 미지정 시 itemCount=0', async () => {
    const { prisma, update } = makePrisma();
    const recorder = new CronRunRecorderService(prisma);
    await recorder.record(CRON_JOB_KEYS.PARSE_RETRY, async () => ({ queued: 5 }));
    expect(update.mock.calls[0][0].data.itemCount).toBe(0);
  });

  it('isSkipped=true 면 SKIPPED 로 기록하고 countOf 는 호출하지 않는다', async () => {
    const { prisma, update } = makePrisma();
    const recorder = new CronRunRecorderService(prisma);
    const countOf = jest.fn();

    await recorder.record(
      CRON_JOB_KEYS.INSIDER_DAILY,
      async () => ({ skipped: true as const, reason: '진행 중' }),
      { isSkipped: (r) => 'skipped' in r, countOf },
    );

    expect(update.mock.calls[0][0].data.status).toBe('SKIPPED');
    expect(update.mock.calls[0][0].data.itemCount).toBe(0);
    expect(countOf).not.toHaveBeenCalled();
  });

  it('recordSkip(DAR-503): RUNNING 생성 후 SKIPPED 로 마감(itemCount=0·에러 없음)', async () => {
    const { prisma, create, update } = makePrisma();
    const recorder = new CronRunRecorderService(prisma);

    await recorder.recordSkip(CRON_JOB_KEYS.TABLES_OFFLOAD_DRAIN);

    expect(create).toHaveBeenCalledWith({
      data: {
        jobKey: 'tables.offload-drain',
        triggeredBy: 'CRON',
        status: 'RUNNING',
      },
      select: { id: true },
    });
    const updateArg = update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'log-1' });
    expect(updateArg.data.status).toBe('SKIPPED');
    expect(updateArg.data.itemCount).toBe(0);
    expect(updateArg.data.errorMessage).toBeNull();
    expect(updateArg.data.finishedAt).toBeInstanceOf(Date);
  });

  it('recordSkip: RUNNING 기록 실패해도 조용히 넘어간다(best-effort)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const update = jest.fn().mockResolvedValue({});
    const prisma = { cronRunLog: { create, update } } as any;
    const recorder = new CronRunRecorderService(prisma);

    await expect(
      recorder.recordSkip(CRON_JOB_KEYS.RAWTEXT_OFFLOAD_DRAIN),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('본업이 throw 하면 FAILED + errorMessage 기록 후 동일 예외 재던짐', async () => {
    const { prisma, update } = makePrisma();
    const recorder = new CronRunRecorderService(prisma);

    await expect(
      recorder.record(CRON_JOB_KEYS.PAPER_SIMULATION, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const updateArg = update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('FAILED');
    expect(updateArg.data.errorMessage).toBe('boom');
    expect(updateArg.data.itemCount).toBe(0);
  });

  it('RUNNING 기록 자체가 실패해도 본업은 정상 수행(메타 기록 best-effort)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const update = jest.fn().mockResolvedValue({});
    const prisma = { cronRunLog: { create, update } } as any;
    const recorder = new CronRunRecorderService(prisma);

    const result = await recorder.record(
      CRON_JOB_KEYS.SIGNAL_GENERATE,
      async () => ({ created: 1 }),
      { countOf: (r) => r.created },
    );

    expect(result).toEqual({ created: 1 });
    // logId 가 null 이라 finalize update 는 호출되지 않음.
    expect(update).not.toHaveBeenCalled();
  });

  it('종료 기록(update) 실패도 본업 결과를 깨지 않는다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'log-9' });
    const update = jest.fn().mockRejectedValue(new Error('update fail'));
    const prisma = { cronRunLog: { create, update } } as any;
    const recorder = new CronRunRecorderService(prisma);

    const result = await recorder.record(
      CRON_JOB_KEYS.PARSE_RETRY,
      async () => ({ queued: 2 }),
      { countOf: (r) => r.queued },
    );

    expect(result).toEqual({ queued: 2 });
  });
});
