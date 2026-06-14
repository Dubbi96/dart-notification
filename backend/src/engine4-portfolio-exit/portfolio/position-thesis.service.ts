import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { mapThesisStatus } from './thesis-status.util';

export interface ThesisCondition {
  id: string;
  label: string;
  violated: boolean;
}

export interface ExitRule {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  maxHoldingDays: number;
}

type ExitRuleItem = { type: string; value?: number };

@Injectable()
export class PositionThesisService {
  constructor(private readonly prisma: PrismaService) {}

  async findThesis(userId: string, positionId: string) {
    const thesis = await this.prisma.positionThesis.findFirst({
      where: { position: { id: positionId, portfolio: { userId } } },
      include: { company: { select: { corpName: true } } },
    });

    if (!thesis) {
      return null;
    }

    // Parse initialThesis as string[]
    let entryLogic: ThesisCondition[] = [];
    try {
      const raw = thesis.initialThesis as unknown;
      const items = Array.isArray(raw) ? (raw as string[]) : [];
      entryLogic = items.map((label, idx) => ({
        id: String(idx),
        label: String(label),
        violated: false,
      }));
    } catch {
      entryLogic = [];
    }

    // Parse invalidConditions as { type: string; value?: unknown }[]
    let violationConditions: ThesisCondition[] = [];
    try {
      const raw = thesis.invalidConditions as unknown;
      const items = Array.isArray(raw)
        ? (raw as { type: string; value?: unknown }[])
        : [];
      violationConditions = items.map((cond, idx) => ({
        id: cond.type ?? String(idx),
        label: cond.type ?? String(idx),
        violated: false,
      }));
    } catch {
      violationConditions = [];
    }

    // Parse exitRules
    const exitRules: ExitRule = {
      stopLossPercent: 0,
      takeProfitPercent: 0,
      trailingStopPercent: 0,
      maxHoldingDays: 0,
    };
    try {
      const raw = thesis.exitRules as unknown;
      const items = Array.isArray(raw) ? (raw as ExitRuleItem[]) : [];
      for (const item of items) {
        if (item.type === 'STOP_LOSS_PCT') exitRules.stopLossPercent = item.value ?? 0;
        else if (item.type === 'TAKE_PROFIT_PCT') exitRules.takeProfitPercent = item.value ?? 0;
        else if (item.type === 'TRAILING_STOP_PCT') exitRules.trailingStopPercent = item.value ?? 0;
        else if (item.type === 'MAX_HOLD_DAYS') exitRules.maxHoldingDays = item.value ?? 0;
      }
    } catch {
      // keep defaults
    }

    return {
      positionId,
      corpName: thesis.company.corpName,
      status: mapThesisStatus(thesis.status),
      entryLogic,
      violationConditions,
      exitRules,
      triggerDisclosureRcpNo: thesis.rcpNo ?? undefined,
    };
  }

  async findExitSignal(userId: string, positionId: string) {
    const signal = await this.prisma.exitSignal.findFirst({
      where: { positionId, position: { portfolio: { userId } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!signal) {
      return null;
    }

    const reasons: string[] = [];
    if (signal.lossRiskScore > 0) reasons.push('lossRisk');
    if (signal.thesisBreakScore > 0) reasons.push('thesisBreak');
    if (signal.chartBreakScore > 0) reasons.push('chartBreak');
    if (signal.disclosureRiskScore > 0) reasons.push('disclosureRisk');
    if (signal.overweightScore > 0) reasons.push('overweight');
    if (signal.timeExceededScore > 0) reasons.push('timeExceeded');

    return {
      id: signal.id,
      positionId: signal.positionId,
      exitScore: signal.exitScore,
      exitAction: signal.exitAction,
      reasons,
      scoreDetail: signal.scoreDetail,
      createdAt: signal.createdAt.toISOString(),
    };
  }
}
