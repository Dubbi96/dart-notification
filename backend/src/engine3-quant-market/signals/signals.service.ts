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

/**
 * EventStudyResult.sampleCount(표본수)에서 신뢰도를 파생하는 통계 근거 항목.
 * 현재 `historicalEvent`(과거 유사 공시 성과)만 EventStudy 집계 기반.
 * 차트·페르소나 등 비통계 항목은 여기에 없으므로 sampleN 미부여(undefined 유지).
 */
const STAT_DERIVED_KEYS = ['historicalEvent'] as const;

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
  sampleNByKey: Partial<Record<string, number>> = {},
): {
  key: string;
  label: string;
  score: number;
  max: number;
  sampleN?: number;
}[] {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return [];
  }
  const obj = breakdown as Record<string, unknown>;
  return Object.keys(SCORE_BREAKDOWN_MAX).map((key) => {
    const sampleN = sampleNByKey[key];
    return {
      key,
      label: SCORE_BREAKDOWN_LABEL[key] ?? key,
      score: typeof obj[key] === 'number' ? (obj[key] as number) : 0,
      max: SCORE_BREAKDOWN_MAX[key],
      // 표본수가 있는 통계 항목에만 sampleN 부여, 그 외는 키 자체를 생략(undefined 유지)
      ...(typeof sampleN === 'number' ? { sampleN } : {}),
    };
  });
}

/**
 * eventType별 통계 항목 sampleN(EventStudyResult.sampleCount) 매핑을 만든다.
 * 해당 eventType의 최신(calculatedAt desc) READY 집계 표본수를 통계 파생 항목에 부여.
 * 집계가 없으면 키를 비워 두어 sampleN이 undefined(미표시)로 남는다.
 */
function buildSampleNByKey(
  eventType: string | null | undefined,
  sampleCountByEventType: Map<string, number>,
): Partial<Record<string, number>> {
  const sampleN = eventType
    ? sampleCountByEventType.get(eventType)
    : undefined;
  if (typeof sampleN !== 'number') return {};
  const out: Partial<Record<string, number>> = {};
  for (const key of STAT_DERIVED_KEYS) {
    out[key] = sampleN;
  }
  return out;
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

  /**
   * 주어진 eventType들의 통계 표본수(EventStudyResult.sampleCount)를 일괄 조회한다.
   * marketType='ALL'·status='READY' 기준 최신(calculatedAt desc) 1건의 sampleCount를
   * eventType별로 매핑(N+1 회피용 단일 쿼리). 집계가 없으면 맵에서 누락.
   */
  private async sampleCountByEventType(
    eventTypes: (string | null | undefined)[],
  ): Promise<Map<string, number>> {
    const unique = [...new Set(eventTypes.filter((e): e is string => !!e))];
    const map = new Map<string, number>();
    if (unique.length === 0) return map;

    const results = await this.prisma.eventStudyResult.findMany({
      where: { eventType: { in: unique }, marketType: 'ALL', status: 'READY' },
      orderBy: { calculatedAt: 'desc' },
      select: { eventType: true, sampleCount: true },
    });
    for (const r of results) {
      // calculatedAt desc 정렬이므로 eventType별 첫 항목(최신)만 채택
      if (!map.has(r.eventType)) map.set(r.eventType, r.sampleCount);
    }
    return map;
  }

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

    const sampleCountByEventType = await this.sampleCountByEventType(
      signals.map((s) => s.eventType),
    );

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
      scoreBreakdown: mapScoreBreakdown(
        s.scoreBreakdown,
        buildSampleNByKey(s.eventType, sampleCountByEventType),
      ),
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

    const sampleCountByEventType = await this.sampleCountByEventType([
      s.eventType,
    ]);

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
      scoreBreakdown: mapScoreBreakdown(
        s.scoreBreakdown,
        buildSampleNByKey(s.eventType, sampleCountByEventType),
      ),
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
