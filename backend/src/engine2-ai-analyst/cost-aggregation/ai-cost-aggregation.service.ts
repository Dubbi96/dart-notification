import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiAnalysisRepository } from '../ports/ai-analysis.repository';
import { AiTaskName, AiCostPeriodSummary } from '../types/ai-analyst.types';
import { calculateCostMetrics } from '../../engine5-trading-risk/domain/cost-metrics';

/**
 * AI 비용 집계 서비스 — 일/월 기간 집계, task/level 분류, L0 비율 산출.
 * 순수 DB 집계 + 수학 연산. AI 미개입. phase-11 AI 비용 거버넌스.
 */
@Injectable()
export class AiCostAggregationService {
  private readonly taskNames: AiTaskName[] = [
    'summary',
    'event-classification',
    'persona-interpretation',
    'position-thesis',
    'price-move-reasoning',
  ];

  private readonly prismaTaskMap: Record<AiTaskName, string> = {
    summary: 'summary',
    'event-classification': 'event_classification',
    'persona-interpretation': 'persona_interpretation',
    'position-thesis': 'position_thesis',
    'price-move-reasoning': 'price_move_reasoning',
  };

  constructor(
    private readonly repo: AiAnalysisRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getPeriodSummary(from: Date, to: Date): Promise<AiCostPeriodSummary> {
    const rows = await this.repo.getUsageSummary(from, to);
    // DAR-241: 캐시히트는 실호출 집계(rows)와 분리 — 비용·L0 분모 무오염, 적중률만 별도 노출.
    const cacheHitCount = await this.repo.getCacheHitCount(from, to);
    const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
    const totalInputTokens = rows.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = rows.reduce((s, r) => s + r.outputTokens, 0);
    const l0Count = rows.filter(r => r.level === 'L0').length;
    const l1Count = rows.filter(r => r.level === 'L1').length;
    const l2Count = rows.filter(r => r.level === 'L2').length;
    const l3Count = rows.filter(r => r.level === 'L3').length;
    // DAR-239: l0Ratio 분모는 행 수가 아니라 '공시(게이트 평가) 수'다. 비L0 공시는 task당 다중 행을
    // 남기므로(예: summary+persona) 행 기준 분모는 L0 비율을 왜곡한다. L0 행은 진입 게이트(runSummary)에서
    // 공시당 1행만 기록되고 해당 공시는 다른 행이 없으므로 l0Count는 L0 공시 수와 1:1.
    const disclosureCount = new Set(rows.map(r => r.rcpNo)).size;
    const l0Ratio = disclosureCount > 0 ? l0Count / disclosureCount : 1;

    const byTask = {} as Record<AiTaskName, { costUsd: number; callCount: number }>;
    for (const taskName of this.taskNames) {
      const prismaTask = this.prismaTaskMap[taskName];
      const taskRows = rows.filter(r => r.task === prismaTask);
      byTask[taskName] = {
        costUsd: taskRows.reduce((s, r) => s + r.costUsd, 0),
        callCount: taskRows.length,
      };
    }

    return {
      totalCostUsd,
      callCount: rows.length,
      totalInputTokens,
      totalOutputTokens,
      l0Count,
      l1Count,
      l2Count,
      l3Count,
      l0Ratio,
      byTask,
      cacheHitCount,
    };
  }

  async getDailySummary(date: Date): Promise<AiCostPeriodSummary> {
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(date);
    to.setHours(23, 59, 59, 999);
    return this.getPeriodSummary(from, to);
  }

  async getMonthlySummary(year: number, month: number): Promise<AiCostPeriodSummary> {
    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    return this.getPeriodSummary(from, to);
  }

  async getCrossEngineCostMetrics(from: Date, to: Date) {
    const rows = await this.repo.getUsageSummary(from, to);
    const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
    const totalDisclosures = new Set(rows.map(r => r.rcpNo)).size;
    const [signalCount, tradeCount] = await Promise.all([
      this.prisma.tradingSignal.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.paperTrade.count({ where: { createdAt: { gte: from, lte: to } } }),
    ]);
    const USD_TO_KRW = 1380;
    return calculateCostMetrics({
      totalDisclosures,
      totalSignals: signalCount,
      totalTrades: tradeCount,
      totalAiCostKrw: totalCostUsd * USD_TO_KRW,
      totalNetPnl: 0,
    });
  }
}
