import { Injectable } from '@nestjs/common';
import {
  AiAnalysisRepository,
  CacheHitRecord,
  StoredAnalysis,
} from '../ports/ai-analysis.repository';
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
  /** DAR-241: 캐시히트 기록(비용0 재사용). 실호출 usages 와 분리 — getUsageSummary 무오염. */
  private readonly cacheHits: CacheHitRecord[] = [];
  /** PersonaAnalysis 영속 모사 (rcpNo → resultJson). DAR-78 융합 입력 검증용. */
  private readonly personaViews = new Map<string, unknown>();

  private key(rcpNo: string, task: AiTaskName): string {
    return `${rcpNo}::${task}`;
  }

  async findAnalysis(rcpNo: string, task: AiTaskName): Promise<StoredAnalysis | null> {
    return this.analyses.get(this.key(rcpNo, task)) ?? null;
  }

  async saveAnalysis(analysis: StoredAnalysis): Promise<void> {
    this.analyses.set(this.key(analysis.rcpNo, analysis.task), analysis);
  }

  async savePersonaViews(rcpNo: string, resultJson: unknown): Promise<void> {
    this.personaViews.set(rcpNo, resultJson);
  }

  /** 테스트 전용 — 영속된 PersonaAnalysis 조회. */
  async findPersonaViews(rcpNo: string): Promise<unknown | null> {
    return this.personaViews.has(rcpNo) ? this.personaViews.get(rcpNo) : null;
  }

  async saveUsage(usage: AiUsageLogParams & { createdAt: Date }): Promise<void> {
    this.usages.push(usage);
  }

  async saveCacheHit(hit: CacheHitRecord): Promise<void> {
    this.cacheHits.push(hit);
  }

  async getCacheHitCount(from: Date, to: Date): Promise<number> {
    return this.cacheHits.filter(h => h.createdAt >= from && h.createdAt <= to).length;
  }

  async getUsageSummary(from: Date, to: Date) {
    const taskMap: Record<AiTaskName, string> = {
      summary: 'summary',
      'event-classification': 'event_classification',
      'persona-interpretation': 'persona_interpretation',
      'position-thesis': 'position_thesis',
      'price-move-reasoning': 'price_move_reasoning',
    };
    return this.usages
      .filter(u => u.createdAt >= from && u.createdAt <= to)
      .map(u => ({
        task: taskMap[u.task] ?? u.task,
        level: u.level as string,
        costUsd: u.costUsd,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        rcpNo: u.rcpNo,
      }));
  }
}
