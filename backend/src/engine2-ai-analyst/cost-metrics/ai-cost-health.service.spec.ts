import { ConfigService } from '@nestjs/config';
import { AiCostHealthService } from './ai-cost-health.service';
import { AiCostAggregationService } from '../cost-aggregation/ai-cost-aggregation.service';
import { AiCostLimitGuardService } from '../cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from '../usage-log/ai-usage-log.service';
import {
  AiCostLimitStatus,
  AiCostMetrics,
  AiCostPeriodSummary,
} from '../types/ai-analyst.types';

describe('AiCostHealthService', () => {
  const NOW = new Date('2026-06-06T12:00:00.000Z');

  function emptyByTask(): AiCostPeriodSummary['byTask'] {
    return {
      summary: { costUsd: 0, callCount: 0 },
      'event-classification': { costUsd: 0, callCount: 0 },
      'persona-interpretation': { costUsd: 0, callCount: 0 },
      'position-thesis': { costUsd: 0, callCount: 0 },
    };
  }

  function makeSummary(over: Partial<AiCostPeriodSummary> = {}): AiCostPeriodSummary {
    return {
      totalCostUsd: 0,
      callCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      l0Count: 0,
      l1Count: 0,
      l2Count: 0,
      l3Count: 0,
      l0Ratio: 1,
      byTask: emptyByTask(),
      ...over,
    };
  }

  function makeMetrics(over: Partial<AiCostMetrics> = {}): AiCostMetrics {
    return {
      totalCostUsd: 0,
      callCount: 0,
      l0Ratio: 1,
      costPerDisclosure: 0,
      l0Warning: false,
      ...over,
    };
  }

  function makeLimit(over: Partial<AiCostLimitStatus> = {}): AiCostLimitStatus {
    return {
      dailyCostUsd: 0,
      dailyLimitUsd: 1,
      dailyExceeded: false,
      monthlyCostUsd: 0,
      monthlyLimitUsd: 20,
      monthlyExceeded: false,
      forcedLevel: null,
      ...over,
    };
  }

  function makeService(opts: {
    daily?: AiCostPeriodSummary;
    weekly?: AiCostPeriodSummary;
    metrics?: AiCostMetrics;
    limit?: AiCostLimitStatus;
    apiKey?: string;
  }) {
    const aggregation = {
      getDailySummary: jest.fn().mockResolvedValue(opts.daily ?? makeSummary()),
      getPeriodSummary: jest.fn().mockResolvedValue(opts.weekly ?? makeSummary()),
    } as unknown as AiCostAggregationService;

    const limitGuard = {
      getLimitStatus: jest.fn().mockResolvedValue(opts.limit ?? makeLimit()),
    } as unknown as AiCostLimitGuardService;

    const usageLog = {
      getCostMetrics: jest.fn().mockResolvedValue(opts.metrics ?? makeMetrics()),
    } as unknown as AiUsageLogService;

    const config = {
      get: jest.fn().mockReturnValue(opts.apiKey),
    } as unknown as ConfigService;

    return new AiCostHealthService(aggregation, limitGuard, usageLog, config);
  }

  it('표본 0건이면 graceful 기본값으로 수용기준 모두 충족(비용0·L0=100%)', async () => {
    const svc = makeService({ apiKey: 'sk-test' });
    const health = await svc.getHealth(NOW);

    expect(health.acceptance.costOk).toBe(true);
    expect(health.acceptance.l0Ok).toBe(true);
    expect(health.acceptance.allOk).toBe(true);
    expect(health.alert.violated).toBe(false);
    expect(health.alert.reasons).toEqual([]);
    expect(health.llmKeyConfigured).toBe(true);
  });

  it('LLM_API_KEY 미설정이어도 throw 없이 과거 집계로 동작 (graceful skip)', async () => {
    const svc = makeService({
      apiKey: undefined,
      weekly: makeSummary({ callCount: 4, l0Count: 3, l0Ratio: 0.75 }),
      metrics: makeMetrics({ callCount: 4, costPerDisclosure: 0.001 }),
    });
    const health = await svc.getHealth(NOW);

    expect(health.llmKeyConfigured).toBe(false);
    expect(health.acceptance.allOk).toBe(true);
    expect(health.weekly.l0Ratio).toBeCloseTo(0.75, 5);
  });

  it('수용기준 위반: 비용 초과 + L0 비율 미달이면 alert.violated와 사유 산출', async () => {
    const svc = makeService({
      apiKey: 'sk-test',
      weekly: makeSummary({ callCount: 10, l0Count: 4, l0Ratio: 0.4 }),
      metrics: makeMetrics({ callCount: 10, costPerDisclosure: 0.012 }),
    });
    const health = await svc.getHealth(NOW);

    expect(health.acceptance.costOk).toBe(false);
    expect(health.acceptance.l0Ok).toBe(false);
    expect(health.acceptance.allOk).toBe(false);
    expect(health.alert.violated).toBe(true);
    expect(health.alert.reasons).toHaveLength(2);
    expect(health.alert.reasons.join(' ')).toContain('공시당');
    expect(health.alert.reasons.join(' ')).toContain('L0');
  });

  it('한도 초과 시 사용률과 alert 사유에 반영', async () => {
    const svc = makeService({
      apiKey: 'sk-test',
      limit: makeLimit({
        dailyCostUsd: 1.2,
        dailyExceeded: true,
        monthlyCostUsd: 5,
      }),
    });
    const health = await svc.getHealth(NOW);

    expect(health.limitUsage.dailyUsedRatio).toBeCloseTo(1.2, 5);
    expect(health.limitUsage.monthlyUsedRatio).toBeCloseTo(0.25, 5);
    expect(health.alert.violated).toBe(true);
    expect(health.alert.reasons.join(' ')).toContain('일일');
  });

  it('임계값 경계: costPerDisclosure가 정확히 임계값이면 위반(미만만 통과)', async () => {
    const svc = makeService({
      apiKey: 'sk-test',
      weekly: makeSummary({ callCount: 5, l0Count: 5, l0Ratio: 1 }),
      metrics: makeMetrics({ callCount: 5, costPerDisclosure: 0.005 }),
    });
    const health = await svc.getHealth(NOW);

    expect(health.acceptance.costThresholdUsd).toBe(0.005);
    expect(health.acceptance.costOk).toBe(false);
    expect(health.acceptance.l0ThresholdRatio).toBe(0.7);
  });
});
