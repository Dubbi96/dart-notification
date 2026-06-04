import { Injectable } from '@nestjs/common';
import { AiAnalysisRepository, StoredAnalysis } from '../ports/ai-analysis.repository';
import { AiTaskName, AiUsageLogParams } from '../types/ai-analyst.types';

/**
 * 개발/테스트용 인메모리 어댑터. 재시작 시 휘발한다.
 * TODO(M3, DB 가동 시): PrismaAiAnalysisRepository 로 교체
 *   — DisclosureAnalysis(rcpNo+task 복합 유니크)·AIUsageLog 모델 + 마이그레이션.
 */
@Injectable()
export class InMemoryAiAnalysisRepository extends AiAnalysisRepository {
  private readonly analyses = new Map<string, StoredAnalysis>();
  private readonly usages: Array<AiUsageLogParams & { createdAt: Date }> = [];

  private key(rcpNo: string, task: AiTaskName): string {
    return `${rcpNo}::${task}`;
  }

  async findAnalysis(rcpNo: string, task: AiTaskName): Promise<StoredAnalysis | null> {
    return this.analyses.get(this.key(rcpNo, task)) ?? null;
  }

  async saveAnalysis(analysis: StoredAnalysis): Promise<void> {
    this.analyses.set(this.key(analysis.rcpNo, analysis.task), analysis);
  }

  async saveUsage(usage: AiUsageLogParams & { createdAt: Date }): Promise<void> {
    this.usages.push(usage);
  }
}
