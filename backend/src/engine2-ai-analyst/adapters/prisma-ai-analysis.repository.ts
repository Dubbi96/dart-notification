import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AiAnalysisRepository,
  CacheHitRecord,
  StoredAnalysis,
} from '../ports/ai-analysis.repository';
import { AiTaskName, AiUsageLogParams } from '../types/ai-analyst.types';

/** AiTaskName(TS) → Prisma AiTaskName enum 변환 */
function toPrismaTask(task: AiTaskName) {
  const map: Record<AiTaskName, string> = {
    summary: 'summary',
    'event-classification': 'event_classification',
    'persona-interpretation': 'persona_interpretation',
    'position-thesis': 'position_thesis',
    'price-move-reasoning': 'price_move_reasoning',
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
    price_move_reasoning: 'price-move-reasoning',
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

  async savePersonaViews(rcpNo: string, resultJson: unknown): Promise<void> {
    // PersonaAnalysis.rcpNo 는 @unique → rcpNo 단일키 upsert(멱등). DAR-72 융합 입력 소스.
    await this.prisma.personaAnalysis.upsert({
      where: { rcpNo },
      create: { rcpNo, resultJson: resultJson as any },
      update: { resultJson: resultJson as any },
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

  /**
   * DAR-241: 멱등 캐시히트를 cacheHit=true·비용0·토큰0 행으로 기록한다.
   * getUsageSummary 가 cacheHit=false 로 필터하므로 실호출 비용 집계는 무오염.
   */
  async saveCacheHit(hit: CacheHitRecord): Promise<void> {
    await this.prisma.aIUsageLog.create({
      data: {
        rcpNo: hit.rcpNo,
        task: toPrismaTask(hit.task),
        level: hit.level as any,
        model: 'cache',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        cacheHit: true,
        createdAt: hit.createdAt,
      },
    });
  }

  async getCacheHitCount(from: Date, to: Date): Promise<number> {
    return this.prisma.aIUsageLog.count({
      where: { createdAt: { gte: from, lte: to }, cacheHit: true },
    });
  }

  async getUsageSummary(from: Date, to: Date) {
    return this.prisma.aIUsageLog.findMany({
      // DAR-241: cacheHit 행은 'AI 호출'이 아니므로 비용·L0 집계에서 제외.
      where: { createdAt: { gte: from, lte: to }, cacheHit: false },
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
