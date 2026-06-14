/**
 * portfolio.service.spec.ts
 * - DAR-184: 헤드라인 총수익률(totalPnlPercent) 분모 회귀 (원가 기준)
 * - DAR-171: thesisStatus 데드 삼항 수정 (실제 PositionThesis.status 매핑)
 * - DAR-219: mddPercent 진짜 MDD(peak-to-trough) 산출 회귀
 */

import { PortfolioService } from './portfolio.service';
import { computeMaxDrawdownPct } from './mdd.util';
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

interface MddSnapshot {
  totalValue: number;
  hardRuleBreached?: boolean;
}

/** 스냅샷 시계열(오름차순)을 주입해 MDD 산출을 검증하기 위한 서비스 팩토리. */
function makeMddService(snapshots: MddSnapshot[]) {
  const prisma = {
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({
        maxDailyLossPct: 2.0,
        riskSnapshots: snapshots.map((s) => ({
          totalValue: s.totalValue,
          hardRuleBreached: s.hardRuleBreached ?? false,
        })),
      }),
    },
    position: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { currentValue: 0, unrealizedPnl: 0, entryAmount: 0 } }),
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
 * DAR-247: 혼합 모집단(가격 반영 + 시세 미반영) 모집단 동기화.
 * Prisma _sum은 컬럼별 null skip이라, 시세 미반영(currentValue/unrealizedPnl null) 포지션이
 * 분모(entryAmount)에만 잡혀 수익률을 0쪽으로 희석(과소표시)하던 버그.
 * aggregate where가 priced 포지션(currentValue not null)만 집계해 분자·분모를 동기화해야 한다.
 */
describe('PortfolioService.findPortfolioSummary — 혼합 모집단 동기화(DAR-247)', () => {
  // 실제 행: priced(원가100→평가110·손익+10) + unpriced(시세 미반영, entryAmount만 100).
  const ROWS = [
    { currentValue: 110, unrealizedPnl: 10, entryAmount: 100 },
    { currentValue: null, unrealizedPnl: null, entryAmount: 100 },
  ];

  /** Prisma _sum 의미론(컬럼별 null skip, 행 없으면 null) + where 필터를 모사한다. */
  function makeMixedPopulationService() {
    const aggregate = jest.fn().mockImplementation((args: any) => {
      const pricedOnly = args?.where?.currentValue?.not === null;
      const rows = pricedOnly ? ROWS.filter((r) => r.currentValue !== null) : ROWS;
      const sumCol = (key: 'currentValue' | 'unrealizedPnl' | 'entryAmount') => {
        const vals = rows
          .map((r) => r[key])
          .filter((v): v is number => v !== null && v !== undefined);
        return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
      };
      return Promise.resolve({
        _sum: {
          currentValue: sumCol('currentValue'),
          unrealizedPnl: sumCol('unrealizedPnl'),
          entryAmount: sumCol('entryAmount'),
        },
      });
    });

    const prisma = {
      portfolio: { findFirst: jest.fn().mockResolvedValue({ riskSnapshots: [] }) },
      position: { aggregate },
    } as unknown as PrismaService;

    return { service: new PortfolioService(prisma), aggregate };
  }

  it('priced 포지션만 집계 → +10% (unpriced 원가 희석으로 +5% 아님)', async () => {
    const { service } = makeMixedPopulationService();
    const summary = await service.findPortfolioSummary('user-1');

    // 분자=priced 손익 10, 분모=priced 원가 100 → +10%.
    expect(summary.totalPnl).toBe(10);
    expect(summary.totalPnlPercent).toBeCloseTo(10, 6);
    // 버그(unpriced 원가까지 분모 200)였다면 +5%로 절반 과소표시됐을 것.
    expect(summary.totalPnlPercent).not.toBeCloseTo(5, 3);
    // totalValue도 priced 모집단(110)으로 일관.
    expect(summary.totalValue).toBe(110);
  });

  it('aggregate where에 priced 필터(currentValue not null)를 적용한다', async () => {
    const { service, aggregate } = makeMixedPopulationService();
    await service.findPortfolioSummary('user-1');

    const arg = aggregate.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      portfolio: { userId: 'user-1' },
      status: 'OPEN',
      currentValue: { not: null },
    });
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

/**
 * DAR-219: mddPercent가 '현재 미실현손익률 클램프'가 아니라 스냅샷 totalValue 시계열의
 * 진짜 최대낙폭(peak-to-trough)을 반영하는지 검증한다.
 */
describe('computeMaxDrawdownPct (DAR-219, 순수)', () => {
  it('고점→저점→회복: 100→70→105 → -30(과거 최대낙폭 반영)', () => {
    expect(computeMaxDrawdownPct([100, 70, 105])).toBeCloseTo(-30, 6);
  });

  it('2개 스냅샷 고점→저점: 100→70 → -30', () => {
    expect(computeMaxDrawdownPct([100, 70])).toBeCloseTo(-30, 6);
  });

  it('단조 상승: 100→110→120 → 0(낙폭 없음)', () => {
    expect(computeMaxDrawdownPct([100, 110, 120])).toBe(0);
  });

  it('여러 골 중 최대 낙폭 선택: 100→50→80→60 → -50(최신 -40 아님)', () => {
    expect(computeMaxDrawdownPct([100, 50, 80, 60])).toBeCloseTo(-50, 6);
  });

  it('빈 시계열·단일점·peak≤0 방어: [] → 0, [100] → 0, [0,0] → 0', () => {
    expect(computeMaxDrawdownPct([])).toBe(0);
    expect(computeMaxDrawdownPct([100])).toBe(0);
    expect(computeMaxDrawdownPct([0, 0])).toBe(0);
  });
});

describe('PortfolioService.findPortfolioSummary — mddPercent 진짜 MDD(DAR-219)', () => {
  it('고점→저점→회복(100→70→105)이면 mddPercent=-30 (기존 클램프식은 0이었다)', async () => {
    const service = makeMddService([
      { totalValue: 100 },
      { totalValue: 70 },
      { totalValue: 105 },
    ]);
    const summary = await service.findPortfolioSummary('user-1');
    expect(summary.mddPercent).toBeCloseTo(-30, 6);
  });

  it('스냅샷 totalValue 시계열을 오름차순으로 조회한다(peak-to-trough 전제)', async () => {
    const prisma = {
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({
          maxDailyLossPct: 2.0,
          riskSnapshots: [{ totalValue: 100, hardRuleBreached: false }],
        }),
      },
      position: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { currentValue: 0, unrealizedPnl: 0, entryAmount: 0 } }),
      },
    } as unknown as PrismaService;
    const service = new PortfolioService(prisma);
    await service.findPortfolioSummary('user-1');
    const arg = (prisma.portfolio.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.include.riskSnapshots.orderBy).toEqual({ snapshotDate: 'asc' });
  });

  it('mddBreached는 최신(마지막) 스냅샷의 hardRuleBreached를 쓴다', async () => {
    const service = makeMddService([
      { totalValue: 100, hardRuleBreached: false },
      { totalValue: 70, hardRuleBreached: true },
    ]);
    const summary = await service.findPortfolioSummary('user-1');
    expect(summary.mddBreached).toBe(true);
    expect(summary.mddPercent).toBeCloseTo(-30, 6);
  });

  it('스냅샷이 없으면 mddPercent=undefined·mddBreached=false', async () => {
    const service = makeMddService([]);
    const summary = await service.findPortfolioSummary('user-1');
    expect(summary.mddPercent).toBeUndefined();
    expect(summary.mddBreached).toBe(false);
  });
});
