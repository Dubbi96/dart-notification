import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { assertStrategyActivationWindow } from '../../strategy-management/domain/strategy-activation-policy';
import { StrategyVersionDomainError } from '../../strategy-management/domain/strategy-version.types';
import {
  allocationHash,
  AosAllocationDomainError,
  calculateAllocationAmounts,
} from '../domain/allocation-plan';
import {
  CreateAllocationPlanDto,
  CreateAllocationPolicyDto,
  ReasonedCommandDto,
  ReissueAllocationPlanDto,
} from '../../operator/dto/operator-command.dto';
import { OperatorPrincipal } from '../../operator/guards/operator-access.guard';
import { ConsumedStepUp } from '../../operator/guards/operator-step-up.guard';
import { normalizeOperatorJson } from '../../operator/services/aos-operator-command.service';

@Injectable()
export class AosAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  operatorSnapshot() {
    return Promise.all([
      this.prisma.aosAllocationPolicy.findMany({
        take: 20,
        orderBy: { version: 'desc' },
      }),
      this.prisma.aosTradingAccount.findMany({
        where: { accountType: 'SYSTEM_TRADING', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, userId: true, label: true, currency: true },
      }),
      this.prisma.aosAllocationPlan.findMany({
        take: 50,
        orderBy: [{ periodEnd: 'desc' }, { revision: 'desc' }],
        include: {
          allocationPolicy: { select: { version: true, contentHash: true } },
          tradingAccount: { select: { label: true } },
          items: { orderBy: { destination: 'asc' } },
          ledger: { orderBy: { createdAt: 'asc' } },
        },
      }),
    ]).then(([policies, accounts, plans]) => ({ policies, accounts, plans }));
  }

  async mobileSummary(userId: string) {
    const [policy, plans] = await Promise.all([
      this.prisma.aosAllocationPolicy.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          spgiWeight: true,
          vtiWeight: true,
          systemTradingWeight: true,
          contentHash: true,
          effectiveFrom: true,
        },
      }),
      this.prisma.aosAllocationPlan.findMany({
        where: { tradingAccount: { userId }, status: 'APPROVED' },
        take: 3,
        orderBy: [{ periodEnd: 'desc' }, { revision: 'desc' }],
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          revision: true,
          distributableProfit: true,
          currency: true,
          approvedAt: true,
          planHash: true,
          items: { orderBy: { destination: 'asc' } },
        },
      }),
    ]);
    return { policy, plans, executionAvailable: false as const };
  }

  async createPolicy(
    dto: CreateAllocationPolicyDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.aosAllocationPolicy.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      const snapshot = {
        version,
        weights: { SPGI: 0.5, VTI: 0.3, SYSTEM_TRADING: 0.2 },
        profitPeriodPolicyJson: dto.profitPeriodPolicyJson,
        taxReservePolicyJson: dto.taxReservePolicyJson,
        fxPolicyJson: dto.fxPolicyJson,
        minimumAmountPolicyJson: dto.minimumAmountPolicyJson,
      };
      const contentHash = allocationHash(snapshot);
      const policy = await tx.aosAllocationPolicy.create({
        data: {
          version,
          profitPeriodPolicyJson: dto.profitPeriodPolicyJson as Prisma.InputJsonObject,
          taxReservePolicyJson: dto.taxReservePolicyJson as Prisma.InputJsonObject,
          fxPolicyJson: dto.fxPolicyJson as Prisma.InputJsonObject,
          minimumAmountPolicyJson: dto.minimumAmountPolicyJson as Prisma.InputJsonObject,
          contentHash,
          createdByUserId: actor.userId,
        },
      });
      await this.ledger(tx, 'POLICY_CREATED', actor, dto, snapshot, { policyId: policy.id });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'CREATE_ALLOCATION_POLICY',
        'ALLOCATION_POLICY',
        policy.id,
        {
          version,
          status: policy.status,
          contentHash,
        },
      );
      return policy;
    });
  }

  async activatePolicy(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
    now = new Date(),
  ) {
    try {
      assertStrategyActivationWindow(now);
    } catch (cause) {
      if (cause instanceof StrategyVersionDomainError) throw new BadRequestException(cause.code);
      throw cause;
    }
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.aosAllocationPolicy.findUnique({ where: { id } });
      if (!policy) throw new NotFoundException('AOS_ALLOCATION_POLICY_NOT_FOUND');
      if (policy.status !== 'DRAFT')
        throw new BadRequestException('AOS_ALLOCATION_POLICY_NOT_DRAFT');
      if (policy.createdByUserId === actor.userId) {
        throw new ForbiddenException('AOS_ALLOCATION_POLICY_SELF_APPROVAL_BLOCKED');
      }
      await tx.aosAllocationPolicy.updateMany({
        where: { status: 'ACTIVE', id: { not: id } },
        data: { status: 'RETIRED' },
      });
      const activated = await tx.aosAllocationPolicy.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          approvedByUserId: actor.userId,
          approvedAt: now,
          effectiveFrom: now,
        },
      });
      const snapshot = { version: activated.version, status: activated.status, effectiveFrom: now };
      await this.ledger(tx, 'POLICY_ACTIVATED', actor, dto, snapshot, { policyId: id });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'ACTIVATE_ALLOCATION_POLICY',
        'ALLOCATION_POLICY',
        id,
        snapshot,
      );
      return activated;
    });
  }

  async createPlan(dto: CreateAllocationPlanDto, actor: OperatorPrincipal, stepUp: ConsumedStepUp) {
    return this.prisma.$transaction((tx) => this.createPlanInTransaction(tx, dto, actor, stepUp));
  }

  async approvePlan(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.aosAllocationPlan.findUnique({
        where: { id },
        include: { items: true, allocationPolicy: true },
      });
      if (!plan) throw new NotFoundException('AOS_ALLOCATION_PLAN_NOT_FOUND');
      if (plan.status !== 'DRAFT') throw new BadRequestException('AOS_ALLOCATION_PLAN_NOT_DRAFT');
      if (plan.allocationPolicy.status !== 'ACTIVE') {
        throw new BadRequestException('AOS_ALLOCATION_PLAN_POLICY_NOT_ACTIVE');
      }
      if (plan.createdByUserId === actor.userId) {
        throw new ForbiddenException('AOS_ALLOCATION_PLAN_SELF_APPROVAL_BLOCKED');
      }
      const approvedAt = new Date();
      const approved = await tx.aosAllocationPlan.update({
        where: { id },
        data: { status: 'APPROVED', approvedByUserId: actor.userId, approvedAt },
        include: { items: true },
      });
      const snapshot = { planHash: plan.planHash, status: approved.status, approvedAt };
      await this.ledger(tx, 'PLAN_APPROVED', actor, dto, snapshot, { planId: id });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'APPROVE_ALLOCATION_PLAN',
        'ALLOCATION_PLAN',
        id,
        snapshot,
      );
      return approved;
    });
  }

  async cancelPlan(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.aosAllocationPlan.findUnique({ where: { id } });
      if (!plan) throw new NotFoundException('AOS_ALLOCATION_PLAN_NOT_FOUND');
      if (plan.status === 'CANCELLED')
        throw new BadRequestException('AOS_ALLOCATION_PLAN_ALREADY_CANCELLED');
      const cancelledAt = new Date();
      const cancelled = await tx.aosAllocationPlan.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt },
      });
      const snapshot = {
        planHash: plan.planHash,
        previousStatus: plan.status,
        status: cancelled.status,
        cancelledAt,
      };
      await this.ledger(tx, 'PLAN_CANCELLED', actor, dto, snapshot, { planId: id });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'CANCEL_ALLOCATION_PLAN',
        'ALLOCATION_PLAN',
        id,
        snapshot,
      );
      return cancelled;
    });
  }

  async reissuePlan(
    id: string,
    dto: ReissueAllocationPlanDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.aosAllocationPlan.findUnique({ where: { id } });
      if (!parent) throw new NotFoundException('AOS_ALLOCATION_PLAN_NOT_FOUND');
      if (parent.status !== 'CANCELLED') {
        throw new BadRequestException('AOS_ALLOCATION_REISSUE_REQUIRES_CANCELLED_PLAN');
      }
      if (
        dto.tradingAccountId !== parent.tradingAccountId ||
        new Date(dto.periodStart).getTime() !== parent.periodStart.getTime() ||
        new Date(dto.periodEnd).getTime() !== parent.periodEnd.getTime()
      ) {
        throw new BadRequestException('AOS_ALLOCATION_REISSUE_PERIOD_OR_ACCOUNT_MISMATCH');
      }
      const reissued = await this.createPlanInTransaction(tx, dto, actor, stepUp, {
        parentPlanId: parent.id,
        revision: parent.revision + 1,
        ledgerEvent: 'PLAN_REISSUED',
      });
      return reissued;
    });
  }

  private async createPlanInTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateAllocationPlanDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
    options?: { parentPlanId: string; revision: number; ledgerEvent: 'PLAN_REISSUED' },
  ) {
    let amounts;
    try {
      amounts = calculateAllocationAmounts(dto);
    } catch (cause) {
      if (cause instanceof AosAllocationDomainError) throw new BadRequestException(cause.code);
      throw cause;
    }
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd < periodStart || periodEnd > new Date()) {
      throw new BadRequestException('AOS_ALLOCATION_CLOSED_PERIOD_REQUIRED');
    }
    const [policy, account] = await Promise.all([
      tx.aosAllocationPolicy.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      }),
      tx.aosTradingAccount.findUnique({ where: { id: dto.tradingAccountId } }),
    ]);
    if (!policy) throw new BadRequestException('AOS_ACTIVE_ALLOCATION_POLICY_REQUIRED');
    if (!account || account.accountType !== 'SYSTEM_TRADING' || account.currency !== 'KRW') {
      throw new BadRequestException('AOS_SYSTEM_TRADING_KRW_ACCOUNT_REQUIRED');
    }
    const latest = options
      ? null
      : await tx.aosAllocationPlan.findFirst({
          where: { tradingAccountId: account.id, periodStart, periodEnd },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        });
    if (latest) throw new BadRequestException('AOS_ALLOCATION_PERIOD_ALREADY_PLANNED');
    if (Object.keys(dto.sourceEvidenceJson).length === 0) {
      throw new BadRequestException('AOS_ALLOCATION_SOURCE_EVIDENCE_REQUIRED');
    }
    const revision = options?.revision ?? 1;
    const sourceEvidenceHash = allocationHash(dto.sourceEvidenceJson);
    const planSnapshot = {
      allocationPolicyId: policy.id,
      allocationPolicyHash: policy.contentHash,
      tradingAccountId: account.id,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      revision,
      ...amounts,
      sourceEvidenceHash,
      parentPlanId: options?.parentPlanId ?? null,
    };
    const planHash = allocationHash(planSnapshot);
    const plan = await tx.aosAllocationPlan.create({
      data: {
        allocationPolicyId: policy.id,
        tradingAccountId: account.id,
        periodStart,
        periodEnd,
        revision,
        grossRealizedProfit: amounts.grossRealizedProfitKrw,
        taxReserveAmount: amounts.taxReserveKrw,
        fxReserveAmount: amounts.fxReserveKrw,
        distributableProfit: amounts.distributableProfitKrw,
        sourceEvidenceJson: dto.sourceEvidenceJson as Prisma.InputJsonObject,
        sourceEvidenceHash,
        planHash,
        parentPlanId: options?.parentPlanId,
        createdByUserId: actor.userId,
        items: {
          create: amounts.items.map((item) => ({
            destination: item.destination,
            weight: item.weight,
            amount: item.amountKrw,
          })),
        },
      },
      include: { items: true },
    });
    await this.ledger(tx, options?.ledgerEvent ?? 'PLAN_CREATED', actor, dto, planSnapshot, {
      planId: plan.id,
    });
    await this.receipt(
      tx,
      actor,
      stepUp,
      dto,
      options ? 'REISSUE_ALLOCATION_PLAN' : 'CREATE_ALLOCATION_PLAN',
      'ALLOCATION_PLAN',
      plan.id,
      {
        planHash,
        revision,
        status: plan.status,
        distributableProfitKrw: amounts.distributableProfitKrw,
      },
    );
    return plan;
  }

  private async ledger(
    tx: Prisma.TransactionClient,
    eventType:
      | 'POLICY_CREATED'
      | 'POLICY_ACTIVATED'
      | 'PLAN_CREATED'
      | 'PLAN_APPROVED'
      | 'PLAN_CANCELLED'
      | 'PLAN_REISSUED',
    actor: OperatorPrincipal,
    dto: ReasonedCommandDto,
    snapshot: object,
    target: { policyId: string } | { planId: string },
  ) {
    const snapshotJson = normalizeOperatorJson(snapshot);
    const snapshotHash = allocationHash(snapshotJson);
    const receiptHash = allocationHash({
      eventType,
      actorUserId: actor.userId,
      actorRole: actor.role,
      reason: dto.reason,
      snapshotHash,
      correlationId: dto.correlationId,
      target,
    });
    return tx.aosAllocationLedgerEntry.create({
      data: {
        ...target,
        eventType,
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: dto.reason,
        snapshotJson,
        snapshotHash,
        correlationId: `allocation:${eventType}:${dto.correlationId}`,
        receiptHash,
      },
    });
  }

  private async receipt(
    tx: Prisma.TransactionClient,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
    request: ReasonedCommandDto,
    commandType: string,
    targetType: string,
    targetId: string,
    result: object,
  ) {
    const requestJson = normalizeOperatorJson(request);
    const resultJson = normalizeOperatorJson(result);
    const requestHash = allocationHash(requestJson);
    const payload = {
      actorUserId: actor.userId,
      actorRole: actor.role,
      stepUpGrantId: stepUp.grantId,
      commandType,
      targetType,
      targetId,
      reason: request.reason,
      request: requestJson,
      result: resultJson,
      status: 'SUCCEEDED',
    };
    return tx.aosOperatorCommandReceipt.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        stepUpGrantId: stepUp.grantId,
        commandType,
        targetType,
        targetId,
        reason: request.reason,
        requestJson,
        resultJson,
        status: 'SUCCEEDED',
        correlationId: request.correlationId,
        requestHash,
        receiptHash: allocationHash(payload),
      },
    });
  }
}
