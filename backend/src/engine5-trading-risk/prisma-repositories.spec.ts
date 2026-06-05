/**
 * prisma-repositories.spec.ts — Engine5 Prisma 영속화 어댑터 단위 테스트 (M11, DAR-36)
 *
 * 실제 DB 없이 PrismaService를 목(mock)으로 주입해 어댑터의
 *   1) IPaperTradeRepository / IAuditLogRepository 100% 구현
 *   2) 도메인 ↔ Prisma row 매핑 (Decimal→number, slippageCost↔slippage, meta Json, enum)
 * 을 결정론적으로 검증한다.
 *
 * AI 금지영역: 이 테스트는 저장/매핑만 다룬다. 체결·Risk 계산 로직 없음(AI 개입 0).
 */

import { PrismaPaperTradeRepository } from './repositories/prisma-paper-trade.repository';
import { PrismaAuditLogRepository } from './repositories/prisma-audit-log.repository';
import type { PaperTradeRecord } from './repositories/paper-trade.repository';
import type { CreateAuditLogInput } from './repositories/audit-log.repository';

// ─── PrismaService 목 ─────────────────────────────────────────────────

function makePrismaMock() {
  const paperTrade = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };
  const tradingAuditLog = {
    create: jest.fn(),
    findMany: jest.fn(),
  };
  return { paperTrade, tradingAuditLog } as any;
}

// Prisma가 Decimal 컬럼을 반환하는 방식을 흉내 — Number()로 정규화되는지 확인하려고
// .toNumber()/valueOf를 가진 객체로 일부 값을 준다.
function decimal(n: number) {
  return { toNumber: () => n, valueOf: () => n, toString: () => String(n) };
}

function makeTradeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'paper-trade-1',
    corpCode: '00126380',
    stockCode: '005930',
    direction: 'BUY',
    orderedShares: 100,
    filledShares: 100,
    fillRate: decimal(1),
    entryPrice: decimal(70000),
    filledPrice: decimal(70035),
    commission: decimal(1050),
    tax: decimal(0),
    slippage: decimal(3500),
    grossPnl: null,
    netPnl: null,
    returnPct: null,
    status: 'FILLED',
    entryDate: new Date('2026-01-02T00:00:00Z'),
    filledAt: new Date('2026-01-02T09:00:00Z'),
    tradingSignalId: 'sig-1',
    positionThesisId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDomainTrade(): Omit<PaperTradeRecord, 'id' | 'createdAt'> {
  return {
    corpCode: '00126380',
    stockCode: '005930',
    direction: 'BUY',
    orderedShares: 100,
    filledShares: 100,
    fillRate: 1,
    entryPrice: 70000,
    filledPrice: 70035,
    commission: 1050,
    tax: 0,
    slippageCost: 3500,
    grossPnl: null,
    netPnl: null,
    returnPct: null,
    status: 'FILLED',
    entryDate: new Date('2026-01-02T00:00:00Z'),
    filledAt: new Date('2026-01-02T09:00:00Z'),
    tradingSignalId: 'sig-1',
    positionThesisId: null,
  };
}

// ─── 1. PrismaPaperTradeRepository ────────────────────────────────────

describe('PrismaPaperTradeRepository', () => {
  it('IPaperTradeRepository의 모든 메서드를 구현한다(미구현 0)', () => {
    const repo = new PrismaPaperTradeRepository(makePrismaMock());
    ['save', 'findById', 'findByStatus', 'findAll'].forEach((m) =>
      expect(typeof (repo as any)[m]).toBe('function'),
    );
  });

  it('save(): id/createdAt은 DB 위임, slippageCost→slippage 컬럼 매핑', async () => {
    const prisma = makePrismaMock();
    prisma.paperTrade.create.mockResolvedValue(makeTradeRow());
    const repo = new PrismaPaperTradeRepository(prisma);

    const result = await repo.save(makeDomainTrade());

    expect(prisma.paperTrade.create).toHaveBeenCalledTimes(1);
    const data = prisma.paperTrade.create.mock.calls[0][0].data;
    // id/createdAt은 넘기지 않는다(인메모리 Omit 시맨틱)
    expect(data.id).toBeUndefined();
    expect(data.createdAt).toBeUndefined();
    // 도메인 slippageCost → DB slippage 컬럼
    expect(data.slippage).toBe(3500);
    expect('slippageCost' in data).toBe(false);
    expect(data.direction).toBe('BUY');
    // 반환은 도메인 레코드(Decimal→number 복원)
    expect(result.id).toBe('paper-trade-1');
    expect(result.slippageCost).toBe(3500);
    expect(result.entryPrice).toBe(70000);
    expect(typeof result.entryPrice).toBe('number');
  });

  it('findById(): Decimal→number 매핑, 미존재 시 null', async () => {
    const prisma = makePrismaMock();
    prisma.paperTrade.findUnique
      .mockResolvedValueOnce(makeTradeRow())
      .mockResolvedValueOnce(null);
    const repo = new PrismaPaperTradeRepository(prisma);

    const found = await repo.findById('paper-trade-1');
    expect(found!.id).toBe('paper-trade-1');
    expect(found!.fillRate).toBe(1);
    expect(found!.filledPrice).toBe(70035);

    expect(await repo.findById('missing')).toBeNull();
  });

  it('findById(): nullable Decimal(grossPnl/netPnl/returnPct/filledPrice)은 null 유지', async () => {
    const prisma = makePrismaMock();
    prisma.paperTrade.findUnique.mockResolvedValue(
      makeTradeRow({
        filledPrice: null,
        grossPnl: null,
        netPnl: null,
        returnPct: null,
        status: 'PENDING',
        filledShares: 0,
        filledAt: null,
      }),
    );
    const repo = new PrismaPaperTradeRepository(prisma);
    const found = await repo.findById('paper-trade-1');
    expect(found!.filledPrice).toBeNull();
    expect(found!.grossPnl).toBeNull();
    expect(found!.netPnl).toBeNull();
    expect(found!.returnPct).toBeNull();
    expect(found!.filledAt).toBeNull();
  });

  it('findByStatus(): status를 where로 전달하고 배열 매핑', async () => {
    const prisma = makePrismaMock();
    prisma.paperTrade.findMany.mockResolvedValue([
      makeTradeRow(),
      makeTradeRow({ id: 'paper-trade-2' }),
    ]);
    const repo = new PrismaPaperTradeRepository(prisma);

    const list = await repo.findByStatus('FILLED');
    expect(prisma.paperTrade.findMany).toHaveBeenCalledWith({
      where: { status: 'FILLED' },
    });
    expect(list).toHaveLength(2);
    expect(list[1].id).toBe('paper-trade-2');
  });

  it('findAll(): 전체 조회 후 배열 매핑', async () => {
    const prisma = makePrismaMock();
    prisma.paperTrade.findMany.mockResolvedValue([makeTradeRow()]);
    const repo = new PrismaPaperTradeRepository(prisma);

    const list = await repo.findAll();
    expect(prisma.paperTrade.findMany).toHaveBeenCalledWith();
    expect(list).toHaveLength(1);
  });
});

// ─── 2. PrismaAuditLogRepository ──────────────────────────────────────

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    action: 'RISK_PASSED',
    actorKind: 'RISK_ENGINE',
    summary: '위험성 검사 통과',
    orderRequestId: 'ord-1',
    executionId: null,
    meta: { rule: 'MAX_NOTIONAL', passed: true },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeAuditInput(
  overrides: Partial<CreateAuditLogInput> = {},
): CreateAuditLogInput {
  return {
    action: 'RISK_PASSED',
    actorKind: 'RISK_ENGINE',
    summary: '위험성 검사 통과',
    orderRequestId: 'ord-1',
    meta: { rule: 'MAX_NOTIONAL', passed: true },
    ...overrides,
  };
}

describe('PrismaAuditLogRepository', () => {
  it('IAuditLogRepository의 모든 메서드를 구현한다(미구현 0)', () => {
    const repo = new PrismaAuditLogRepository(makePrismaMock());
    ['save', 'findByOrderRequestId', 'findAll'].forEach((m) =>
      expect(typeof (repo as any)[m]).toBe('function'),
    );
  });

  it('save(): action/meta 매핑, id/createdAt은 DB 위임', async () => {
    const prisma = makePrismaMock();
    prisma.tradingAuditLog.create.mockResolvedValue(makeAuditRow());
    const repo = new PrismaAuditLogRepository(prisma);

    const result = await repo.save(makeAuditInput());

    const data = prisma.tradingAuditLog.create.mock.calls[0][0].data;
    expect(data.id).toBeUndefined();
    expect(data.createdAt).toBeUndefined();
    expect(data.action).toBe('RISK_PASSED');
    expect(data.orderRequestId).toBe('ord-1');
    expect(data.executionId).toBeNull();
    expect(data.meta).toEqual({ rule: 'MAX_NOTIONAL', passed: true });
    expect(result.id).toBe('audit-1');
    expect(result.meta).toEqual({ rule: 'MAX_NOTIONAL', passed: true });
  });

  it('save(): meta 미지정이면 Prisma.JsonNull로 저장, 결과 meta=null', async () => {
    const prisma = makePrismaMock();
    prisma.tradingAuditLog.create.mockResolvedValue(
      makeAuditRow({ meta: null, action: 'KILL_SWITCH_SET', orderRequestId: null }),
    );
    const repo = new PrismaAuditLogRepository(prisma);

    const result = await repo.save(
      makeAuditInput({ action: 'KILL_SWITCH_SET', orderRequestId: null, meta: null }),
    );
    const data = prisma.tradingAuditLog.create.mock.calls[0][0].data;
    // Prisma.JsonNull 객체로 전달(undefined가 아님 — nullable Json 컬럼에 null 명시)
    expect(data.meta).toBeDefined();
    expect(result.meta).toBeNull();
    expect(result.orderRequestId).toBeNull();
  });

  it('findByOrderRequestId(): where + createdAt asc 정렬로 조회', async () => {
    const prisma = makePrismaMock();
    prisma.tradingAuditLog.findMany.mockResolvedValue([
      makeAuditRow(),
      makeAuditRow({ id: 'audit-2', action: 'ORDER_EXECUTED' }),
    ]);
    const repo = new PrismaAuditLogRepository(prisma);

    const list = await repo.findByOrderRequestId('ord-1');
    const arg = prisma.tradingAuditLog.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ orderRequestId: 'ord-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'asc' });
    expect(list).toHaveLength(2);
    expect(list[1].action).toBe('ORDER_EXECUTED');
  });

  it('findAll(): limit을 take로 전달, 시간 오름차순(오래된→최신)으로 반환', async () => {
    const prisma = makePrismaMock();
    // DB는 createdAt desc(최신순)로 반환 → 어댑터가 reverse하여 오래된→최신
    prisma.tradingAuditLog.findMany.mockResolvedValue([
      makeAuditRow({ id: 'audit-new' }),
      makeAuditRow({ id: 'audit-old' }),
    ]);
    const repo = new PrismaAuditLogRepository(prisma);

    const list = await repo.findAll(50);
    const arg = prisma.tradingAuditLog.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(50);
    expect(list.map((l) => l.id)).toEqual(['audit-old', 'audit-new']);
  });

  it('findAll(): limit 미지정 시 기본 100', async () => {
    const prisma = makePrismaMock();
    prisma.tradingAuditLog.findMany.mockResolvedValue([]);
    const repo = new PrismaAuditLogRepository(prisma);

    await repo.findAll();
    expect(prisma.tradingAuditLog.findMany.mock.calls[0][0].take).toBe(100);
  });
});
