import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../prisma/prisma.service';
import { OperatorPrincipal } from '../guards/operator-access.guard';

@Injectable()
export class AosOperatorQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async bootstrap(operator: OperatorPrincipal) {
    const mutations = this.config.get<string | boolean>('AOS_OPERATOR_MUTATIONS_ENABLED', false);
    const readOnly = mutations !== true && mutations !== 'true';
    const [strategyCount, failedBacktests, openBreaks, latestKill, recentFailures] =
      await Promise.all([
        this.prisma.strategy.count(),
        this.prisma.aosBacktestRun.count({ where: { acceptanceStatus: 'FAILED' } }),
        this.prisma.aosReconciliationBreak.count({ where: { resolution: 'OPEN' } }),
        this.prisma.aosKillSwitchEvent.findFirst({ orderBy: { requestedAt: 'desc' } }),
        this.prisma.cronRunLog.count({
          where: { status: 'FAILED', startedAt: { gte: new Date(Date.now() - 86_400_000) } },
        }),
      ]);
    return {
      operator,
      mode: readOnly ? 'READ_ONLY' : 'CONTROLLED_MUTATION',
      mutationsEnabled: !readOnly,
      summary: { strategyCount, failedBacktests, openBreaks, recentFailures },
      killSwitch: latestKill,
      asOf: new Date(),
    };
  }

  async strategies() {
    return this.prisma.strategy.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
          include: {
            _count: { select: { rules: true, signalDecisions: true, aosBacktestRuns: true } },
          },
        },
      },
    });
  }

  async strategyVersion(id: string, compareTo?: string) {
    const selectVersion = (versionId: string) =>
      this.prisma.strategyVersion.findUnique({
        where: { id: versionId },
        include: {
          strategy: true,
          rules: { include: { ruleDefinition: true }, orderBy: { priority: 'asc' } },
          activations: { orderBy: { createdAt: 'desc' } },
          aosBacktestRuns: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { acceptance: true },
          },
        },
      });
    const [version, baseline] = await Promise.all([
      selectVersion(id),
      compareTo ? selectVersion(compareTo) : Promise.resolve(null),
    ]);
    if (!version) throw new NotFoundException('AOS_STRATEGY_VERSION_NOT_FOUND');
    return {
      version,
      baseline,
      diff: baseline ? diffValues(baseline.configJson, version.configJson) : [],
    };
  }

  async backtests(limit = 50) {
    return this.prisma.aosBacktestRun.findMany({
      take: clamp(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        strategyVersion: { include: { strategy: true } },
        riskPolicyVersion: true,
        windows: { orderBy: { sequence: 'asc' } },
        acceptance: { orderBy: { criterionKey: 'asc' } },
        attributions: true,
        _count: { select: { trades: true } },
      },
    });
  }

  async shadow(limit = 50) {
    const take = clamp(limit);
    const [accounts, plans, reconciliations, breaks] = await Promise.all([
      this.prisma.aosTradingAccount.findMany({ include: { capitalBuckets: true } }),
      this.prisma.aosOrderPlan.findMany({
        take,
        orderBy: { createdAt: 'desc' },
        include: { order: { include: { fills: true } }, riskDecision: true },
      }),
      this.prisma.aosReconciliationRun.findMany({
        take,
        orderBy: { completedAt: 'desc' },
      }),
      this.prisma.aosReconciliationBreak.findMany({
        where: { resolution: 'OPEN' },
        take,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        include: { run: true },
      }),
    ]);
    return { accounts, plans, reconciliations, breaks };
  }

  async audit(limit = 100) {
    const take = clamp(limit, 200);
    const [approvals, configEvents, interventions, killEvents, commands] = await Promise.all([
      this.prisma.approvalRecord.findMany({ take, orderBy: { createdAt: 'desc' } }),
      this.prisma.configAuditEvent.findMany({ take, orderBy: { createdAt: 'desc' } }),
      this.prisma.aosHumanIntervention.findMany({ take, orderBy: { createdAt: 'desc' } }),
      this.prisma.aosKillSwitchEvent.findMany({ take, orderBy: { createdAt: 'desc' } }),
      this.prisma.aosOperatorCommandReceipt.findMany({ take, orderBy: { createdAt: 'desc' } }),
    ]);
    return { approvals, configEvents, interventions, killEvents, commands };
  }

  async replayDecision(id: string) {
    const decision = await this.prisma.signalDecision.findUnique({
      where: { id },
      include: {
        featureSnapshot: true,
        marketRegimeSnapshot: true,
        strategyVersion: true,
        riskPolicyVersion: true,
        traces: { orderBy: { executionOrder: 'asc' } },
      },
    });
    if (!decision) throw new NotFoundException('AOS_SIGNAL_DECISION_NOT_FOUND');
    return decision;
  }

  async health(limit = 40) {
    return this.prisma.cronRunLog.findMany({
      take: clamp(limit),
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        jobKey: true,
        status: true,
        triggeredBy: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
      },
    });
  }
}

function clamp(value: number, max = 100): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.trunc(value))) : 50;
}

function diffValues(
  before: unknown,
  after: unknown,
  path = '$',
): Array<{
  path: string;
  before: unknown;
  after: unknown;
}> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValues(before[key], after[key], `${path}.${key}`));
  }
  return [{ path, before, after }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
