import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiAnalysisRepository, StoredAnalysis } from '../ports/ai-analysis.repository';
import { AiTaskName, AiUsageLogParams } from '../types/ai-analyst.types';

/** AiTaskName(TS) → Prisma AiTaskName enum 변환 */
function toPrismaTask(task: AiTaskName) {
  const map: Record<AiTaskName, string> = {
    summary: 'summary',
    'event-classification': 'event_classification',
    'persona-interpretation': 'persona_interpretation',
    'position-thesis': 'position_thesis',
  };
  return map[task] as any;
}

/** Prisma AiTaskName → TS AiTaskName 변환 */
function fromPrismaTask(task: string): AiTaskName {
  const map: Record<string, AiTaskName> = {
    summary: 'summary',
    event_classification: 'event-classification',
    persona_interpretation: 'persona-interpretation',
    position_thesis: 'position-thesis',
  };
  return map[task];
}

@Injectable()
export class PrismaAiAnalysisRepository extends AiAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findAnalysis(rcpNo: string, task: AiTaskName): Promise<StoredAnalysis | null> {
    const row = await this.prisma.disclosureAnalysis.findUnique({
      where: { rcpNo_task: { rcpNo, task: toPrismaTask(task) } },
    });
    if (!row) return null;
    return {
      rcpNo: row.rcpNo,
      task: fromPrismaTask(row.task),
      level: row.level as any,
      resultJson: row.resultJson,
      createdAt: row.createdAt,
    };
  }

  async saveAnalysis(analysis: StoredAnalysis): Promise<void> {
    await this.prisma.disclosureAnalysis.upsert({
      where: { rcpNo_task: { rcpNo: analysis.rcpNo, task: toPrismaTask(analysis.task) } },
      create: {
        rcpNo: analysis.rcpNo,
        task: toPrismaTask(analysis.task),
        level: analysis.level as any,
        resultJson: analysis.resultJson as any,
      },
      update: {
        level: analysis.level as any,
        resultJson: analysis.resultJson as any,
      },
    });
  }

  async saveUsage(usage: AiUsageLogParams & { createdAt: Date }): Promise<void> {
    await this.prisma.aIUsageLog.create({
      data: {
        rcpNo: usage.rcpNo,
        task: toPrismaTask(usage.task),
        level: usage.level as any,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        createdAt: usage.createdAt,
      },
    });
  }

  async getUsageSummary(from: Date, to: Date) {
    return this.prisma.aIUsageLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        task: true,
        level: true,
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
        rcpNo: true,
      },
    });
  }
}
