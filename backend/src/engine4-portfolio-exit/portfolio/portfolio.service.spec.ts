/**
 * portfolio.service.spec.ts
 * - DAR-184: 헤드라인 총수익률(totalPnlPercent) 분모 회귀 (원가 기준)
 * - DAR-171: thesisStatus 데드 삼항 수정 (실제 PositionThesis.status 매핑)
 */

import { PortfolioService } from './portfolio.service';
import type { PrismaService } from '../../prisma/prisma.service';

interface AggSum {
  currentValue: number | null;
  unrealizedPnl: number | null;
  entryAmount: number | null;
}

function makeSummaryService(aggSum: AggSum) {
  const prisma = {
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({ riskSnapshots: [] }),
    },
    position: {
      aggregate: jest.fn().mockResolvedValue({ _sum: aggSum }),
    },
  } as unknown as PrismaService;

  return new PortfolioService(prisma);
}

describe('PortfolioService.findPortfolioSummary — 총수익률 분모(DAR-184)', () => {
  it('이익 구간: 원가100→평가110(손익+10)이면 +10% (분모=원가)', async () => {
    const service = makeSummaryService({ currentValue: 110, unrealizedPnl: 10, entryAmount: 100 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnl).toBe(10);
    expect(summary.totalPnlPercent).toBeCloseTo(10, 6);
    // 평가금액 분모였다면 +9.09%로 과소 평가됐을 것.
    expect(summary.totalPnlPercent).not.toBeCloseTo(9.0909, 3);
  });

  it('손실 구간: 원가100→평가50(손익-50)이면 -50% (분모=원가, -100% 아님)', async () => {
    const service = makeSummaryService({ currentValue: 50, unrealizedPnl: -50, entryAmount: 100 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnl).toBe(-50);
    expect(summary.totalPnlPercent).toBeCloseTo(-50, 6);
    // 평가금액 분모였다면 -100%로 손실을 과대 평가했을 것.
    expect(summary.totalPnlPercent).not.toBeCloseTo(-100, 3);
  });

  it('다종목 합산: 원가합200·손익합+30이면 +15%', async () => {
    const service = makeSummaryService({ currentValue: 230, unrealizedPnl: 30, entryAmount: 200 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnlPercent).toBeCloseTo(15, 6);
  });

  it('원가 합이 0(포지션 없음)이면 0% — 0 나눗셈 방지', async () => {
    const service = makeSummaryService({ currentValue: 0, unrealizedPnl: 0, entryAmount: 0 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnlPercent).toBe(0);
  });

  it('entryAmount 합이 null(미집계)이어도 0%로 안전 폴백', async () => {
    const service = makeSummaryService({ currentValue: null, unrealizedPnl: null, entryAmount: null });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalValue).toBe(0);
    expect(summary.totalPnl).toBe(0);
    expect(summary.totalPnlPercent).toBe(0);
  });
});

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
