import { PrismaService } from '../../../prisma/prisma.service';
import { StrategyVersionActivationService } from './strategy-version-activation.service';

const requestedAt = new Date('2026-07-31T07:00:00.000Z');
const scheduledFor = new Date('2026-08-03T10:00:00.000Z'); // 월요일 19:00 KST

const approvedVersion = {
  id: 'version-2',
  strategyId: 'strategy-1',
  status: 'APPROVED',
  validatedAt: new Date('2026-07-30T08:00:00.000Z'),
  approvedAt: new Date('2026-07-31T06:00:00.000Z'),
  effectiveFrom: null,
  retiredAt: null,
};

const scheduledVersion = {
  ...approvedVersion,
  status: 'SCHEDULED',
  effectiveFrom: scheduledFor,
};

function createHarness() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    strategyVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    versionActivation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const service = new StrategyVersionActivationService(prisma as unknown as PrismaService);

  return { service, prisma, tx };
}

describe('StrategyVersionActivationService.schedule', () => {
  it('records an approved version as a future after-close activation', async () => {
    const { service, prisma, tx } = createHarness();
    tx.strategyVersion.findUnique
      .mockResolvedValueOnce(approvedVersion)
      .mockResolvedValueOnce(approvedVersion);
    tx.versionActivation.findUnique.mockResolvedValue(null);
    tx.versionActivation.create.mockResolvedValue({
      id: 'activation-1',
      strategyVersionId: approvedVersion.id,
      scheduledFor,
    });

    await expect(
      service.schedule({
        strategyVersionId: approvedVersion.id,
        scheduledFor,
        correlationId: 'strategy-1:v2:20260803',
        requestedByUserId: 'operator-1',
        now: requestedAt,
      }),
    ).resolves.toEqual({
      outcome: 'SCHEDULED',
      activationId: 'activation-1',
      strategyVersionId: approvedVersion.id,
      scheduledFor,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.strategyVersion.update).toHaveBeenCalledWith({
      where: { id: approvedVersion.id },
      data: { status: 'SCHEDULED', effectiveFrom: scheduledFor },
    });
    expect(tx.versionActivation.create).toHaveBeenCalledWith({
      data: {
        strategyVersionId: approvedVersion.id,
        scheduledFor,
        correlationId: 'strategy-1:v2:20260803',
        requestedByUserId: 'operator-1',
      },
      select: {
        id: true,
        strategyVersionId: true,
        scheduledFor: true,
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('returns the same activation for an identical correlation retry', async () => {
    const { service, tx } = createHarness();
    tx.strategyVersion.findUnique.mockResolvedValueOnce(scheduledVersion);
    tx.versionActivation.findUnique.mockResolvedValue({
      id: 'activation-1',
      strategyVersionId: scheduledVersion.id,
      scheduledFor,
      requestedByUserId: null,
    });

    await expect(
      service.schedule({
        strategyVersionId: scheduledVersion.id,
        scheduledFor,
        correlationId: 'strategy-1:v2:20260803',
        now: new Date('2026-08-04T05:00:00.000Z'), // 효력시각이 지난 뒤의 장중 재시도
      }),
    ).resolves.toEqual({
      outcome: 'ALREADY_SCHEDULED',
      activationId: 'activation-1',
      strategyVersionId: scheduledVersion.id,
      scheduledFor,
    });

    expect(tx.strategyVersion.update).not.toHaveBeenCalled();
    expect(tx.versionActivation.create).not.toHaveBeenCalled();
  });

  it('rejects a reused correlation id with different request identity', async () => {
    const { service, tx } = createHarness();
    tx.strategyVersion.findUnique.mockResolvedValueOnce(approvedVersion);
    tx.versionActivation.findUnique.mockResolvedValue({
      id: 'activation-other',
      strategyVersionId: 'version-other',
      scheduledFor,
      requestedByUserId: null,
    });

    await expect(
      service.schedule({
        strategyVersionId: approvedVersion.id,
        scheduledFor,
        correlationId: 'reused',
        now: requestedAt,
      }),
    ).rejects.toMatchObject({ code: 'ACTIVATION_IDEMPOTENCY_CONFLICT' });
  });

  it('rejects an invalid correlation id before touching the database', async () => {
    const { service, prisma } = createHarness();

    await expect(
      service.schedule({
        strategyVersionId: approvedVersion.id,
        scheduledFor,
        correlationId: ' has-space',
        now: requestedAt,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTIVATION_CORRELATION_ID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('StrategyVersionActivationService.activate', () => {
  function arrangeScheduledActivation(
    tx: ReturnType<typeof createHarness>['tx'],
    overrides: Partial<typeof scheduledVersion> = {},
  ) {
    const candidate = { ...scheduledVersion, ...overrides };
    tx.versionActivation.findUnique
      .mockResolvedValueOnce({
        id: 'activation-1',
        strategyVersionId: candidate.id,
        scheduledFor,
        status: 'SCHEDULED',
        activatedAt: null,
        strategyVersion: { strategyId: candidate.strategyId },
      })
      .mockResolvedValueOnce({
        id: 'activation-1',
        strategyVersionId: candidate.id,
        scheduledFor,
        status: 'SCHEDULED',
        activatedAt: null,
        strategyVersion: candidate,
      });
    return candidate;
  }

  it('supersedes the old active version and activates the scheduled version atomically', async () => {
    const { service, prisma, tx } = createHarness();
    const candidate = arrangeScheduledActivation(tx);
    tx.strategyVersion.findFirst.mockResolvedValue({ id: 'version-1' });

    await expect(service.activate('activation-1', scheduledFor)).resolves.toEqual({
      outcome: 'ACTIVATED',
      activationId: 'activation-1',
      strategyVersionId: candidate.id,
      supersededVersionId: 'version-1',
      activatedAt: scheduledFor,
    });

    expect(tx.versionActivation.updateMany).toHaveBeenCalledWith({
      where: {
        strategyVersionId: 'version-1',
        status: 'ACTIVE',
        deactivatedAt: null,
      },
      data: { deactivatedAt: scheduledFor },
    });
    expect(tx.strategyVersion.update.mock.calls).toEqual([
      [
        {
          where: { id: 'version-1' },
          data: { status: 'SUPERSEDED', retiredAt: scheduledFor },
        },
      ],
      [
        {
          where: { id: candidate.id },
          data: { status: 'ACTIVE' },
        },
      ],
    ]);
    expect(tx.versionActivation.update).toHaveBeenCalledWith({
      where: { id: 'activation-1' },
      data: { status: 'ACTIVE', activatedAt: scheduledFor },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('returns an idempotent result before applying the market-time policy', async () => {
    const { service, tx } = createHarness();
    const activatedAt = new Date('2026-08-03T10:00:00.000Z');
    tx.versionActivation.findUnique
      .mockResolvedValueOnce({
        id: 'activation-1',
        strategyVersionId: 'version-2',
        strategyVersion: { strategyId: 'strategy-1' },
      })
      .mockResolvedValueOnce({
        id: 'activation-1',
        strategyVersionId: 'version-2',
        status: 'ACTIVE',
        activatedAt,
        strategyVersion: {
          ...scheduledVersion,
          status: 'ACTIVE',
        },
      });

    await expect(
      service.activate(
        'activation-1',
        new Date('2026-08-04T05:00:00.000Z'), // 다음 거래일 장중
      ),
    ).resolves.toEqual({
      outcome: 'ALREADY_ACTIVATED',
      activationId: 'activation-1',
      strategyVersionId: 'version-2',
      supersededVersionId: null,
      activatedAt,
    });
    expect(tx.strategyVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.strategyVersion.update).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-08-03T05:00:00.000Z', 'ACTIVATION_NOT_AFTER_MARKET_CLOSE', '거래일 장중'],
    ['2026-08-17T10:00:00.000Z', 'ACTIVATION_NOT_TRADING_DAY', 'KRX 휴장일'],
  ])('%s %s 활성화를 거부한다', async (iso, code) => {
    const { service, tx } = createHarness();
    arrangeScheduledActivation(tx);

    await expect(service.activate('activation-1', new Date(iso))).rejects.toMatchObject({
      code,
    });
    expect(tx.strategyVersion.update).not.toHaveBeenCalled();
  });

  it('rejects activation before effectiveFrom even after the close', async () => {
    const { service, tx } = createHarness();
    arrangeScheduledActivation(tx);

    await expect(
      service.activate('activation-1', new Date('2026-07-31T10:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'ACTIVATION_TOO_EARLY' });
  });

  it('rejects an activation ledger/version effective-time mismatch', async () => {
    const { service, tx } = createHarness();
    arrangeScheduledActivation(tx, {
      effectiveFrom: new Date('2026-08-04T10:00:00.000Z'),
    });

    await expect(service.activate('activation-1', scheduledFor)).rejects.toMatchObject({
      code: 'VERSION_ACTIVATION_SCHEDULE_MISMATCH',
    });
  });
});
