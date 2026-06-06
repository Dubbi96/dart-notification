import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { AiCostAggregationService } from '../cost-aggregation/ai-cost-aggregation.service';
import { AiCostLimitGuardService } from '../cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from '../usage-log/ai-usage-log.service';
import { AiCostHealthSnapshot } from '../types/ai-analyst.types';
import { QUEUE, AiQueueHealth } from '../../common/queues/queue.constants';

/**
 * 라이브 AI 비용게이트 상시 모니터링 (DAR-75).
 *
 * 수동 스모크(live-llm-smoke.ts: 비용<$0.005/건·L0≥70%)의 수용 기준을
 * 과거 AIUsageLog 집계 기반의 health 스냅샷으로 승격한다 — 'G3 수익 대비 AI비용' 실시간 방어.
 *
 * 안전 설계:
 *  - LLM 미호출: 순수 DB(AIUsageLog) 집계 + 한도 가드만 사용 → LLM_API_KEY 없어도 graceful 동작.
 *  - 산출하는 alert는 운영 알림 플래그 전용. ★실주문·Kill Switch에 직접 연결 절대 금지(휴먼 승인 경계).
 */
@Injectable()
export class AiCostHealthService {
  private readonly logger = new Logger(AiCostHealthService.name);

  /** 수용 기준: 공시당 평균 AI 비용 상한 (live-llm-smoke 동일 기준) */
  static readonly COST_PER_DISCLOSURE_THRESHOLD_USD = 0.005;
  /** 수용 기준: L0(미사용) 비율 하한 */
  static readonly L0_RATIO_THRESHOLD = 0.7;
  /** 수용 기준 평가 표본 윈도우 (최근 N일, 당일 포함) */
  static readonly ACCEPTANCE_WINDOW_DAYS = 7;

  constructor(
    private readonly aggregation: AiCostAggregationService,
    private readonly limitGuard: AiCostLimitGuardService,
    private readonly usageLog: AiUsageLogService,
    private readonly config: ConfigService,
    // DAR-89: AI_ANALYZE 큐 상태(실패 잡 수) 관측용. Redis/큐 미주입 시 null → graceful.
    @Optional() @InjectQueue(QUEUE.AI_ANALYZE) private readonly aiQueue: Queue | null = null,
  ) {}

  async getHealth(now: Date = new Date()): Promise<AiCostHealthSnapshot> {
    // 키 미설정이어도 throw 없이 false 노출 — 집계 자체는 LLM에 의존하지 않음 (graceful skip).
    const llmKeyConfigured = !!this.config.get<string>('LLM_API_KEY');

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (AiCostHealthService.ACCEPTANCE_WINDOW_DAYS - 1));
    weekStart.setHours(0, 0, 0, 0);

    const [daily, weekly, metrics, limit, queue] = await Promise.all([
      this.aggregation.getDailySummary(now),
      this.aggregation.getPeriodSummary(weekStart, now),
      this.usageLog.getCostMetrics(weekStart, now),
      this.limitGuard.getLimitStatus(),
      this.getQueueHealth(),
    ]);

    const costThresholdUsd = AiCostHealthService.COST_PER_DISCLOSURE_THRESHOLD_USD;
    const l0ThresholdRatio = AiCostHealthService.L0_RATIO_THRESHOLD;
    // 표본 0건이면 비용 0·L0 1.0 → 두 기준 모두 충족(graceful 기본값).
    const costOk = metrics.costPerDisclosure < costThresholdUsd;
    const l0Ok = weekly.l0Ratio >= l0ThresholdRatio;

    const reasons: string[] = [];
    if (!costOk) {
      reasons.push(
        `공시당 평균 비용 $${metrics.costPerDisclosure.toFixed(5)} ≥ $${costThresholdUsd}`,
      );
    }
    if (!l0Ok) {
      reasons.push(
        `L0 비율 ${(weekly.l0Ratio * 100).toFixed(0)}% < ${(l0ThresholdRatio * 100).toFixed(0)}%`,
      );
    }
    if (limit.dailyExceeded) reasons.push('일일 비용 한도 초과');
    if (limit.monthlyExceeded) reasons.push('월간 비용 한도 초과');

    return {
      evaluatedAt: now.toISOString(),
      llmKeyConfigured,
      acceptance: {
        costPerDisclosureUsd: metrics.costPerDisclosure,
        costThresholdUsd,
        costOk,
        l0Ratio: weekly.l0Ratio,
        l0ThresholdRatio,
        l0Ok,
        allOk: costOk && l0Ok,
      },
      daily,
      weekly,
      weekFrom: weekStart.toISOString(),
      weekTo: now.toISOString(),
      limit,
      limitUsage: {
        dailyUsedRatio: limit.dailyLimitUsd > 0 ? limit.dailyCostUsd / limit.dailyLimitUsd : 0,
        monthlyUsedRatio:
          limit.monthlyLimitUsd > 0 ? limit.monthlyCostUsd / limit.monthlyLimitUsd : 0,
      },
      alert: { violated: reasons.length > 0, reasons },
      queue,
    };
  }

  /**
   * DAR-89: AI_ANALYZE 큐 상태(실패 잡 수 등) 조회. removeOnFail 보존분(재시도
   * 소진 후 실패 잡)을 노출해 라이브 AI 잡 유실을 관측한다.
   *
   * graceful: 큐 미주입(Redis 미설정 테스트/환경)이거나 getJobCounts 실패 시
   * null 반환 — health 본체는 DB 집계로 동작하므로 throw 하지 않는다.
   */
  private async getQueueHealth(): Promise<AiQueueHealth | null> {
    if (!this.aiQueue) return null;
    try {
      const counts = await this.aiQueue.getJobCounts(
        'failed',
        'delayed',
        'active',
        'waiting',
      );
      return {
        name: QUEUE.AI_ANALYZE,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        active: counts.active ?? 0,
        waiting: counts.waiting ?? 0,
      };
    } catch (err) {
      this.logger.warn(
        `AI_ANALYZE 큐 상태 조회 실패(graceful, null 노출): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
