import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { canonicalizeJson } from '@dart-notification/aos-rule-engine';

import { PrismaService } from '../../../prisma/prisma.service';
import { validateRiskPolicyLimits } from '../../risk-policy/domain/risk-policy-version';
import { evaluateCanonicalRisk } from '../domain/canonical-risk';
import { AosAccountBootstrapService } from './aos-account-bootstrap.service';

export const AOS_CANONICAL_PAPER_LEDGER_FLAG = 'AOS_CANONICAL_PAPER_LEDGER_ENABLED';

const SHADOW_ELIGIBLE_VERSION_STATUSES = new Set([
  'BACKTESTED',
  'APPROVAL_PENDING',
  'APPROVED',
  'SCHEDULED',
  'ACTIVE',
]);

export interface CanonicalReservationInput {
  readonly portfolioId: string;
  readonly tradingSignalId: string;
  readonly paperTradeId: string;
  readonly corpCode: string;
  readonly stockCode: string;
  readonly orderedShares: number;
  readonly referencePrice: number;
  readonly totalCapital: number;
  readonly availableCash: number;
  readonly currentPositionValue?: number;
  readonly sectorExposureValue?: number;
  readonly dailyRealizedPnl: number;
  readonly weeklyRealizedPnl: number;
  readonly monthlyRealizedPnl: number;
  readonly drawdownPct: number;
  readonly openOrderCount: number;
  readonly todayTradeCount: number;
  readonly openPositionCount: number;
  readonly killSwitchActive: boolean;
  readonly validFrom: Date;
  readonly expiresAt: Date;
  readonly stopPrice?: number;
  readonly takeProfitPrice?: number;
  readonly maxHoldDays?: number;
}

export interface CanonicalFillInput {
  readonly paperTradeId: string;
  readonly filledShares: number;
  readonly filledPrice: number;
  readonly commission: number;
  readonly tax: number;
  readonly slippage: number;
  readonly filledAt: Date;
  readonly killSwitchActive: boolean;
}

@Injectable()
export class CanonicalPaperLedgerService {
  private readonly logger = new Logger(CanonicalPaperLedgerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly accounts: AosAccountBootstrapService,
  ) {}

  isEnabled(): boolean {
    const value = this.config.get<string | boolean>(AOS_CANONICAL_PAPER_LEDGER_FLAG, false);
    return value === true || value === 'true';
  }

  async recordReservation(input: CanonicalReservationInput) {
    if (!this.isEnabled()) return { status: 'DISABLED' as const };
    const [portfolio, signalDecision] = await Promise.all([
      this.prisma.portfolio.findUnique({
        where: { id: input.portfolioId },
        select: { userId: true },
      }),
      this.prisma.signalDecision.findFirst({
        where: { legacyTradingSignalId: input.tradingSignalId },
        orderBy: { evaluatedAt: 'desc' },
        select: {
          id: true,
          status: true,
          strategyVersionId: true,
          riskPolicyVersionId: true,
          strategyVersion: { select: { status: true } },
          riskPolicyVersion: { select: { status: true, limitsJson: true } },
        },
      }),
    ]);
    if (!portfolio || !signalDecision) return { status: 'SKIPPED_NO_PINNED_DECISION' as const };
    if (
      !SHADOW_ELIGIBLE_VERSION_STATUSES.has(signalDecision.strategyVersion.status) ||
      !SHADOW_ELIGIBLE_VERSION_STATUSES.has(signalDecision.riskPolicyVersion.status)
    ) {
      return { status: 'SKIPPED_VERSION_NOT_BACKTESTED' as const };
    }
    let limits;
    try {
      limits = validateRiskPolicyLimits(signalDecision.riskPolicyVersion.limitsJson);
    } catch {
      // A3 legacy parity adapter는 승인된 수치 한도가 없으므로 임의 threshold를 만들지 않는다.
      return { status: 'SKIPPED_NO_VERSIONED_RISK_LIMITS' as const };
    }
    const accountIds = await this.accounts.ensureSeparatedAccounts(
      portfolio.userId,
      input.totalCapital,
    );
    const account = await this.prisma.aosTradingAccount.findUniqueOrThrow({
      where: { id: accountIds.systemAccountId },
      select: { id: true, accountType: true, status: true },
    });
    const killSwitchEvent = input.killSwitchActive
      ? await this.prisma.aosKillSwitchEvent.findFirst({
          where: { command: 'ACTIVATE', effectiveAt: { lte: new Date() } },
          orderBy: { effectiveAt: 'desc' },
          select: { id: true },
        })
      : null;
    const risk = evaluateCanonicalRisk(
      {
        side: 'BUY',
        accountType: account.accountType,
        accountStatus: account.status,
        signalBlocked: signalDecision.status === 'BLOCKED',
        killSwitchActive: input.killSwitchActive,
        killSwitchMode: limits.killSwitchMode,
        requestedQuantity: input.orderedShares,
        referencePrice: input.referencePrice,
        totalCapital: input.totalCapital,
        availableCash: input.availableCash,
        currentPositionValue: input.currentPositionValue ?? 0,
        sectorExposureValue: input.sectorExposureValue ?? 0,
        dailyPnl: input.dailyRealizedPnl,
        weeklyPnl: input.weeklyRealizedPnl,
        monthlyPnl: input.monthlyRealizedPnl,
        drawdownPct: input.drawdownPct,
        openOrders: input.openOrderCount,
        dailyTrades: input.todayTradeCount,
        openPositions: input.openPositionCount,
      },
      limits,
    );
    const baseKey = `aos-paper:${signalDecision.id}:${input.paperTradeId}`;
    const proposalPayload = {
      schemaVersion: 'aos-portfolio-proposal.v1',
      signalDecisionId: signalDecision.id,
      accountId: account.id,
      candidate: {
        corpCode: input.corpCode,
        stockCode: input.stockCode,
        quantity: input.orderedShares,
        referencePrice: input.referencePrice,
      },
      exposureBefore: input.totalCapital - input.availableCash,
      exposureAfter:
        input.totalCapital - input.availableCash + input.orderedShares * input.referencePrice,
    };
    const proposalHash = hash(proposalPayload);
    const capitalSnapshot = {
      totalCapital: input.totalCapital,
      availableCash: input.availableCash,
      dailyPnl: input.dailyRealizedPnl,
      weeklyPnl: input.weeklyRealizedPnl,
      monthlyPnl: input.monthlyRealizedPnl,
      drawdownPct: input.drawdownPct,
      openOrders: input.openOrderCount,
      dailyTrades: input.todayTradeCount,
      openPositions: input.openPositionCount,
    };
    const riskPayload = {
      schemaVersion: 'aos-risk-decision.v1',
      proposalHash,
      riskPolicyVersionId: signalDecision.riskPolicyVersionId,
      action: risk.action,
      approvedQuantity: risk.approvedQuantity,
      violations: risk.violations,
      capitalSnapshot,
    };
    const riskHash = hash(riskPayload);

    return this.prisma.$transaction(async (tx) => {
      await tx.aosPortfolioProposal.createMany({
        data: [
          {
            proposalKey: `${baseKey}:proposal`,
            signalDecisionId: signalDecision.id,
            strategyVersionId: signalDecision.strategyVersionId,
            tradingAccountId: account.id,
            mode: 'SHADOW',
            proposalJson: proposalPayload as Prisma.InputJsonValue,
            totalExposureBefore: proposalPayload.exposureBefore,
            totalExposureAfter: proposalPayload.exposureAfter,
            resultHash: proposalHash,
          },
        ],
        skipDuplicates: true,
      });
      const proposal = await tx.aosPortfolioProposal.findUniqueOrThrow({
        where: { proposalKey: `${baseKey}:proposal` },
        select: { id: true },
      });
      await tx.aosRiskDecision.createMany({
        data: [
          {
            decisionKey: `${baseKey}:risk`,
            portfolioProposalId: proposal.id,
            signalDecisionId: signalDecision.id,
            riskPolicyVersionId: signalDecision.riskPolicyVersionId,
            killSwitchEventId: killSwitchEvent?.id,
            action: risk.action,
            violationsJson: [...risk.violations],
            capitalSnapshotJson: capitalSnapshot,
            resultHash: riskHash,
            decidedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      const riskDecision = await tx.aosRiskDecision.findUniqueOrThrow({
        where: { decisionKey: `${baseKey}:risk` },
        select: { id: true, action: true },
      });
      if (riskDecision.action === 'BLOCK') {
        return { status: 'BLOCKED' as const, riskDecisionId: riskDecision.id };
      }
      const planPayload = {
        schemaVersion: 'aos-order-plan.v1',
        proposalHash,
        riskHash,
        signalDecisionId: signalDecision.id,
        strategyVersionId: signalDecision.strategyVersionId,
        accountId: account.id,
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: risk.approvedQuantity,
        price: input.referencePrice,
        stopPrice: input.stopPrice ?? null,
        takeProfitPrice: input.takeProfitPrice ?? null,
        maxHoldDays: input.maxHoldDays ?? null,
        validFrom: input.validFrom.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      };
      const planHash = hash(planPayload);
      await tx.aosOrderPlan.createMany({
        data: [
          {
            portfolioProposalId: proposal.id,
            signalDecisionId: signalDecision.id,
            riskDecisionId: riskDecision.id,
            strategyVersionId: signalDecision.strategyVersionId,
            tradingAccountId: account.id,
            mode: 'SHADOW',
            side: 'BUY',
            orderType: 'LIMIT',
            plannedQuantity: risk.approvedQuantity,
            plannedPrice: input.referencePrice,
            stopPrice: input.stopPrice,
            takeProfitPrice: input.takeProfitPrice,
            maxHoldDays: input.maxHoldDays,
            validFrom: input.validFrom,
            expiresAt: input.expiresAt,
            status: 'APPROVED',
            idempotencyKey: `${baseKey}:plan`,
            planHash,
          },
        ],
        skipDuplicates: true,
      });
      const plan = await tx.aosOrderPlan.findUniqueOrThrow({
        where: { idempotencyKey: `${baseKey}:plan` },
        select: { id: true, plannedQuantity: true },
      });
      await tx.aosOrder.createMany({
        data: [
          {
            orderPlanId: plan.id,
            legacyPaperTradeId: input.paperTradeId,
            status: 'NEW',
            requestedQuantity: plan.plannedQuantity,
            brokerOrderId: `paper:${input.paperTradeId}`,
          },
        ],
        skipDuplicates: true,
      });
      return { status: 'PLANNED' as const, orderPlanId: plan.id, action: risk.action };
    });
  }

  async recordFill(input: CanonicalFillInput) {
    if (!this.isEnabled()) return { status: 'DISABLED' as const };
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.aosOrder.findUnique({
        where: { legacyPaperTradeId: input.paperTradeId },
        select: {
          id: true,
          status: true,
          requestedQuantity: true,
          orderPlan: { select: { id: true, status: true, validFrom: true, expiresAt: true } },
          fills: { select: { quantity: true } },
        },
      });
      if (!order) return { status: 'SKIPPED_NO_PLAN' as const };
      if (order.status === 'FILLED') return { status: 'ALREADY_FILLED' as const };
      if (
        input.killSwitchActive ||
        input.filledAt < order.orderPlan.validFrom ||
        input.filledAt > order.orderPlan.expiresAt
      ) {
        if (order.orderPlan.status === 'APPROVED') {
          await tx.aosOrderPlan.update({
            where: { id: order.orderPlan.id },
            data: { status: input.killSwitchActive ? 'CANCELLED' : 'EXPIRED' },
          });
        }
        if (order.status === 'NEW') {
          await tx.aosOrder.update({
            where: { id: order.id },
            data: {
              status: input.killSwitchActive ? 'CANCELLED' : 'REJECTED',
              cancelledAt: input.killSwitchActive ? input.filledAt : undefined,
            },
          });
        }
        return { status: input.killSwitchActive ? ('KILLED' as const) : ('STALE' as const) };
      }
      if (order.orderPlan.status === 'APPROVED') {
        await tx.aosOrderPlan.update({
          where: { id: order.orderPlan.id },
          data: { status: 'QUEUED' },
        });
      }
      if (order.status === 'NEW') {
        await tx.aosOrder.update({
          where: { id: order.id },
          data: { status: 'SUBMITTED', submittedAt: input.filledAt },
        });
      }
      const alreadyFilled = order.fills.reduce((sum, fill) => sum + fill.quantity, 0);
      const acceptedShares = Math.min(
        input.filledShares,
        Math.max(0, order.requestedQuantity - alreadyFilled),
      );
      if (acceptedShares <= 0) return { status: 'ALREADY_FILLED' as const };
      const costRatio = input.filledShares > 0 ? acceptedShares / input.filledShares : 0;
      const fillPayload = {
        schemaVersion: 'aos-order-fill.v1',
        orderId: order.id,
        paperTradeId: input.paperTradeId,
        quantity: acceptedShares,
        price: input.filledPrice,
        commission: input.commission * costRatio,
        tax: input.tax * costRatio,
        slippage: input.slippage * costRatio,
        filledAt: input.filledAt.toISOString(),
      };
      const receiptHash = hash(fillPayload);
      await tx.aosOrderFill.createMany({
        data: [
          {
            orderId: order.id,
            brokerFillId: `paper-fill:${input.paperTradeId}:${receiptHash}`,
            quantity: acceptedShares,
            price: input.filledPrice,
            commission: input.commission * costRatio,
            tax: input.tax * costRatio,
            slippage: input.slippage * costRatio,
            filledAt: input.filledAt,
            receiptHash,
          },
        ],
        skipDuplicates: true,
      });
      const fillTotal = await tx.aosOrderFill.aggregate({
        where: { orderId: order.id },
        _sum: { quantity: true },
      });
      const totalFilled = fillTotal._sum.quantity ?? 0;
      const complete = totalFilled >= order.requestedQuantity;
      await tx.aosOrder.update({
        where: { id: order.id },
        data: { status: complete ? 'FILLED' : 'PARTIAL' },
      });
      if (complete) {
        await tx.aosOrderPlan.update({
          where: { id: order.orderPlan.id },
          data: { status: 'EXECUTED' },
        });
      }
      return { status: complete ? ('FILLED' as const) : ('PARTIAL' as const), receiptHash };
    });
  }

  async recordCancellation(paperTradeId: string, cancelledAt = new Date()) {
    if (!this.isEnabled()) return { status: 'DISABLED' as const };
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.aosOrder.findUnique({
        where: { legacyPaperTradeId: paperTradeId },
        select: { id: true, status: true, orderPlan: { select: { id: true, status: true } } },
      });
      if (!order || order.status === 'FILLED' || order.status === 'CANCELLED') {
        return { status: 'NOOP' as const };
      }
      if (['PLANNED', 'APPROVED', 'QUEUED'].includes(order.orderPlan.status)) {
        await tx.aosOrderPlan.update({
          where: { id: order.orderPlan.id },
          data: { status: 'CANCELLED' },
        });
      }
      await tx.aosOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', cancelledAt },
      });
      return { status: 'CANCELLED' as const };
    });
  }

  async tryRecordReservation(input: CanonicalReservationInput): Promise<void> {
    try {
      await this.recordReservation(input);
    } catch (error) {
      this.logger.error(`[AOS:Paper] canonical 예약 기록 실패: ${safeErrorName(error)}`);
    }
  }

  async tryRecordFill(input: CanonicalFillInput): Promise<void> {
    try {
      await this.recordFill(input);
    } catch (error) {
      this.logger.error(`[AOS:Paper] canonical 체결 기록 실패: ${safeErrorName(error)}`);
    }
  }

  async tryRecordCancellation(paperTradeId: string): Promise<void> {
    try {
      await this.recordCancellation(paperTradeId);
    } catch (error) {
      this.logger.error(`[AOS:Paper] canonical 취소 기록 실패: ${safeErrorName(error)}`);
    }
  }
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(value as never))
    .digest('hex');
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}
