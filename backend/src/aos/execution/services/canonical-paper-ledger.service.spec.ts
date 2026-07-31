import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../prisma/prisma.service';
import { AosAccountBootstrapService } from './aos-account-bootstrap.service';
import { CanonicalPaperLedgerService } from './canonical-paper-ledger.service';

describe('CanonicalPaperLedgerService fill lifecycle', () => {
  it('플래그 OFF이면 어떤 DB write도 하지 않는다', async () => {
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    const service = new CanonicalPaperLedgerService(
      { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService,
      prisma,
      {} as AosAccountBootstrapService,
    );
    await expect(service.recordFill(fill())).resolves.toEqual({ status: 'DISABLED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('유효기간이 지난 plan은 체결하지 않고 EXPIRED/REJECTED로 종결한다', async () => {
    const tx = transactionClient({ expiresAt: new Date('2026-07-01T00:00:00.000Z') });
    const service = enabledService(tx);
    await expect(service.recordFill(fill())).resolves.toEqual({ status: 'STALE' });
    expect(tx.aosOrderFill.createMany).not.toHaveBeenCalled();
    expect(tx.aosOrderPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
    expect(tx.aosOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });

  it('부분 체결은 append-only fill과 PARTIAL 상태로 남기며 재시도 키를 고정한다', async () => {
    const tx = transactionClient();
    tx.aosOrderFill.aggregate.mockResolvedValue({ _sum: { quantity: 40 } });
    const service = enabledService(tx);
    const result = await service.recordFill(fill({ filledShares: 40 }));
    expect(result.status).toBe('PARTIAL');
    expect(tx.aosOrderFill.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.aosOrder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'PARTIAL' } }),
    );
    expect(tx.aosOrderPlan.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXECUTED' } }),
    );
  });

  it('Kill Switch 발동 중에는 유효 plan도 fill 전에 취소한다', async () => {
    const tx = transactionClient();
    const service = enabledService(tx);
    await expect(service.recordFill(fill({ killSwitchActive: true }))).resolves.toEqual({
      status: 'KILLED',
    });
    expect(tx.aosOrderFill.createMany).not.toHaveBeenCalled();
    expect(tx.aosOrderPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
  });
});

function enabledService(tx: ReturnType<typeof transactionClient>) {
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  } as unknown as PrismaService;
  return new CanonicalPaperLedgerService(
    { get: jest.fn().mockReturnValue(true) } as unknown as ConfigService,
    prisma,
    {} as AosAccountBootstrapService,
  );
}

function transactionClient(over: { expiresAt?: Date } = {}) {
  return {
    aosOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: 'NEW',
        requestedQuantity: 100,
        orderPlan: {
          id: 'plan-1',
          status: 'APPROVED',
          validFrom: new Date('2026-07-01T00:00:00.000Z'),
          expiresAt: over.expiresAt ?? new Date('2026-08-01T00:00:00.000Z'),
        },
        fills: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    aosOrderPlan: { update: jest.fn().mockResolvedValue({}) },
    aosOrderFill: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 100 } }),
    },
  };
}

function fill(over: Partial<Parameters<CanonicalPaperLedgerService['recordFill']>[0]> = {}) {
  return {
    paperTradeId: 'paper-1',
    filledShares: 100,
    filledPrice: 70_000,
    commission: 100,
    tax: 0,
    slippage: 200,
    filledAt: new Date('2026-07-10T00:00:00.000Z'),
    killSwitchActive: false,
    ...over,
  };
}
