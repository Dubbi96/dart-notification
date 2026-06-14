import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostLevel, AiCostLimitStatus } from '../types/ai-analyst.types';
import { kstDayStart, kstMonthStart } from '../../common/time/kst';

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
    // 한도 윈도 경계는 KST 벽시계 자정/월초로 고정한다(DAR-243). createdAt은
    // Prisma 기본 UTC 저장이므로 로컬 TZ setHours/생성자로 만든 경계는 UTC
    // 컨테이너에서 9시간 어긋나 일/월 한도를 오산정한다.
    const now = new Date();
    const dayStart = kstDayStart(now);
    const monthStart = kstMonthStart(now);

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
