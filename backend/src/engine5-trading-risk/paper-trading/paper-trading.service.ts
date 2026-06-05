import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PaperTradingService {
  constructor(private readonly prisma: PrismaService) {}

  async findPortfolio(_userId: string) {
    const trades = await this.prisma.paperTrade.findMany({
      include: {
        company: { select: { corpName: true, stockCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const totalPnl = trades.reduce((sum, t) => sum + Number(t.netPnl ?? 0), 0);
    const startedAt =
      trades.length > 0
        ? (trades[trades.length - 1].entryDate?.toISOString() ?? new Date().toISOString())
        : new Date().toISOString();

    return {
      totalAsset: 0,
      totalPnl,
      totalPnlPercent: 0,
      startedAt,
      elapsedDays: 0,
      positions: [],
      trades: trades.map((t) => ({
        id: t.id,
        date: t.entryDate.toISOString(),
        corpName: t.company?.corpName ?? '',
        side: t.direction as 'BUY' | 'SELL',
        price: Number(t.filledPrice ?? t.entryPrice),
        quantity: t.filledShares,
        pnl: t.netPnl ? Number(t.netPnl) : undefined,
        pnlPercent: t.returnPct ? Number(t.returnPct) : undefined,
      })),
      started: trades.length > 0,
    };
  }
}
