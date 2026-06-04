import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SignalGrade, ExitAction, Prisma } from '@prisma/client';

type MobileGrade = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'BLOCKED';

const SCORE_BREAKDOWN_MAX: Record<string, number> = {
  disclosureEvent: 25,
  keyMetric: 20,
  personaFit: 20,
  historicalEvent: 15,
  chart: 10,
  volumeLiquidity: 5,
  marketSector: 5,
};

const SCORE_BREAKDOWN_LABEL: Record<string, string> = {
  disclosureEvent: '공시 이벤트',
  keyMetric: '핵심 지표',
  personaFit: '페르소나 적합성',
  historicalEvent: '과거 이벤트',
  chart: '차트',
  volumeLiquidity: '거래량/유동성',
  marketSector: '시장/섹터',
};

function mapGrade(grade: SignalGrade): MobileGrade {
  switch (grade) {
    case SignalGrade.STRONG_BUY_CANDIDATE:
      return 'STRONG_BUY';
    case SignalGrade.BUY_CANDIDATE:
      return 'BUY';
    case SignalGrade.BLOCKED:
      return 'BLOCKED';
    case SignalGrade.WATCH:
    case SignalGrade.NEUTRAL:
    case SignalGrade.AVOID:
    default:
      return 'WATCH';
  }
}

function mapScoreBreakdown(
  breakdown: Prisma.JsonValue,
): { key: string; label: string; score: number; max: number }[] {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return [];
  }
  const obj = breakdown as Record<string, unknown>;
  return Object.keys(SCORE_BREAKDOWN_MAX).map((key) => ({
    key,
    label: SCORE_BREAKDOWN_LABEL[key] ?? key,
    score: typeof obj[key] === 'number' ? (obj[key] as number) : 0,
    max: SCORE_BREAKDOWN_MAX[key],
  }));
}

function mapExitReasons(exitSignal: {
  lossRiskScore: number;
  thesisBreakScore: number;
  chartBreakScore: number;
  timeExceededScore: number;
}): { id: string; label: string; kind: 'loss' | 'thesis' | 'chart' | 'time' }[] {
  const reasons: { id: string; label: string; kind: 'loss' | 'thesis' | 'chart' | 'time' }[] = [];

  if (exitSignal.lossRiskScore > 0) {
    reasons.push({ id: 'loss_risk', label: '손실 리스크', kind: 'loss' });
  }
  if (exitSignal.thesisBreakScore > 0) {
    reasons.push({ id: 'thesis_break', label: '투자 논리 훼손', kind: 'thesis' });
  }
  if (exitSignal.chartBreakScore > 0) {
    reasons.push({ id: 'chart_break', label: '차트 이탈', kind: 'chart' });
  }
  if (exitSignal.timeExceededScore > 0) {
    reasons.push({ id: 'time_exceeded', label: '보유 기간 초과', kind: 'time' });
  }
  return reasons;
}

@Injectable()
export class SignalsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: {
    grade?: string;
    personaType?: string;
    entryReady?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { grade, personaType, entryReady, page = 1, limit = 20 } = filters;

    const where: Prisma.TradingSignalWhereInput = {
      ...(grade && { signal: grade as SignalGrade }),
      ...(personaType && { persona: personaType }),
      ...(entryReady !== undefined && { entryReady }),
    };

    const [signals, total] = await Promise.all([
      this.prisma.tradingSignal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: {
            select: { corpCode: true, corpName: true, stockCode: true },
          },
        },
      }),
      this.prisma.tradingSignal.count({ where }),
    ]);

    const items = signals.map((s) => ({
      id: s.id,
      corpCode: s.corpCode,
      corpName: s.company?.corpName ?? '',
      ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
      eventType: s.eventType,
      grade: mapGrade(s.signal),
      buyScore: s.buyScore,
      summary: s.signalSummary ?? undefined,
      entryConditions: [
        ...s.entryConditionMet.map((label, i) => ({
          id: `met_${i}`,
          label,
          required: true,
          met: true,
        })),
        ...s.entryConditionUnmet.map((label, i) => ({
          id: `unmet_${i}`,
          label,
          required: true,
          met: false,
        })),
      ],
      riskFlags: s.riskFactors.map((label, i) => ({
        id: `risk_${i}`,
        label,
        severity: 'medium' as const,
      })),
      blockedReason: s.blockedReason ?? undefined,
      scoreBreakdown: mapScoreBreakdown(s.scoreBreakdown),
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    }));

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const s = await this.prisma.tradingSignal.findUnique({
      where: { id },
      include: {
        company: {
          select: { corpCode: true, corpName: true, stockCode: true },
        },
      },
    });

    if (!s) {
      throw new NotFoundException('Signal not found');
    }

    return {
      id: s.id,
      corpCode: s.corpCode,
      corpName: s.company?.corpName ?? '',
      ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
      eventType: s.eventType,
      grade: mapGrade(s.signal),
      buyScore: s.buyScore,
      summary: s.signalSummary ?? undefined,
      entryConditions: [
        ...s.entryConditionMet.map((label, i) => ({
          id: `met_${i}`,
          label,
          required: true,
          met: true,
        })),
        ...s.entryConditionUnmet.map((label, i) => ({
          id: `unmet_${i}`,
          label,
          required: true,
          met: false,
        })),
      ],
      riskFlags: s.riskFactors.map((label, i) => ({
        id: `risk_${i}`,
        label,
        severity: 'medium' as const,
      })),
      blockedReason: s.blockedReason ?? undefined,
      scoreBreakdown: mapScoreBreakdown(s.scoreBreakdown),
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    };
  }

  async findExitSignals() {
    const exitSignals = await this.prisma.exitSignal.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        position: {
          select: {
            id: true,
            corpCode: true,
            unrealizedPnlPct: true,
            company: {
              select: { corpName: true, stockCode: true },
            },
          },
        },
      },
    });

    return exitSignals.map((e) => {
      const action = e.exitAction as ExitAction;
      return {
        id: e.id,
        corpCode: e.position?.corpCode ?? '',
        corpName: e.position?.company?.corpName ?? '',
        ticker: e.position?.company?.stockCode ?? undefined,
        exitScore: e.exitScore,
        action,
        reasons: mapExitReasons({
          lossRiskScore: e.lossRiskScore,
          thesisBreakScore: e.thesisBreakScore,
          chartBreakScore: e.chartBreakScore,
          timeExceededScore: e.timeExceededScore,
        }),
        pnlPercent: e.position?.unrealizedPnlPct ?? undefined,
        blockRebuy: action === ExitAction.BLOCK_REBUY,
        createdAt: e.createdAt.toISOString(),
      };
    });
  }
}
