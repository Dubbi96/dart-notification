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

  async getCostMetrics(from: Date, to: Date): Promise<AiCostMetrics> {
    const rows = await this.repo.getUsageSummary(from, to);
    const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
    const callCount = rows.length;
    const l0Count = rows.filter(r => r.level === 'L0').length;
    const l0Ratio = callCount > 0 ? l0Count / callCount : 1;
    const disclosureCount = new Set(rows.map(r => r.rcpNo)).size;
    const costPerDisclosure = disclosureCount > 0 ? totalCostUsd / disclosureCount : 0;
    return { totalCostUsd, callCount, l0Ratio, costPerDisclosure, l0Warning: l0Ratio < 0.7 };
  }
}
