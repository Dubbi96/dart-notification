import { Queue } from 'bullmq';
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
    // DAR-89: AI_ANALYZE 큐 mock. undefined=미주입(graceful null), 'throws'=조회 실패.
    queue?: { failed: number; delayed?: number; active?: number; waiting?: number } | 'throws';
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

    let queue: Queue | null = null;
    if (opts.queue === 'throws') {
      queue = {
        getJobCounts: jest.fn().mockRejectedValue(new Error('Redis 연결 실패')),
      } as unknown as Queue;
    } else if (opts.queue) {
      queue = {
        getJobCounts: jest.fn().mockResolvedValue({
          failed: opts.queue.failed,
          delayed: opts.queue.delayed ?? 0,
          active: opts.queue.active ?? 0,
          waiting: opts.queue.waiting ?? 0,
        }),
      } as unknown as Queue;
    }

    return new AiCostHealthService(aggregation, limitGuard, usageLog, config, queue);
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

  // ── DAR-89: AI_ANALYZE 큐 상태(실패 잡 수) 노출 ──────────────────────────────
  describe('queue 스냅샷(DAR-89)', () => {
    it('큐 미주입이면 queue=null(graceful) — health 본체는 정상 동작', async () => {
      const svc = makeService({ apiKey: 'sk-test' }); // queue 미지정
      const health = await svc.getHealth(NOW);

      expect(health.queue).toBeNull();
      expect(health.acceptance.allOk).toBe(true); // 본체 영향 없음(회귀 0)
    });

    it('removeOnFail 보존분(실패 잡 수)을 queue 스냅샷에 노출', async () => {
      const svc = makeService({
        apiKey: 'sk-test',
        queue: { failed: 3, delayed: 2, active: 1, waiting: 5 },
      });
      const health = await svc.getHealth(NOW);

      expect(health.queue).toEqual({
        name: 'ai-analyze',
        failed: 3,
        delayed: 2,
        active: 1,
        waiting: 5,
      });
    });

    it('실패 잡 0건이면 failed=0으로 정상 노출', async () => {
      const svc = makeService({ apiKey: 'sk-test', queue: { failed: 0 } });
      const health = await svc.getHealth(NOW);

      expect(health.queue?.failed).toBe(0);
      expect(health.queue?.name).toBe('ai-analyze');
    });

    it('큐 조회 실패(Redis 미가용)면 throw 없이 queue=null(graceful)', async () => {
      const svc = makeService({ apiKey: 'sk-test', queue: 'throws' });
      const health = await svc.getHealth(NOW);

      expect(health.queue).toBeNull();
      // 큐 실패가 비용 health 산출을 깨지 않는다.
      expect(health.acceptance.allOk).toBe(true);
      expect(health.alert.violated).toBe(false);
    });
  });
});
