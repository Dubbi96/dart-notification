import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostLevel, AiCostLimitStatus } from '../types/ai-analyst.types';

/**
 * AI 비용 한도 가드 — 순수 Rule (AI 미개입).
 * 일/월 누적 비용이 한도 초과 시 AiCostLevel.L0으로 강등한다.
 * phase-11 AI 비용 거버넌스 구현체.
 */
@Injectable()
export class AiCostLimitGuardService {
  static readonly DAILY_LIMIT_USD = 1.0;
  static readonly MONTHLY_LIMIT_USD = 20.0;

  constructor(private readonly prisma: PrismaService) {}

  async getLimitStatus(): Promise<AiCostLimitStatus> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const [dailyAgg, monthlyAgg] = await Promise.all([
      this.prisma.aIUsageLog.aggregate({
        where: { createdAt: { gte: dayStart } },
        _sum: { costUsd: true },
      }),
      this.prisma.aIUsageLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
      }),
    ]);

    const dailyCostUsd = dailyAgg._sum.costUsd ?? 0;
    const monthlyCostUsd = monthlyAgg._sum.costUsd ?? 0;
    const dailyExceeded = dailyCostUsd >= AiCostLimitGuardService.DAILY_LIMIT_USD;
    const monthlyExceeded = monthlyCostUsd >= AiCostLimitGuardService.MONTHLY_LIMIT_USD;
    const forcedLevel = dailyExceeded || monthlyExceeded ? AiCostLevel.L0 : null;

    return {
      dailyCostUsd,
      dailyLimitUsd: AiCostLimitGuardService.DAILY_LIMIT_USD,
      dailyExceeded,
      monthlyCostUsd,
      monthlyLimitUsd: AiCostLimitGuardService.MONTHLY_LIMIT_USD,
      monthlyExceeded,
      forcedLevel,
    };
  }

  async enforceLimit(proposedLevel: AiCostLevel): Promise<AiCostLevel> {
    const status = await this.getLimitStatus();
    if (status.forcedLevel !== null) {
      return status.forcedLevel;
    }
    return proposedLevel;
  }
}
