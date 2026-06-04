import { Injectable, Logger } from '@nestjs/common';
import { AiCostMetrics, AiUsageLogParams } from '../types/ai-analyst.types';
import { AiAnalysisRepository } from '../ports/ai-analysis.repository';

/**
 * AI 호출 비용·토큰 기록 (비용 거버넌스의 토대).
 * 모든 AI 호출 직후 logUsage()를 호출한다 — 기록 누락 0이 회귀 매트릭스 항목.
 * 영속은 AiAnalysisRepository 포트로 위임(현재 인메모리, 다음 증분에서 Prisma/AIUsageLog).
 */
@Injectable()
export class AiUsageLogService {
  private readonly logger = new Logger(AiUsageLogService.name);

  constructor(private readonly repo: AiAnalysisRepository) {}

  async logUsage(params: AiUsageLogParams): Promise<void> {
    await this.repo.saveUsage({ ...params, createdAt: new Date() });
    this.logger.debug(
      `[AIUsageLog] ${params.task}/${params.level} rcpNo=${params.rcpNo} ` +
        `cost=$${params.costUsd.toFixed(4)} tokens=${params.inputTokens}+${params.outputTokens}`,
    );
  }

  async getCostMetrics(_from: Date, _to: Date): Promise<AiCostMetrics> {
    // TODO(M3, DB 가동 시): AIUsageLog 집계 — L0 비율 ≥70% / 비용·순익 ≤20% 모니터링
    return { totalCostUsd: 0, callCount: 0, l0Ratio: 1, costPerDisclosure: 0 };
  }
}
