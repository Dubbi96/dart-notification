import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ThesisStatus = 'ACTIVE' | 'WATCHING' | 'VIOLATED' | 'EXPIRED';

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  async findUserPositions(userId: string) {
    const positions = await this.prisma.position.findMany({
      where: { portfolio: { userId }, status: 'OPEN' },
      include: {
        company: { select: { corpName: true, stockCode: true } },
        portfolio: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return positions.map((pos) => ({
      id: pos.id,
      portfolioId: pos.portfolio.id,
      corpCode: pos.corpCode,
      corpName: pos.company.corpName,
      ticker: pos.company.stockCode ?? undefined,
      pnlPercent: pos.unrealizedPnlPct ?? 0,
      thesisStatus: (pos.positionThesisId ? 'ACTIVE' : 'ACTIVE') as ThesisStatus,
      quantity: pos.quantity,
      avgPrice: pos.entryPrice,
      currentPrice: pos.currentPrice ?? undefined,
    }));
  }

  async findPortfolioSummary(userId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { userId, isActive: true },
      include: {
        riskSnapshots: { orderBy: { snapshotDate: 'desc' }, take: 1 },
      },
    });

    const agg = await this.prisma.position.aggregate({
      where: { portfolio: { userId }, status: 'OPEN' },
      _sum: { currentValue: true, unrealizedPnl: true },
    });

    const totalValue = agg._sum.currentValue ?? 0;
    const totalPnl = agg._sum.unrealizedPnl ?? 0;
    const totalPnlPercent = totalValue > 0 ? (totalPnl / totalValue) * 100 : 0;

    const latestSnapshot = portfolio?.riskSnapshots?.[0];

    return {
      totalValue,
      totalPnl,
      totalPnlPercent,
      mddPercent: latestSnapshot?.unrealizedPnlPct !== undefined
        ? Math.min(latestSnapshot.unrealizedPnlPct, 0)
        : undefined,
      dailyLossLimitRemaining: portfolio?.maxDailyLossPct ?? undefined,
      mddBreached: latestSnapshot?.hardRuleBreached ?? false,
    };
  }

  async findPosition(userId: string, positionId: string) {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, portfolio: { userId } },
      include: {
        company: { select: { corpName: true, stockCode: true } },
        portfolio: { select: { id: true } },
      },
    });

    if (!pos) {
      throw new NotFoundException('Position not found');
    }

    return {
      id: pos.id,
      portfolioId: pos.portfolio.id,
      corpCode: pos.corpCode,
      corpName: pos.company.corpName,
      ticker: pos.company.stockCode ?? undefined,
      pnlPercent: pos.unrealizedPnlPct ?? 0,
      thesisStatus: (pos.positionThesisId ? 'ACTIVE' : 'ACTIVE') as ThesisStatus,
      quantity: pos.quantity,
      avgPrice: pos.entryPrice,
      currentPrice: pos.currentPrice ?? undefined,
    };
  }
}
