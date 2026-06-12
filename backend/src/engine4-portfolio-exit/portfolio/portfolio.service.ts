import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ThesisStatus = 'ACTIVE' | 'WATCHING' | 'VIOLATED' | 'EXPIRED';

/**
 * 최신 포트폴리오 리스크 스냅샷 읽기 응답.
 * PortfolioRiskSnapshot 모델(읽기 전용)을 화면 친화 형태로 노출한다.
 * 스냅샷 부재 시 컨트롤러는 `null`을 반환한다.
 */
export interface PortfolioRiskSnapshotView {
  portfolioId: string;
  snapshotDate: string;
  totalValue: number;
  cashAmount: number | null;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  topPositionPct: number;
  topSectorPct: number | null;
  openPositionCount: number;
  dailyPnl: number | null;
  dailyPnlPct: number | null;
  weeklyPnl: number | null;
  weeklyPnlPct: number | null;
  riskLevel: string;
  hardRuleBreached: boolean;
  hardRuleDetail: string | null;
}

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
      _sum: { currentValue: true, unrealizedPnl: true, entryAmount: true },
    });

    const totalValue = agg._sum.currentValue ?? 0;
    const totalPnl = agg._sum.unrealizedPnl ?? 0;
    // 수익률 정의는 (평가금액-원가)/원가 = 손익/원가. 분모는 평가금액이 아니라 원가(entryAmount 합)여야 한다.
    // 평가금액을 분모로 쓰면 이익은 과소·손실은 과대 평가된다(예: 원가100→평가50, 정답 -50%인데 -100%).
    const totalCost = agg._sum.entryAmount ?? 0;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

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

  /**
   * 활성 포트폴리오의 최신 리스크 스냅샷(일손익·집중도·하드룰 위반·riskLevel) 조회.
   * 활성 포트폴리오 또는 스냅샷이 없으면 `null`(빈상태).
   * 읽기 전용 — Engine5 Risk 하드룰 산출 로직은 침범하지 않는다.
   */
  async findLatestRiskSnapshot(
    userId: string,
  ): Promise<PortfolioRiskSnapshotView | null> {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { userId, isActive: true },
      include: {
        riskSnapshots: { orderBy: { snapshotDate: 'desc' }, take: 1 },
      },
    });

    const snapshot = portfolio?.riskSnapshots?.[0];
    if (!portfolio || !snapshot) {
      return null;
    }

    return {
      portfolioId: portfolio.id,
      snapshotDate: snapshot.snapshotDate,
      totalValue: snapshot.totalValue,
      cashAmount: snapshot.cashAmount ?? null,
      unrealizedPnl: snapshot.unrealizedPnl,
      unrealizedPnlPct: snapshot.unrealizedPnlPct,
      topPositionPct: snapshot.topPositionPct,
      topSectorPct: snapshot.topSectorPct ?? null,
      openPositionCount: snapshot.openPositionCount,
      dailyPnl: snapshot.dailyPnl ?? null,
      dailyPnlPct: snapshot.dailyPnlPct ?? null,
      weeklyPnl: snapshot.weeklyPnl ?? null,
      weeklyPnlPct: snapshot.weeklyPnlPct ?? null,
      riskLevel: snapshot.riskLevel,
      hardRuleBreached: snapshot.hardRuleBreached,
      hardRuleDetail: snapshot.hardRuleDetail ?? null,
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
