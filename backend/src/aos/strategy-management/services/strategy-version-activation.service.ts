import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  assertStrategyActivationWindow,
  assertValidStrategyActivationSchedule,
} from '../domain/strategy-activation-policy';
import { transitionStrategyVersion } from '../domain/strategy-version-state-machine';
import {
  StrategyVersionDomainError,
  StrategyVersionStatus,
} from '../domain/strategy-version.types';

const ACTIVATION_LOCK_NAMESPACE = 555;

export interface ScheduleStrategyVersionInput {
  readonly strategyVersionId: string;
  readonly scheduledFor: Date;
  readonly correlationId: string;
  readonly requestedByUserId?: string;
  readonly now?: Date;
}

export interface ScheduleStrategyVersionResult {
  readonly outcome: 'SCHEDULED' | 'ALREADY_SCHEDULED';
  readonly activationId: string;
  readonly strategyVersionId: string;
  readonly scheduledFor: Date;
}

export interface ActivateStrategyVersionResult {
  readonly outcome: 'ACTIVATED' | 'ALREADY_ACTIVATED';
  readonly activationId: string;
  readonly strategyVersionId: string;
  readonly supersededVersionId: string | null;
  readonly activatedAt: Date;
}

/**
 * 자동 배선되지 않은 명시적 AOS application service.
 *
 * - 스케줄/활성화는 strategyId advisory lock + SERIALIZABLE transaction으로 직렬화한다.
 * - ACTIVE 교체는 기존 버전 종료 → 신규 버전 활성 순서로 처리한다.
 * - DB partial unique index가 애플리케이션 오류가 있어도 전략별 ACTIVE 2개를 최종 차단한다.
 * - Cron/AppModule/Signal/Order 경로에는 이 Issue에서 연결하지 않는다.
 */
@Injectable()
export class StrategyVersionActivationService {
  constructor(private readonly prisma: PrismaService) {}

  async schedule(input: ScheduleStrategyVersionInput): Promise<ScheduleStrategyVersionResult> {
    const now = input.now ?? new Date();
    assertCorrelationId(input.correlationId);

    return this.prisma.$transaction(
      async (tx) => {
        const initialVersion = await tx.strategyVersion.findUnique({
          where: { id: input.strategyVersionId },
          select: {
            id: true,
            strategyId: true,
            status: true,
            validatedAt: true,
            approvedAt: true,
            effectiveFrom: true,
            retiredAt: true,
          },
        });
        if (!initialVersion) {
          throw activationError(
            'STRATEGY_VERSION_NOT_FOUND',
            `Strategy version ${input.strategyVersionId} does not exist.`,
          );
        }

        await lockStrategy(tx, initialVersion.strategyId);

        const existing = await tx.versionActivation.findUnique({
          where: { correlationId: input.correlationId },
          select: {
            id: true,
            strategyVersionId: true,
            scheduledFor: true,
            requestedByUserId: true,
          },
        });
        if (existing) {
          if (
            existing.strategyVersionId !== input.strategyVersionId ||
            existing.scheduledFor.getTime() !== input.scheduledFor.getTime() ||
            (existing.requestedByUserId ?? undefined) !== input.requestedByUserId
          ) {
            throw activationError(
              'ACTIVATION_IDEMPOTENCY_CONFLICT',
              `correlationId ${input.correlationId} is already bound to another activation request.`,
            );
          }
          return {
            outcome: 'ALREADY_SCHEDULED',
            activationId: existing.id,
            strategyVersionId: existing.strategyVersionId,
            scheduledFor: existing.scheduledFor,
          };
        }

        assertValidStrategyActivationSchedule(input.scheduledFor, now);

        const version = await tx.strategyVersion.findUnique({
          where: { id: input.strategyVersionId },
          select: {
            id: true,
            strategyId: true,
            status: true,
            validatedAt: true,
            approvedAt: true,
            effectiveFrom: true,
            retiredAt: true,
          },
        });
        if (!version) {
          throw activationError(
            'STRATEGY_VERSION_NOT_FOUND',
            `Strategy version ${input.strategyVersionId} disappeared while scheduling.`,
          );
        }

        const next = transitionStrategyVersion({
          current: lifecycleOf(version),
          target: 'SCHEDULED',
          now,
          effectiveFrom: input.scheduledFor,
        });

        await tx.strategyVersion.update({
          where: { id: version.id },
          data: {
            status: next.status,
            effectiveFrom: next.effectiveFrom,
          },
        });
        const activation = await tx.versionActivation.create({
          data: {
            strategyVersionId: version.id,
            scheduledFor: input.scheduledFor,
            correlationId: input.correlationId,
            requestedByUserId: input.requestedByUserId,
          },
          select: {
            id: true,
            strategyVersionId: true,
            scheduledFor: true,
          },
        });

        return {
          outcome: 'SCHEDULED',
          activationId: activation.id,
          strategyVersionId: activation.strategyVersionId,
          scheduledFor: activation.scheduledFor,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async activate(activationId: string, now = new Date()): Promise<ActivateStrategyVersionResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const initialActivation = await tx.versionActivation.findUnique({
          where: { id: activationId },
          include: {
            strategyVersion: {
              select: { strategyId: true },
            },
          },
        });
        if (!initialActivation) {
          throw activationError(
            'VERSION_ACTIVATION_NOT_FOUND',
            `Version activation ${activationId} does not exist.`,
          );
        }

        await lockStrategy(tx, initialActivation.strategyVersion.strategyId);

        const activation = await tx.versionActivation.findUnique({
          where: { id: activationId },
          include: {
            strategyVersion: {
              select: {
                id: true,
                strategyId: true,
                status: true,
                validatedAt: true,
                approvedAt: true,
                effectiveFrom: true,
                retiredAt: true,
              },
            },
          },
        });
        if (!activation) {
          throw activationError(
            'VERSION_ACTIVATION_NOT_FOUND',
            `Version activation ${activationId} disappeared while activating.`,
          );
        }

        if (activation.status === 'ACTIVE' && activation.activatedAt) {
          return {
            outcome: 'ALREADY_ACTIVATED',
            activationId: activation.id,
            strategyVersionId: activation.strategyVersionId,
            supersededVersionId: null,
            activatedAt: activation.activatedAt,
          };
        }
        if (activation.status !== 'SCHEDULED') {
          throw activationError(
            'VERSION_ACTIVATION_INVALID_STATE',
            `Version activation ${activation.id} cannot run from ${activation.status}.`,
          );
        }

        assertStrategyActivationWindow(now);

        const candidate = activation.strategyVersion;
        if (
          !candidate.effectiveFrom ||
          candidate.effectiveFrom.getTime() !== activation.scheduledFor.getTime()
        ) {
          throw activationError(
            'VERSION_ACTIVATION_SCHEDULE_MISMATCH',
            `Strategy version ${candidate.id} effectiveFrom does not match activation ${activation.id}.`,
          );
        }

        const next = transitionStrategyVersion({
          current: lifecycleOf(candidate),
          target: 'ACTIVE',
          now,
        });

        const currentActive = await tx.strategyVersion.findFirst({
          where: {
            strategyId: candidate.strategyId,
            status: 'ACTIVE',
            id: { not: candidate.id },
          },
          select: { id: true },
        });

        if (currentActive) {
          await tx.versionActivation.updateMany({
            where: {
              strategyVersionId: currentActive.id,
              status: 'ACTIVE',
              deactivatedAt: null,
            },
            data: { deactivatedAt: now },
          });
          await tx.strategyVersion.update({
            where: { id: currentActive.id },
            data: {
              status: 'SUPERSEDED',
              retiredAt: now,
            },
          });
        }

        await tx.strategyVersion.update({
          where: { id: candidate.id },
          data: { status: next.status },
        });
        await tx.versionActivation.update({
          where: { id: activation.id },
          data: {
            status: 'ACTIVE',
            activatedAt: now,
          },
        });

        return {
          outcome: 'ACTIVATED',
          activationId: activation.id,
          strategyVersionId: candidate.id,
          supersededVersionId: currentActive?.id ?? null,
          activatedAt: now,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

function lifecycleOf(version: {
  status: string;
  validatedAt: Date | null;
  approvedAt: Date | null;
  effectiveFrom: Date | null;
  retiredAt: Date | null;
}) {
  return {
    status: version.status as StrategyVersionStatus,
    validatedAt: version.validatedAt,
    approvedAt: version.approvedAt,
    effectiveFrom: version.effectiveFrom,
    retiredAt: version.retiredAt,
  };
}

function assertCorrelationId(correlationId: string): void {
  if (!correlationId || correlationId.trim() !== correlationId || correlationId.length > 160) {
    throw activationError(
      'INVALID_ACTIVATION_CORRELATION_ID',
      'correlationId must be a non-empty trimmed string up to 160 characters.',
    );
  }
}

async function lockStrategy(
  tx: {
    $executeRaw: Prisma.TransactionClient['$executeRaw'];
  },
  strategyId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${strategyId}, ${ACTIVATION_LOCK_NAMESPACE})
    )
  `;
}

function activationError(
  code: ConstructorParameters<typeof StrategyVersionDomainError>[0],
  message: string,
): StrategyVersionDomainError {
  return new StrategyVersionDomainError(code, message);
}
