import { FailedEventRecoveryScheduler } from './failed-event-recovery.scheduler';
import { DisclosureEventsService } from './disclosure-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/** DAR-347 — FAILED 이벤트 자동복구 cron 의 recorder 래핑·itemCount·경보·겹침가드·throw 흡수 검증. */
describe('FailedEventRecoveryScheduler (DAR-347)', () => {
  type ReprocessResult = {
    scanned: number;
    reclassified: number;
    durationMs: number;
  };

  const reprocessResult: ReprocessResult = {
    scanned: 50,
    reclassified: 7,
    durationMs: 10,
  };

  function makeService(impl?: () => Promise<ReprocessResult>) {
    return {
      reprocessForNewExtractors: jest
        .fn()
        .mockImplementation(impl ?? (() => Promise.resolve(reprocessResult))),
    } as unknown as DisclosureEventsService;
  }

  function makePrisma(failedCount = 0) {
    return {
      disclosureEvent: {
        count: jest.fn().mockResolvedValue(failedCount),
      },
    } as unknown as PrismaService;
  }

  it('recorder 로 FAILED_EVENT_RECOVERY 잡을 감싸고 재분류건수를 itemCount 로 기록한다', async () => {
    const service = makeService();
    const prisma = makePrisma(0);
    const record = jest
      .fn()
      .mockImplementation(
        async (
          _key: string,
          fn: () => Promise<ReprocessResult>,
          opts: { countOf: (r: ReprocessResult) => number },
        ) => {
          const r = await fn();
          // countOf = reclassified(7)
          expect(opts.countOf(r)).toBe(7);
          return r;
        },
      );
    const recorder = { record } as unknown as CronRunRecorderService;

    const scheduler = new FailedEventRecoveryScheduler(service, prisma, recorder);
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.FAILED_EVENT_RECOVERY);
    expect(service.reprocessForNewExtractors).toHaveBeenCalledTimes(1);
  });

  it('recorder 미주입 환경에서도 reprocessForNewExtractors 를 직접 실행한다', async () => {
    const service = makeService();
    const prisma = makePrisma(0);
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');
    expect(service.reprocessForNewExtractors).toHaveBeenCalledTimes(1);
  });

  it('reprocess 가 throw 해도 스케줄러는 예외를 흡수한다(cron 유지)', async () => {
    const service = makeService(() => Promise.reject(new Error('boom')));
    const prisma = makePrisma(0);
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);
    // 예외 흡수 후에도 사이클은 RAN 으로 종료(끝까지 진입했으므로 SKIPPED 아님).
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');
  });

  // ── 경보(에스컬레이션) ────────────────────────────────────────────
  it('잔존 FAILED 가 임계(500) 초과면 logger.error 로 경보한다', async () => {
    const service = makeService();
    const prisma = makePrisma(501);
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);
    const errorSpy = jest
      .spyOn((scheduler as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await scheduler.recoverFailedEvents();

    expect(prisma.disclosureEvent.count).toHaveBeenCalledWith({
      where: { extractionStatus: 'FAILED' },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('501');
  });

  it('잔존 FAILED 가 임계 이하면 경보하지 않는다', async () => {
    const service = makeService();
    const prisma = makePrisma(500); // 경계: 초과(>)만 경보 → 500 은 경보 없음
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);
    const errorSpy = jest
      .spyOn((scheduler as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await scheduler.recoverFailedEvents();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('적체 카운트 실패는 삼키고 사이클을 RAN 으로 끝낸다(경보 점검 best-effort)', async () => {
    const service = makeService();
    const prisma = {
      disclosureEvent: {
        count: jest.fn().mockRejectedValue(new Error('db down')),
      },
    } as unknown as PrismaService;
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');
  });

  // ── 겹침 가드(in-flight 락) ────────────────────────────────────────
  it('복구 진행 중 겹친 cron 은 즉시 SKIPPED — reprocess 를 중복 호출하지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = makeService(async () => {
      await gate;
      return reprocessResult;
    });
    const prisma = makePrisma(0);
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);

    // 1) 첫 사이클 시작 — reprocess 진입 후 gate 에서 대기(미완).
    const first = scheduler.recoverFailedEvents();
    await Promise.resolve(); // 마이크로태스크 flush → reprocess 실제 호출 보장
    expect(service.reprocessForNewExtractors).toHaveBeenCalledTimes(1);

    // 2) 겹친 사이클 — 즉시 SKIPPED, reprocess 재호출 없음.
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('SKIPPED');
    expect(service.reprocessForNewExtractors).toHaveBeenCalledTimes(1);

    // 3) 첫 사이클 완료 → 락 해제.
    release();
    await expect(first).resolves.toBe('RAN');

    // 4) 락 해제 후 다음 사이클은 정상 진입(reprocess 2회째 호출).
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');
    expect(service.reprocessForNewExtractors).toHaveBeenCalledTimes(2);
  });

  it('throw 로 끝난 사이클도 락을 해제해 다음 사이클이 진입한다(finally 보장)', async () => {
    const service = makeService(() => Promise.reject(new Error('boom')));
    const prisma = makePrisma(0);
    const scheduler = new FailedEventRecoveryScheduler(service, prisma);

    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');
    await expect(scheduler.recoverFailedEvents()).resolves.toBe('RAN');
    expect(service.reprocessForNewExtractors).toHaveBeenCalledTimes(2);
  });
});
