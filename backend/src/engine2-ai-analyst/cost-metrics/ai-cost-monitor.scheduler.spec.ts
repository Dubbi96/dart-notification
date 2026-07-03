import { AiCostMonitorScheduler } from './ai-cost-monitor.scheduler';
import { AiCostHealthService } from './ai-cost-health.service';
import { AiCostHealthSnapshot } from '../types/ai-analyst.types';
import { NotificationProducerService } from '../../notifications/notification-producer.service';

describe('AiCostMonitorScheduler', () => {
  // DAR-476(P02): 위반 시 OPS_ALERT 발송 — producer 목으로 관측(주문/Kill 경로 없음).
  function makeProducer() {
    return { enqueueOpsAlert: jest.fn().mockResolvedValue(undefined) };
  }

  function snapshot(over: Partial<AiCostHealthSnapshot> = {}): AiCostHealthSnapshot {
    return {
      evaluatedAt: '2026-06-06T00:00:00.000Z',
      llmKeyConfigured: true,
      acceptance: {
        costPerDisclosureUsd: 0.001,
        costThresholdUsd: 0.005,
        costOk: true,
        l0Ratio: 0.9,
        l0ThresholdRatio: 0.7,
        l0Ok: true,
        allOk: true,
      },
      daily: {
        totalCostUsd: 0.01,
        callCount: 2,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        l0Count: 0,
        l1Count: 0,
        l2Count: 2,
        l3Count: 0,
        l0Ratio: 0,
        byTask: {
          summary: { costUsd: 0, callCount: 0 },
          'event-classification': { costUsd: 0, callCount: 0 },
          'persona-interpretation': { costUsd: 0, callCount: 0 },
          'position-thesis': { costUsd: 0, callCount: 0 },
        },
        cacheHitCount: 0,
      },
      weekly: {
        totalCostUsd: 0.05,
        callCount: 10,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        l0Count: 9,
        l1Count: 0,
        l2Count: 1,
        l3Count: 0,
        l0Ratio: 0.9,
        byTask: {
          summary: { costUsd: 0, callCount: 0 },
          'event-classification': { costUsd: 0, callCount: 0 },
          'persona-interpretation': { costUsd: 0, callCount: 0 },
          'position-thesis': { costUsd: 0, callCount: 0 },
        },
        cacheHitCount: 0,
      },
      weekFrom: '2026-05-31T00:00:00.000Z',
      weekTo: '2026-06-06T00:00:00.000Z',
      limit: {
        dailyCostUsd: 0.01,
        dailyLimitUsd: 1,
        dailyExceeded: false,
        monthlyCostUsd: 0.05,
        monthlyLimitUsd: 20,
        monthlyExceeded: false,
        forcedLevel: null,
      },
      limitUsage: { dailyUsedRatio: 0.01, monthlyUsedRatio: 0.0025 },
      alert: { violated: false, reasons: [] },
      queue: null, // DAR-89: 큐 스냅샷(테스트 기본 null)
      ...over,
    };
  }

  it('일일 Cron이 health 스냅샷을 집계해 반환한다', async () => {
    const snap = snapshot();
    const health = {
      getHealth: jest.fn().mockResolvedValue(snap),
    } as unknown as AiCostHealthService;
    const producer = makeProducer();
    const scheduler = new AiCostMonitorScheduler(
      health,
      producer as unknown as NotificationProducerService,
    );

    const result = await scheduler.runDaily();
    expect(health.getHealth).toHaveBeenCalledTimes(1);
    expect(result).toBe(snap);
    // 위반 없음 → OPS_ALERT 미발송.
    expect(producer.enqueueOpsAlert).not.toHaveBeenCalled();
  });

  it('DAR-476: 위반 시 OPS_ALERT 발송 — 주문/Kill 경로는 여전히 없음(관측·알림만)', async () => {
    const violatedSnap = snapshot({
      acceptance: {
        costPerDisclosureUsd: 0.02,
        costThresholdUsd: 0.005,
        costOk: false,
        l0Ratio: 0.4,
        l0ThresholdRatio: 0.7,
        l0Ok: false,
        allOk: false,
      },
      alert: { violated: true, reasons: ['공시당 평균 비용 초과', 'L0 비율 미달'] },
    });
    const health = {
      getHealth: jest.fn().mockResolvedValue(violatedSnap),
    } as unknown as AiCostHealthService;
    const producer = makeProducer();
    const scheduler = new AiCostMonitorScheduler(
      health,
      producer as unknown as NotificationProducerService,
    );

    const result = await scheduler.runDaily();
    expect(result.alert.violated).toBe(true);
    // 위반 → OPS_ALERT 1회(WARNING·source 'ai-cost-monitor'·일자 dedupe). 자동 조치 없음.
    expect(producer.enqueueOpsAlert).toHaveBeenCalledTimes(1);
    const [severity, source, message, meta] =
      producer.enqueueOpsAlert.mock.calls[0];
    expect(severity).toBe('WARNING');
    expect(source).toBe('ai-cost-monitor');
    expect(message).toContain('공시당 평균 비용 초과');
    expect(meta.dedupeKey).toBe('ai-cost-monitor:violation:2026-06-06');
  });
});
