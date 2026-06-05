/**
 * prisma-repositories.spec.ts — Prisma 영속화 어댑터 단위 테스트 (M8, DAR-34)
 *
 * 실제 DB 없이 PrismaService를 목(mock)으로 주입해 어댑터의
 *   1) IPositionThesisRepository / IExitSignalRepository 100% 구현
 *   2) 도메인 ↔ Prisma row 매핑 (Json 직렬화, enum, aiUsed=false)
 * 을 결정론적으로 검증한다.
 *
 * AI 금지영역: 이 테스트는 저장/매핑만 다룬다. Score·트리거 계산 로직 없음(AI 개입 0).
 */

import { PrismaPositionThesisRepository } from './repositories/prisma-position-thesis.repository';
import { PrismaExitSignalRepository } from './repositories/prisma-exit-signal.repository';
import type { PositionThesisRecord } from './domain/position-thesis.types';
import type { CreateExitSignalParams } from './repositories/exit-signal.repository';
import type { ExitScoreComponents } from './domain/exit-engine.types';

// ─── PrismaService 목 ─────────────────────────────────────────────────

function makePrismaMock() {
  const positionThesis = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const exitSignal = {
    create: jest.fn(),
    findFirst: jest.fn(),
  };
  return { positionThesis, exitSignal } as any;
}

function makeThesisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thesis-1',
    tradingSignalId: 'sig-1',
    rcpNo: 'RCP20260101000001',
    corpCode: '00126380',
    entryReason: '진입 사유',
    initialThesis: ['근거1', '근거2'],
    invalidConditions: [{ type: 'STOP_LOSS_PCT', value: 8 }],
    exitRules: [{ type: 'MAX_HOLD_DAYS', value: 20 }],
    maxWeight: 5.0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDomainThesis(): PositionThesisRecord {
  return {
    id: 'thesis-1',
    tradingSignalId: 'sig-1',
    rcpNo: 'RCP20260101000001',
    corpCode: '00126380',
    entryReason: '진입 사유',
    initialThesis: ['근거1', '근거2'],
    invalidConditions: [{ type: 'STOP_LOSS_PCT', value: 8 }],
    exitRules: [{ type: 'MAX_HOLD_DAYS', value: 20 }],
    maxWeight: 5.0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

// ─── 1. PrismaPositionThesisRepository ────────────────────────────────

describe('PrismaPositionThesisRepository', () => {
  it('IPositionThesisRepository의 모든 메서드를 구현한다(미구현 0)', () => {
    const repo = new PrismaPositionThesisRepository(makePrismaMock());
    const methods = [
      'save',
      'findById',
      'findBySignalId',
      'findByCorpCode',
      'findByStatus',
      'updateStatus',
      'findAll',
    ];
    methods.forEach((m) => expect(typeof (repo as any)[m]).toBe('function'));
  });

  it('save(): upsert로 저장하고 Json 필드를 그대로 전달, 도메인 레코드 반환', async () => {
    const prisma = makePrismaMock();
    prisma.positionThesis.upsert.mockResolvedValue(makeThesisRow());
    const repo = new PrismaPositionThesisRepository(prisma);

    const result = await repo.save(makeDomainThesis());

    expect(prisma.positionThesis.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.positionThesis.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'thesis-1' });
    expect(arg.create.invalidConditions).toEqual([{ type: 'STOP_LOSS_PCT', value: 8 }]);
    expect(arg.update.status).toBe('ACTIVE');
    expect(result.tradingSignalId).toBe('sig-1');
    expect(result.invalidConditions).toEqual([{ type: 'STOP_LOSS_PCT', value: 8 }]);
  });

  it('findById(): row를 도메인 레코드로 매핑, 미존재 시 null', async () => {
    const prisma = makePrismaMock();
    prisma.positionThesis.findUnique
      .mockResolvedValueOnce(makeThesisRow())
      .mockResolvedValueOnce(null);
    const repo = new PrismaPositionThesisRepository(prisma);

    const found = await repo.findById('thesis-1');
    expect(found!.id).toBe('thesis-1');
    expect(found!.initialThesis).toEqual(['근거1', '근거2']);

    expect(await repo.findById('missing')).toBeNull();
  });

  it('findByStatus(): status를 where로 전달하고 배열 매핑', async () => {
    const prisma = makePrismaMock();
    prisma.positionThesis.findMany.mockResolvedValue([makeThesisRow(), makeThesisRow({ id: 'thesis-2' })]);
    const repo = new PrismaPositionThesisRepository(prisma);

    const list = await repo.findByStatus('ACTIVE');
    expect(prisma.positionThesis.findMany).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    expect(list).toHaveLength(2);
  });

  it('updateStatus(): update 호출 후 매핑된 레코드 반환', async () => {
    const prisma = makePrismaMock();
    prisma.positionThesis.update.mockResolvedValue(makeThesisRow({ status: 'INVALIDATED' }));
    const repo = new PrismaPositionThesisRepository(prisma);

    const updated = await repo.updateStatus('thesis-1', 'INVALIDATED');
    expect(prisma.positionThesis.update).toHaveBeenCalledWith({
      where: { id: 'thesis-1' },
      data: { status: 'INVALIDATED' },
    });
    expect(updated.status).toBe('INVALIDATED');
  });

  it('Json 필드가 null이어도 빈 배열로 안전 매핑', async () => {
    const prisma = makePrismaMock();
    prisma.positionThesis.findUnique.mockResolvedValue(
      makeThesisRow({ initialThesis: null, invalidConditions: null, exitRules: null }),
    );
    const repo = new PrismaPositionThesisRepository(prisma);
    const found = await repo.findById('thesis-1');
    expect(found!.initialThesis).toEqual([]);
    expect(found!.invalidConditions).toEqual([]);
    expect(found!.exitRules).toEqual([]);
  });
});

// ─── 2. PrismaExitSignalRepository ────────────────────────────────────

function makeComponents(): ExitScoreComponents {
  return {
    lossRiskScore: 15,
    thesisBreakScore: 10,
    chartBreakScore: 5,
    disclosureRiskScore: 0,
    overweightScore: 0,
    timeExceededScore: 0,
    positiveMomentumBonus: 0,
  };
}

function makeExitParams(overrides: Partial<CreateExitSignalParams> = {}): CreateExitSignalParams {
  return {
    positionId: 'pos-1',
    checkTime: 'PRE_MARKET',
    components: makeComponents(),
    exitScore: 30,
    exitAction: 'WATCH',
    triggerTypes: ['STOP_LOSS', 'THESIS_INVALIDATED'],
    primaryTrigger: 'STOP_LOSS',
    scoreDetail: { components: makeComponents() },
    ...overrides,
  };
}

describe('PrismaExitSignalRepository', () => {
  it('IExitSignalRepository의 모든 메서드를 구현한다(미구현 0)', () => {
    const repo = new PrismaExitSignalRepository(makePrismaMock());
    expect(typeof repo.save).toBe('function');
    expect(typeof repo.findLatestByPositionId).toBe('function');
  });

  it('save(): 7개 컴포넌트를 개별 컬럼으로 매핑하고 aiUsed=false 강제', async () => {
    const prisma = makePrismaMock();
    prisma.exitSignal.create.mockResolvedValue({ id: 'exit-1' });
    const repo = new PrismaExitSignalRepository(prisma);

    const result = await repo.save(makeExitParams());

    expect(result).toEqual({ id: 'exit-1' });
    const data = prisma.exitSignal.create.mock.calls[0][0].data;
    expect(data.lossRiskScore).toBe(15);
    expect(data.thesisBreakScore).toBe(10);
    expect(data.exitAction).toBe('WATCH');
    expect(data.triggerType).toBe('STOP_LOSS'); // primaryTrigger → triggerType
    expect(data.triggerTypes).toEqual(['STOP_LOSS', 'THESIS_INVALIDATED']);
    expect(data.aiUsed).toBe(false); // AI 금지영역 보장
  });

  it('save(): primaryTrigger=null이면 triggerType=null', async () => {
    const prisma = makePrismaMock();
    prisma.exitSignal.create.mockResolvedValue({ id: 'exit-2' });
    const repo = new PrismaExitSignalRepository(prisma);

    await repo.save(makeExitParams({ primaryTrigger: null }));
    expect(prisma.exitSignal.create.mock.calls[0][0].data.triggerType).toBeNull();
  });

  it('findLatestByPositionId(): checkedAt desc 정렬로 최신 1건 조회', async () => {
    const prisma = makePrismaMock();
    prisma.exitSignal.findFirst.mockResolvedValue({ exitScore: 72, exitAction: 'EXIT' });
    const repo = new PrismaExitSignalRepository(prisma);

    const latest = await repo.findLatestByPositionId('pos-1');
    expect(latest).toEqual({ exitScore: 72, exitAction: 'EXIT' });
    const arg = prisma.exitSignal.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ positionId: 'pos-1' });
    expect(arg.orderBy[0]).toEqual({ checkedAt: 'desc' });
  });

  it('findLatestByPositionId(): 없으면 null', async () => {
    const prisma = makePrismaMock();
    prisma.exitSignal.findFirst.mockResolvedValue(null);
    const repo = new PrismaExitSignalRepository(prisma);
    expect(await repo.findLatestByPositionId('pos-x')).toBeNull();
  });
});
