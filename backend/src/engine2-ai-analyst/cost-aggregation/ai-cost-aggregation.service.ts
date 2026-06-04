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
  ];

  private readonly prismaTaskMap: Record<AiTaskName, string> = {
    summary: 'summary',
    'event-classification': 'event_classification',
    'persona-interpretation': 'persona_interpretation',
    'position-thesis': 'position_thesis',
  };

  constructor(
    private readonly repo: AiAnalysisRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getPeriodSummary(from: Date, to: Date): Promise<AiCostPeriodSummary> {
    const rows = await this.repo.getUsageSummary(from, to);
    const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
    const totalInputTokens = rows.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = rows.reduce((s, r) => s + r.outputTokens, 0);
    const l0Count = rows.filter(r => r.level === 'L0').length;
    const l1Count = rows.filter(r => r.level === 'L1').length;
    const l2Count = rows.filter(r => r.level === 'L2').length;
    const l3Count = rows.filter(r => r.level === 'L3').length;
    const l0Ratio = rows.length > 0 ? l0Count / rows.length : 1;

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
