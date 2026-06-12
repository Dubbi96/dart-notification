import { PortfolioService } from './portfolio.service';

/**
 * DAR-171: thesisStatus 데드 삼항(양 분기 모두 'ACTIVE') 수정 검증.
 * 실제 PositionThesis.status(DB) → 화면용 ThesisStatus 매핑이 응답에 반영되는지 확인한다.
 */
describe('PortfolioService thesisStatus 매핑 (DAR-171)', () => {
  function makePosition(thesisStatus: string | null) {
    return {
      id: 'pos-1',
      portfolio: { id: 'pf-1' },
      corpCode: '00126380',
      company: { corpName: '삼성전자', stockCode: '005930' },
      unrealizedPnlPct: 1.2,
      quantity: 10,
      entryPrice: 50000,
      currentPrice: 51000,
      positionThesisId: thesisStatus ? 'th-1' : null,
      positionThesis: thesisStatus ? { status: thesisStatus } : null,
    };
  }

  function makeService(position: ReturnType<typeof makePosition>) {
    const prisma = {
      position: {
        findMany: jest.fn().mockResolvedValue([position]),
        findFirst: jest.fn().mockResolvedValue(position),
      },
    } as any;
    return new PortfolioService(prisma);
  }

  it('findUserPositions: thesis INVALIDATED → 응답 VIOLATED', async () => {
    const service = makeService(makePosition('INVALIDATED'));
    const [row] = await service.findUserPositions('user-1');
    expect(row.thesisStatus).toBe('VIOLATED');
  });

  it('findPosition: thesis INVALIDATED → 응답 VIOLATED', async () => {
    const service = makeService(makePosition('INVALIDATED'));
    const row = await service.findPosition('user-1', 'pos-1');
    expect(row.thesisStatus).toBe('VIOLATED');
  });

  it('findUserPositions: thesis CLOSED → 응답 EXPIRED', async () => {
    const service = makeService(makePosition('CLOSED'));
    const [row] = await service.findUserPositions('user-1');
    expect(row.thesisStatus).toBe('EXPIRED');
  });

  it('findUserPositions: thesis ACTIVE → 응답 ACTIVE', async () => {
    const service = makeService(makePosition('ACTIVE'));
    const [row] = await service.findUserPositions('user-1');
    expect(row.thesisStatus).toBe('ACTIVE');
  });

  it('findUserPositions: thesis 미연결 → 응답 ACTIVE(기본값)', async () => {
    const service = makeService(makePosition(null));
    const [row] = await service.findUserPositions('user-1');
    expect(row.thesisStatus).toBe('ACTIVE');
  });

  it('findUserPositions: positionThesis를 include 한다(status select)', async () => {
    const position = makePosition('INVALIDATED');
    const prisma = {
      position: {
        findMany: jest.fn().mockResolvedValue([position]),
        findFirst: jest.fn(),
      },
    } as any;
    const service = new PortfolioService(prisma);
    await service.findUserPositions('user-1');
    const arg = prisma.position.findMany.mock.calls[0][0];
    expect(arg.include.positionThesis).toEqual({ select: { status: true } });
  });
});
