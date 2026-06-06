import { AiCostMonitorScheduler } from './ai-cost-monitor.scheduler';
import { AiCostHealthService } from './ai-cost-health.service';
import { AiCostHealthSnapshot } from '../types/ai-analyst.types';

describe('AiCostMonitorScheduler', () => {
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
      ...over,
    };
  }

  it('일일 Cron이 health 스냅샷을 집계해 반환한다', async () => {
    const snap = snapshot();
    const health = {
      getHealth: jest.fn().mockResolvedValue(snap),
    } as unknown as AiCostHealthService;
    const scheduler = new AiCostMonitorScheduler(health);

    const result = await scheduler.runDaily();
    expect(health.getHealth).toHaveBeenCalledTimes(1);
    expect(result).toBe(snap);
  });

  it('위반 시에도 스케줄러는 플래그 산출만 — 주문/Kill 의존성 없음(health만 주입)', async () => {
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
    const scheduler = new AiCostMonitorScheduler(health);

    // 유일한 협력자는 AiCostHealthService — 주문/Kill 실행 경로가 구조적으로 부재.
    const result = await scheduler.runDaily();
    expect(result.alert.violated).toBe(true);
  });
});
