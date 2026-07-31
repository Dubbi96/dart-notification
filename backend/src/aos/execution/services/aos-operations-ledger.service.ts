import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canonicalizeJson } from '@dart-notification/aos-rule-engine';

import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AosOperationsLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async recordHumanIntervention(input: {
    actorUserId: string;
    type:
      | 'APPROVE'
      | 'REJECT'
      | 'PAUSE'
      | 'RESUME'
      | 'BLACKLIST'
      | 'EMERGENCY_EXIT'
      | 'OVERRIDE_REQUEST';
    targetType: string;
    targetId: string;
    reasonCode: string;
    reasonText: string;
    before: Prisma.InputJsonObject;
    after: Prisma.InputJsonObject;
    correlationId: string;
  }) {
    const evidenceHash = hash(input);
    await this.prisma.aosHumanIntervention.createMany({
      data: [
        {
          actorUserId: input.actorUserId,
          type: input.type,
          targetType: input.targetType,
          targetId: input.targetId,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          beforeJson: input.before,
          afterJson: input.after,
          correlationId: input.correlationId,
          evidenceHash,
        },
      ],
      skipDuplicates: true,
    });
    return this.prisma.aosHumanIntervention.findUniqueOrThrow({
      where: { correlationId: input.correlationId },
    });
  }

  async recordKillSwitchEvent(input: {
    scope: 'NEW_ENTRY' | 'ACCOUNT' | 'STRATEGY' | 'ALL_ORDERS';
    scopeRefId?: string;
    mode: 'REDUCE_ONLY' | 'FULL_HALT';
    command: 'ACTIVATE' | 'DEACTIVATE_REQUEST' | 'ACKNOWLEDGE';
    actorUserId?: string;
    actorKind: 'USER' | 'SYSTEM';
    reasonCode: string;
    reasonText: string;
    stepUpAuthMethod?: string;
    requestedAt: Date;
    acknowledgedAt?: Date;
    effectiveAt?: Date;
    recoveryPolicy: Prisma.InputJsonObject;
    correlationId: string;
  }) {
    const receiptHash = hash({
      ...input,
      requestedAt: input.requestedAt.toISOString(),
      acknowledgedAt: input.acknowledgedAt?.toISOString() ?? null,
      effectiveAt: input.effectiveAt?.toISOString() ?? null,
    });
    await this.prisma.aosKillSwitchEvent.createMany({
      data: [
        {
          scope: input.scope,
          scopeRefId: input.scopeRefId,
          mode: input.mode,
          command: input.command,
          actorUserId: input.actorUserId,
          actorKind: input.actorKind,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          stepUpAuthMethod: input.stepUpAuthMethod,
          requestedAt: input.requestedAt,
          acknowledgedAt: input.acknowledgedAt,
          effectiveAt: input.effectiveAt,
          recoveryPolicyJson: input.recoveryPolicy,
          correlationId: input.correlationId,
          receiptHash,
        },
      ],
      skipDuplicates: true,
    });
    return this.prisma.aosKillSwitchEvent.findUniqueOrThrow({
      where: { correlationId: input.correlationId },
    });
  }

  async resolveReconciliationBreak(input: {
    breakId: string;
    actorUserId: string;
    resolution: 'EXPLAINED' | 'RESOLVED';
    reasonCode: string;
    reasonText: string;
    correlationId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.aosReconciliationBreak.findUniqueOrThrow({
        where: { id: input.breakId },
        select: { id: true, resolution: true, runId: true, breakKey: true },
      });
      const before = { resolution: row.resolution };
      const after = { resolution: input.resolution };
      const evidenceHash = hash({ ...input, before, after });
      await tx.aosHumanIntervention.createMany({
        data: [
          {
            actorUserId: input.actorUserId,
            type: 'APPROVE',
            targetType: 'RECONCILIATION_BREAK',
            targetId: row.id,
            reasonCode: input.reasonCode,
            reasonText: input.reasonText,
            beforeJson: before,
            afterJson: after,
            correlationId: input.correlationId,
            evidenceHash,
          },
        ],
        skipDuplicates: true,
      });
      const intervention = await tx.aosHumanIntervention.findUniqueOrThrow({
        where: { correlationId: input.correlationId },
        select: { id: true },
      });
      return tx.aosReconciliationBreak.update({
        where: { id: row.id },
        data: {
          resolution: input.resolution,
          explanation: input.reasonText,
          resolvedByInterventionId: intervention.id,
        },
      });
    });
  }
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(value as never))
    .digest('hex');
}
