import { Injectable, Logger } from '@nestjs/common';
import { AiCostLevel, AiCostMetrics, AiTaskName, AiUsageLogParams } from '../types/ai-analyst.types';
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

  /**
   * DAR-241: 멱등 캐시히트(비용0 재사용)를 경량 기록한다.
   * 'AI 호출'이 아니므로 logUsage(비용·토큰 기록)와 별도 경로로 — l0Ratio·비용 분모 무오염.
   * 동일 rcpNo+task 재처리(BullMQ 재시도/중복)의 캐시히트를 관측해 AI 활용률 과소보고를 해소한다.
   */
  async logCacheHit(params: {
    rcpNo: string;
    task: AiTaskName;
    level: AiCostLevel;
  }): Promise<void> {
    await this.repo.saveCacheHit({ ...params, createdAt: new Date() });
    this.logger.debug(
      `[AIUsageLog] cache-hit ${params.task}/${params.level} rcpNo=${params.rcpNo} (비용0 재사용)`,
    );
  }

  async getCostMetrics(from: Date, to: Date): Promise<AiCostMetrics> {
    const rows = await this.repo.getUsageSummary(from, to);
    const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
    const callCount = rows.length;
    const l0Count = rows.filter(r => r.level === 'L0').length;
    const disclosureCount = new Set(rows.map(r => r.rcpNo)).size;
    // DAR-239: l0Ratio 분모는 'AIUsageLog 행'이 아니라 '게이트 평가(=공시) 수'다.
    // 비L0 공시는 task당 다중 행(summary/persona/thesis)을 남기므로 행 기준 분모는 L0 비율을 구조적으로
    // 축소 왜곡한다. L0 행은 진입 게이트(runSummary)에서 공시당 1행만 기록되고 그 공시는 다른 행이 없으므로
    // l0Count는 L0 공시 수와 1:1 → l0Count/공시수 = 실제 게이트(공시 단위) L0 분포.
    const l0Ratio = disclosureCount > 0 ? l0Count / disclosureCount : 1;
    const costPerDisclosure = disclosureCount > 0 ? totalCostUsd / disclosureCount : 0;
    const cacheHitCount = await this.repo.getCacheHitCount(from, to);
    return {
      totalCostUsd,
      callCount,
      l0Ratio,
      costPerDisclosure,
      l0Warning: l0Ratio < 0.7,
      cacheHitCount,
    };
  }
}
