import { OpsDailyReportScheduler } from './ops-daily-report.scheduler';
import { OpsDailyReportService } from './ops-daily-report.service';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { CronRunRecorderService } from '../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import { OpsDailyReport } from './ops-daily-report.types';

/**
 * DAR-477(견고화 W0·P05) — 일일 리포트 스케줄러 단위 테스트.
 * 발송 배선(enqueueOpsAlert)·CronRunLog 기록·겹침 가드·throw 안전을 검증.
 */
describe('OpsDailyReportScheduler (DAR-477)', () => {
  const NOW = new Date('2026-07-02T11:30:00.000Z');

  function makeReport(over: Partial<OpsDailyReport> = {}): OpsDailyReport {
    return {
      generatedAt: NOW.toISOString(),
      reportDateKst: '2026-07-02',
      severity: 'INFO',
      pnl: { byTrack: [], totalRealizedPnlKrw: 1239000, totalUnrealizedPnlKrw: -46000 },
      fills: { windowHours: 24, total: 7, byTrack: [] },
      cron: {
        windowHours: 24,
        totalRuns: 40,
        failedRuns: 0,
        errorRatePct: 0,
        failedJobKeys: [],
        staleJobs: [],
      },
      slippage: null,
      signals24h: 7,
      aiCostUsdTotal: 1.2345,
      body: '일일 운영 리포트 (2026-07-02 KST)\n...',
      ...over,
    };
  }

  function makeDeps(report: OpsDailyReport, buildImpl?: () => Promise<OpsDailyReport>) {
    const reportService = {
      buildReport: jest.fn().mockImplementation(buildImpl ?? (() => Promise.resolve(report))),
    } as unknown as OpsDailyReportService;
    const enqueueOpsAlert = jest.fn().mockResolvedValue(undefined);
    const producer = { enqueueOpsAlert } as unknown as NotificationProducerService;
    // recorder.record 는 fn 을 실제 호출해 통과시킨다(래핑 검증용).
    const record = jest.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn());
    const recorder = { record } as unknown as CronRunRecorderService;
    return { reportService, producer, enqueueOpsAlert, recorder, record };
  }

  it('리포트를 생성해 OPS_ALERT 로 발송하고 CronRunLog 에 기록한다', async () => {
    const report = makeReport({ severity: 'INFO' });
    const { reportService, producer, enqueueOpsAlert, recorder, record } = makeDeps(report);
    const scheduler = new OpsDailyReportScheduler(reportService, producer, recorder);

    const result = await scheduler.runDaily(NOW);

    expect(result).toBe(report);
    expect(record).toHaveBeenCalledWith(
      CRON_JOB_KEYS.OPS_DAILY_REPORT,
      expect.any(Function),
      expect.objectContaining({ countOf: expect.any(Function) }),
    );
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
    expect(enqueueOpsAlert).toHaveBeenCalledWith(
      'INFO',
      'daily-report',
      report.body,
      expect.objectContaining({
        dedupeKey: 'daily-report:2026-07-02',
        data: expect.objectContaining({
          totalRealizedPnlKrw: 1239000,
          fills24h: 7,
          cronFailedRuns: 0,
        }),
      }),
    );
  });

  it('WARNING 심각도를 그대로 발송 severity 로 전달한다', async () => {
    const report = makeReport({ severity: 'WARNING' });
    const { reportService, producer, enqueueOpsAlert, recorder } = makeDeps(report);
    const scheduler = new OpsDailyReportScheduler(reportService, producer, recorder);
    await scheduler.runDaily(NOW);
    expect(enqueueOpsAlert.mock.calls[0][0]).toBe('WARNING');
  });

  it('recorder 미주입(테스트/큐 비활성) 환경에서도 발송한다', async () => {
    const report = makeReport();
    const { reportService, producer, enqueueOpsAlert } = makeDeps(report);
    const scheduler = new OpsDailyReportScheduler(reportService, producer, undefined);
    const result = await scheduler.runDaily(NOW);
    expect(result).toBe(report);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('겹침 가드 — 진행 중이면 다음 사이클을 스킵(중복 발송 방지)', async () => {
    let release!: (r: OpsDailyReport) => void;
    const pending = new Promise<OpsDailyReport>((res) => {
      release = res;
    });
    const report = makeReport();
    const { reportService, producer, enqueueOpsAlert, recorder } = makeDeps(report, () => pending);
    const scheduler = new OpsDailyReportScheduler(reportService, producer, recorder);

    const first = scheduler.runDaily(NOW); // 락 잡고 대기
    const second = await scheduler.runDaily(NOW); // 겹침 → 즉시 null
    expect(second).toBeNull();

    release(report);
    await first;
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1); // 첫 사이클만 발송
  });

  it('발송 실패해도 throw 하지 않고 null 반환·락 해제(cron 유지)', async () => {
    const report = makeReport();
    let call = 0;
    const { reportService, producer, enqueueOpsAlert, recorder } = makeDeps(report, () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve(report);
    });
    const scheduler = new OpsDailyReportScheduler(reportService, producer, recorder);

    const failed = await scheduler.runDaily(NOW);
    expect(failed).toBeNull(); // 예외 흡수
    expect(enqueueOpsAlert).not.toHaveBeenCalled();

    // 락이 풀렸으므로 다음 사이클은 정상 발송.
    const ok = await scheduler.runDaily(NOW);
    expect(ok).toBe(report);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });
});
