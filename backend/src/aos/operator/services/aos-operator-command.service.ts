import { createHash } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canonicalizeJson } from '@dart-notification/aos-rule-engine';

import { PrismaService } from '../../../prisma/prisma.service';
import { KillSwitchManager } from '../../../engine5-trading-risk/domain/kill-switch';
import {
  canonicalizeApprovalRecord,
  canonicalizeConfigAuditEvent,
  evaluateApprovalActorSeparation,
} from '../../governance/domain/governance-ledger';
import {
  assertStrategyVersionMutable,
  hashStrategyVersionConfig,
  transitionStrategyVersion,
} from '../../strategy-management/domain/strategy-version-state-machine';
import { StrategyVersionActivationService } from '../../strategy-management/services/strategy-version-activation.service';
import { AosOperationsLedgerService } from '../../execution/services/aos-operations-ledger.service';
import {
  ApprovalDecisionDto,
  CreateDraftVersionDto,
  KillSwitchCommandDto,
  ReasonedCommandDto,
  ResolveBreakDto,
  ScheduleVersionDto,
  UpdateDraftVersionDto,
} from '../dto/operator-command.dto';
import { ConsumedStepUp } from '../guards/operator-step-up.guard';
import { OperatorPrincipal } from '../guards/operator-access.guard';

@Injectable()
export class AosOperatorCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activations: StrategyVersionActivationService,
    private readonly operations: AosOperationsLedgerService,
    private readonly killSwitch: KillSwitchManager,
  ) {}

  async createDraft(
    strategyId: string,
    dto: CreateDraftVersionDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.strategyVersion.findFirst({
        where: dto.parentVersionId ? { id: dto.parentVersionId, strategyId } : { strategyId },
        orderBy: { version: 'desc' },
        include: { rules: true },
      });
      if (!parent) throw new NotFoundException('AOS_PARENT_STRATEGY_VERSION_NOT_FOUND');
      const latest = await tx.strategyVersion.findFirst({
        where: { strategyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.strategyVersion.create({
        data: {
          strategyId,
          version: (latest?.version ?? 0) + 1,
          status: 'DRAFT',
          configJson: parent.configJson as Prisma.InputJsonValue,
          configHash: parent.configHash,
          parentVersionId: parent.id,
          createdByUserId: actor.userId,
          rules: {
            create: parent.rules.map((rule) => ({
              ruleDefinitionId: rule.ruleDefinitionId,
              priority: rule.priority,
              enabled: rule.enabled,
              weight: rule.weight,
              parametersJson: rule.parametersJson as Prisma.InputJsonValue,
              parameterHash: rule.parameterHash,
            })),
          },
        },
      });
      await this.audit(tx, {
        subjectType: 'STRATEGY_VERSION',
        subjectId: created.id,
        action: 'CREATED',
        actor,
        reason: dto.reason,
        beforeHash: null,
        afterHash: created.configHash,
        correlationId: dto.correlationId,
      });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'CREATE_DRAFT_VERSION',
        'STRATEGY_VERSION',
        created.id,
        dto.reason,
        {
          version: created.version,
          status: created.status,
        },
      );
      return created;
    });
  }

  async updateDraft(
    id: string,
    dto: UpdateDraftVersionDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.strategyVersion.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('AOS_STRATEGY_VERSION_NOT_FOUND');
      assertStrategyVersionMutable(current.status as never);
      const configHash = hashStrategyVersionConfig(dto.configJson);
      const ruleIds = dto.rules.map((rule) => rule.ruleDefinitionId);
      if (new Set(ruleIds).size !== ruleIds.length) {
        throw new BadRequestException('AOS_DUPLICATE_RULE_DEFINITION');
      }
      const definitions = await tx.ruleDefinition.count({
        where: { id: { in: ruleIds }, isActive: true },
      });
      if (definitions !== ruleIds.length) {
        throw new BadRequestException('AOS_UNKNOWN_OR_INACTIVE_RULE');
      }
      await tx.strategyVersionRule.deleteMany({ where: { strategyVersionId: id } });
      await tx.strategyVersionRule.createMany({
        data: dto.rules.map((rule) => ({
          strategyVersionId: id,
          ruleDefinitionId: rule.ruleDefinitionId,
          priority: rule.priority,
          enabled: rule.enabled,
          weight: rule.weight,
          parametersJson: rule.parametersJson as Prisma.InputJsonValue,
          parameterHash: hash(rule.parametersJson),
        })),
      });
      const updated = await tx.strategyVersion.update({
        where: { id },
        data: { configJson: dto.configJson as Prisma.InputJsonValue, configHash },
      });
      await this.audit(tx, {
        subjectType: 'STRATEGY_VERSION',
        subjectId: id,
        action: 'DRAFT_MUTATED',
        actor,
        reason: dto.reason,
        beforeHash: current.configHash,
        afterHash: configHash,
        correlationId: dto.correlationId,
      });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'UPDATE_DRAFT_VERSION',
        'STRATEGY_VERSION',
        id,
        dto.reason,
        {
          status: updated.status,
          configHash,
          ruleCount: dto.rules.length,
        },
      );
      return updated;
    });
  }

  async validateVersion(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.transitionWithReceipt(
      id,
      dto,
      actor,
      stepUp,
      'VALIDATED',
      'VALIDATE_VERSION',
      async (tx, version) => {
        const detail = await tx.strategyVersion.findUniqueOrThrow({
          where: { id },
          include: { strategy: true, rules: { include: { ruleDefinition: true } } },
        });
        if (
          detail.strategy.assetClass !== 'KR_STOCK' ||
          detail.strategy.direction !== 'LONG_ONLY' ||
          detail.strategy.horizonMinDays < 2 ||
          detail.strategy.horizonMaxDays > 20
        ) {
          throw new BadRequestException('AOS_STRATEGY_SCOPE_INVALID');
        }
        const categories = new Set(
          detail.rules.filter((rule) => rule.enabled).map((rule) => rule.ruleDefinition.category),
        );
        for (const required of ['ENTRY', 'EXIT', 'SIZING'] as const) {
          if (!categories.has(required))
            throw new BadRequestException(`AOS_REQUIRED_RULE_MISSING:${required}`);
        }
        if (hashStrategyVersionConfig(detail.configJson) !== version.configHash) {
          throw new BadRequestException('AOS_CONFIG_HASH_MISMATCH');
        }
      },
    );
  }

  async attestBacktest(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.transitionWithReceipt(
      id,
      dto,
      actor,
      stepUp,
      'BACKTESTED',
      'ATTEST_BACKTEST',
      async (tx) => {
        const passed = await tx.aosBacktestRun.findFirst({
          where: { strategyVersionId: id, acceptanceStatus: 'PASSED' },
          orderBy: { createdAt: 'desc' },
        });
        if (!passed) throw new BadRequestException('AOS_PASSED_BACKTEST_REQUIRED');
      },
    );
  }

  async requestApproval(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.transitionWithReceipt(
      id,
      dto,
      actor,
      stepUp,
      'APPROVAL_PENDING',
      'REQUEST_APPROVAL',
    );
  }

  async decideApproval(
    id: string,
    dto: ApprovalDecisionDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.strategyVersion.findUnique({ where: { id } });
      if (!version) throw new NotFoundException('AOS_STRATEGY_VERSION_NOT_FOUND');
      if (version.status !== 'APPROVAL_PENDING') {
        throw new BadRequestException('AOS_VERSION_NOT_APPROVAL_PENDING');
      }
      const requestAudit = await tx.configAuditEvent.findFirst({
        where: { subjectType: 'STRATEGY_VERSION', subjectId: id, action: 'STATE_TRANSITIONED' },
        orderBy: { createdAt: 'desc' },
      });
      if (!requestAudit?.actorUserId)
        throw new BadRequestException('AOS_APPROVAL_REQUEST_AUDIT_MISSING');
      const separation = evaluateApprovalActorSeparation({
        requestedByUserId: requestAudit.actorUserId,
        actorUserId: actor.userId,
        policy: 'REQUIRE_DISTINCT_ACTOR',
      });
      if (!separation.allowed) throw new ForbiddenException(separation.reason);
      const target = dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const next = transitionStrategyVersion({
        current: lifecycle(version),
        target,
        now: new Date(),
      });
      const evidenceHash = hash({
        reason: dto.reason,
        configHash: version.configHash,
        decision: dto.decision,
      });
      const approval = canonicalizeApprovalRecord({
        subjectType: 'STRATEGY_VERSION',
        subjectId: id,
        subjectHash: version.configHash,
        decision: dto.decision,
        actorUserId: actor.userId,
        actorRoleKey: actor.role,
        reason: dto.reason,
        evidenceHash,
        correlationId: dto.correlationId,
        idempotencyKey: `operator:${dto.correlationId}:approval`,
      });
      await tx.approvalRecord.create({ data: approval });
      const updated = await tx.strategyVersion.update({
        where: { id },
        data: { status: next.status, approvedAt: next.approvedAt },
      });
      await this.audit(tx, {
        subjectType: 'STRATEGY_VERSION',
        subjectId: id,
        action: 'STATE_TRANSITIONED',
        actor,
        reason: dto.reason,
        beforeHash: version.configHash,
        afterHash: version.configHash,
        correlationId: dto.correlationId,
      });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'DECIDE_APPROVAL',
        'STRATEGY_VERSION',
        id,
        dto.reason,
        {
          decision: dto.decision,
          status: updated.status,
          approvalRecordHash: approval.recordHash,
        },
      );
      return updated;
    });
  }

  async schedule(
    id: string,
    dto: ScheduleVersionDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    const scheduledFor = new Date(dto.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime()))
      throw new BadRequestException('AOS_INVALID_SCHEDULE_TIME');
    const result = await this.activations.schedule({
      strategyVersionId: id,
      scheduledFor,
      correlationId: dto.correlationId,
      requestedByUserId: actor.userId,
    });
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.strategyVersion.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, {
        subjectType: 'VERSION_ACTIVATION',
        subjectId: result.activationId,
        action: 'ACTIVATION_RECORDED',
        actor,
        reason: dto.reason,
        beforeHash: version.configHash,
        afterHash: version.configHash,
        correlationId: dto.correlationId,
      });
      await this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'SCHEDULE_VERSION',
        'STRATEGY_VERSION',
        id,
        dto.reason,
        result,
      );
    });
    return result;
  }

  async controlKillSwitch(
    dto: KillSwitchCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    if (dto.command === 'ACTIVATE') {
      if (dto.scope !== 'NEW_ENTRY' || dto.mode !== 'FULL_HALT') {
        throw new BadRequestException('AOS_LEGACY_KILL_SUPPORTS_NEW_ENTRY_FULL_HALT_ONLY');
      }
      await this.killSwitch.activate(dto.reason, 'USER');
    }
    const event = await this.operations.recordKillSwitchEvent({
      scope: dto.scope,
      scopeRefId: dto.scopeRefId,
      mode: dto.mode,
      command: dto.command,
      actorUserId: actor.userId,
      actorKind: 'USER',
      reasonCode: dto.command === 'ACTIVATE' ? 'OPERATOR_EMERGENCY' : 'OPERATOR_REVIEW',
      reasonText: dto.reason,
      stepUpAuthMethod: stepUp.method,
      requestedAt: new Date(),
      effectiveAt: dto.command === 'ACTIVATE' ? new Date() : undefined,
      recoveryPolicy: {
        automaticRelease: false,
        note: '해제 요청은 Kill Switch를 자동 해제하지 않으며 별도 운영 검토가 필요합니다.',
      },
      correlationId: dto.correlationId,
    });
    await this.prisma.$transaction((tx) =>
      this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'CONTROL_KILL_SWITCH',
        'KILL_SWITCH',
        event.id,
        dto.reason,
        {
          eventId: event.id,
          command: event.command,
          effectiveAt: event.effectiveAt,
          legacyKillActive: this.killSwitch.isActive(),
        },
      ),
    );
    return event;
  }

  async resolveBreak(
    breakId: string,
    dto: ResolveBreakDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
  ) {
    const result = await this.operations.resolveReconciliationBreak({
      breakId,
      actorUserId: actor.userId,
      resolution: dto.resolution,
      reasonCode: dto.reasonCode,
      reasonText: dto.reason,
      correlationId: dto.correlationId,
    });
    await this.prisma.$transaction((tx) =>
      this.receipt(
        tx,
        actor,
        stepUp,
        dto,
        'RESOLVE_RECONCILIATION_BREAK',
        'RECONCILIATION_BREAK',
        breakId,
        dto.reason,
        {
          resolution: result.resolution,
          interventionId: result.resolvedByInterventionId,
        },
      ),
    );
    return result;
  }

  private async transitionWithReceipt(
    id: string,
    dto: ReasonedCommandDto,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
    target: 'VALIDATED' | 'BACKTESTED' | 'APPROVAL_PENDING',
    commandType: string,
    precondition?: (
      tx: Prisma.TransactionClient,
      version: TransitionableStrategyVersion,
    ) => Promise<void>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.strategyVersion.findUnique({ where: { id } });
      if (!version) throw new NotFoundException('AOS_STRATEGY_VERSION_NOT_FOUND');
      await precondition?.(tx, version);
      const next = transitionStrategyVersion({
        current: lifecycle(version),
        target,
        now: new Date(),
      });
      const updated = await tx.strategyVersion.update({
        where: { id },
        data: { status: next.status, validatedAt: next.validatedAt },
      });
      await this.audit(tx, {
        subjectType: 'STRATEGY_VERSION',
        subjectId: id,
        action: 'STATE_TRANSITIONED',
        actor,
        reason: dto.reason,
        beforeHash: version.configHash,
        afterHash: version.configHash,
        correlationId: dto.correlationId,
      });
      await this.receipt(tx, actor, stepUp, dto, commandType, 'STRATEGY_VERSION', id, dto.reason, {
        previousStatus: version.status,
        status: updated.status,
      });
      return updated;
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    input: {
      subjectType: 'STRATEGY_VERSION' | 'VERSION_ACTIVATION';
      subjectId: string;
      action: 'CREATED' | 'DRAFT_MUTATED' | 'STATE_TRANSITIONED' | 'ACTIVATION_RECORDED';
      actor: OperatorPrincipal;
      reason: string;
      beforeHash: string | null;
      afterHash: string | null;
      correlationId: string;
    },
  ) {
    const event = canonicalizeConfigAuditEvent({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      action: input.action,
      actorType: 'USER',
      actorUserId: input.actor.userId,
      actorContextSnapshot: JSON.stringify({ role: input.actor.role, source: input.actor.source }),
      reason: input.reason,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      correlationId: input.correlationId,
      idempotencyKey: `operator:${input.correlationId}:audit:${input.action}`,
    });
    await tx.configAuditEvent.create({ data: event });
  }

  private async receipt(
    tx: Prisma.TransactionClient,
    actor: OperatorPrincipal,
    stepUp: ConsumedStepUp,
    request: object,
    commandType: string,
    targetType: string,
    targetId: string,
    reason: string,
    result: object,
  ) {
    const requestJson = normalizeOperatorJson(request);
    const resultJson = normalizeOperatorJson(result);
    const requestHash = hash(requestJson);
    const payload = {
      actorUserId: actor.userId,
      actorRole: actor.role,
      stepUpGrantId: stepUp.grantId,
      commandType,
      targetType,
      targetId,
      reason,
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
        reason,
        requestJson,
        resultJson,
        status: 'SUCCEEDED',
        correlationId:
          (request as { correlationId?: string }).correlationId ?? `operator:${stepUp.grantId}`,
        requestHash,
        receiptHash: hash(payload),
      },
    });
  }
}

interface TransitionableStrategyVersion {
  status: string;
  configHash: string;
  validatedAt: Date | null;
  approvedAt: Date | null;
  effectiveFrom: Date | null;
  retiredAt: Date | null;
}

function lifecycle(version: {
  status: string;
  validatedAt: Date | null;
  approvedAt: Date | null;
  effectiveFrom: Date | null;
  retiredAt: Date | null;
}) {
  return {
    status: version.status as never,
    validatedAt: version.validatedAt,
    approvedAt: version.approvedAt,
    effectiveFrom: version.effectiveFrom,
    retiredAt: version.retiredAt,
  };
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(value as never))
    .digest('hex');
}

export function normalizeOperatorJson(value: object): Prisma.InputJsonObject {
  const parsed = JSON.parse(JSON.stringify(value)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException('AOS_OPERATOR_JSON_OBJECT_REQUIRED');
  }
  return parsed as Prisma.InputJsonObject;
}
