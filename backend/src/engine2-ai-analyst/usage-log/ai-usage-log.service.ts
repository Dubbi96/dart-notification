import { Injectable, Logger } from '@nestjs/common';
import { AiCostMetrics, AiUsageLogParams } from '../types/ai-analyst.types';

/**
 * AI 호출 비용·토큰 기록 (비용 거버넌스의 토대).
 * 모든 AI 호출 래퍼는 호출 직후 logUsage()를 반드시 부른다 — 기록 누락 0이 회귀 매트릭스 항목.
 *
 * TODO(M3): `AIUsageLog` Prisma 모델 추가 후 PrismaService 주입하여 영속화.
 *           rcpNo + task 복합 유니크로 멱등 보장. (backend/prisma/CLAUDE.md 절차 준수)
 */
@Injectable()
export class AiUsageLogService {
  private readonly logger = new Logger(AiUsageLogService.name);

  async logUsage(params: AiUsageLogParams): Promise<void> {
    // TODO(M3): prisma.aIUsageLog.upsert({ where: { rcpNo_task }, ... })
    this.logger.debug(
      `[AIUsageLog] ${params.task}/${params.level} rcpNo=${params.rcpNo} ` +
        `cost=$${params.costUsd.toFixed(4)} tokens=${params.inputTokens}+${params.outputTokens}`,
    );
  }

  async getCostMetrics(_from: Date, _to: Date): Promise<AiCostMetrics> {
    // TODO(M3): AIUsageLog 집계 — L0 비율 70%+ / 비용/순익 ≤ 20% 모니터링
    return { totalCostUsd: 0, callCount: 0, l0Ratio: 1, costPerDisclosure: 0 };
  }
}
