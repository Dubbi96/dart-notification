import { DataFreshnessMonitorScheduler } from './data-freshness-monitor.scheduler';
import { DataFreshnessService } from './data-freshness.service';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { FreshnessReport } from './freshness';

/**
 * DAR-476(P02): 신선도 정체 전환 알림의 에지 트리거/디바운스 계약 검증.
 */
describe('DataFreshnessMonitorScheduler', () => {
  function report(over: Partial<FreshnessReport> = {}): FreshnessReport {
    const staleJobs = over.staleJobs ?? [];
    return {
      generatedAt: '2026-07-03T05:00:00.000Z',
      anyStale: staleJobs.length > 0,
      staleJobs,
      jobs: staleJobs.map((jobKey) => ({
        jobKey,
        label: `라벨:${jobKey}`,
        cadence: 'INTRADAY',
        lastSuccessAt: null,
        lastStatus: 'FAILED',
        lastItemCount: null,
        applicable: true,
        isStale: true,
        ageMinutes: 999,
        reason: '정체',
      })),
      ...over,
    } as FreshnessReport;
  }

  function make(reports: FreshnessReport[]) {
    let i = 0;
    const freshness = {
      getFreshness: jest.fn().mockImplementation(() =>
        Promise.resolve(reports[Math.min(i++, reports.length - 1)]),
      ),
    } as unknown as DataFreshnessService;
    const producer = {
      enqueueOpsAlert: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new DataFreshnessMonitorScheduler(
      freshness,
      producer as unknown as NotificationProducerService,
    );
    return { scheduler, producer };
  }

  it('정상→정체 상승 에지에서만 OPS_ALERT 1회(정체잡 라벨·source cron-freshness)', async () => {
    const { scheduler, producer } = make([report({ staleJobs: ['daily-price'] })]);

    await scheduler.runCheck();

    expect(producer.enqueueOpsAlert).toHaveBeenCalledTimes(1);
    const [severity, source, message, meta] =
      producer.enqueueOpsAlert.mock.calls[0];
    expect(severity).toBe('WARNING'); // 1개 stale → WARNING
    expect(source).toBe('cron-freshness');
    expect(message).toContain('라벨:daily-price');
    expect(meta.dedupeKey).toBe('cron-freshness:2026-07-03:daily-price');
  });

  it('정체 지속(에지 없음)에는 재발송하지 않는다(디바운스)', async () => {
    const stale = report({ staleJobs: ['daily-price'] });
    const { scheduler, producer } = make([stale, stale, stale]);

    await scheduler.runCheck(); // 상승 에지 → 1회
    await scheduler.runCheck(); // 지속 → 무발송
    await scheduler.runCheck(); // 지속 → 무발송

    expect(producer.enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('정상 복귀 후 재정체면 다시 발송(재무장)', async () => {
    const stale = report({ staleJobs: ['daily-price'] });
    const ok = report({ staleJobs: [] });
    const { scheduler, producer } = make([stale, ok, stale]);

    await scheduler.runCheck(); // 상승 에지 → 1회
    await scheduler.runCheck(); // 복귀 → 무발송·재무장
    await scheduler.runCheck(); // 재정체 상승 에지 → 1회

    expect(producer.enqueueOpsAlert).toHaveBeenCalledTimes(2);
  });

  it('정체 없음이면 무발송', async () => {
    const { scheduler, producer } = make([report({ staleJobs: [] })]);
    await scheduler.runCheck();
    expect(producer.enqueueOpsAlert).not.toHaveBeenCalled();
  });

  it('정체잡 3개 이상이면 severity ERROR', async () => {
    const { scheduler, producer } = make([
      report({ staleJobs: ['a', 'b', 'c'] }),
    ]);
    await scheduler.runCheck();
    const [severity] = producer.enqueueOpsAlert.mock.calls[0];
    expect(severity).toBe('ERROR');
  });
});
