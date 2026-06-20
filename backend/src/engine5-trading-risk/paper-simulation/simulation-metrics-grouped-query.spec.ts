/**
 * simulation-metrics-grouped-query.spec.ts — DAR-206 N+1 제거 회귀 안전망 (DB 미사용, mocked prisma)
 *
 * computeMetrics(사용자 노출 simulation status/equity-curve 경로) 가 포지션 수에 비례하던
 * 포지션별 스냅샷/청산후 종가 쿼리(2N+) 를 grouped 단일 쿼리로 바꾼 뒤:
 *   (1) 쿼리수 상수화 — 포지션 5개·20개 픽스처에서 positionDailySnapshot.findMany 와
 *       stockDailyPrice.findMany 가 각각 정확히 1회만 호출(N 과 무관).
 *   (2) 메트릭값 회귀 0 — grouped+메모리 그룹핑이 per-position take 와 동일한 표본/적중률을 산출.
 *       (positionId 당 앞 6개만, corpCode 당 청산일 초과 앞 3개만 — 경계: 5개 스냅샷=미달, 7개=6번째 사용)
 */

import { PaperSimulationService } from './paper-simulation.service';

type AnyFn = jest.Mock;

interface SnapRow {
  positionId: string;
  closePrice: number | null;
}
interface PriceRow {
  corpCode: string;
  tradeDate: string;
  closePrice: number;
}

/** 픽스처: open/closed 포지션 + 스냅샷 행 + 청산후 종가 행을 받아 mocked prisma 를 만든다. */
function makePrisma(opts: {
  open: Array<{ id: string }>;
  closed: Array<{ id: string; corpCode: string; closedAt: Date | null }>;
  snapRows: SnapRow[];
  priceRows: PriceRow[];
}) {
  const ENTRY = 1000;
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
      create: jest.fn(),
    },
    position: {
      findMany: jest.fn(async ({ where }: { where?: { status?: string } }) => {
        if (where?.status === 'CLOSED') {
          return opts.closed.map((c) => ({
            id: c.id,
            entryPrice: ENTRY,
            quantity: 1,
            unrealizedPnl: 0,
            closedAt: c.closedAt,
            corpCode: c.corpCode,
          }));
        }
        return opts.open.map((o) => ({
          id: o.id,
          entryPrice: ENTRY,
          quantity: 1,
          unrealizedPnl: 0,
          entryDate: new Date('2026-01-01T00:00:00Z'),
        }));
      }),
    },
    positionDailySnapshot: {
      // grouped: where.positionId.in 단일 호출 — 입력 순서(positionId asc, snapshotDate asc) 그대로 반환.
      findMany: jest.fn(async () => opts.snapRows),
    },
    stockDailyPrice: {
      // exit batch: corpCode in(...) 단일 호출 — corpCode asc, tradeDate asc 정렬된 행 반환.
      findMany: jest.fn(async () => opts.priceRows),
      // DAR-393: getEquityCurve 가 헤더와 동일한 live 평가(getOpenPositionDetails→revalueLive→
      //   latestPriceRow)를 호출 → 실가 미가용(null) 폴백. findMany 카운트(위 grouped 단언)와 무관.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // DAR-393: getOpenPositionDetails 의 회사명 보강 조회(보유 포지션 표시) — 빈 결과 스텁.
    company: { findMany: jest.fn().mockResolvedValue([]) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

function svcOf(prisma: ReturnType<typeof makePrisma>) {
  // priceSource 미주입(폴백) — 순수 prisma 경로. paperTrade 는 미사용(메트릭 조회).
  return new PaperSimulationService(prisma as never, {} as never);
}

describe('DAR-206 — computeMetrics grouped 쿼리 (N+1 제거)', () => {
  it('쿼리수 상수화: 포지션 5개·20개에서 스냅샷/청산종가 findMany 각각 1회', async () => {
    const counts: number[] = [];
    for (const n of [5, 20]) {
      const open = Array.from({ length: n }, (_, i) => ({ id: `o${i}` }));
      const closed = Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        corpCode: `CORP${i}`,
        closedAt: new Date('2026-01-10T00:00:00Z'),
      }));
      const prisma = makePrisma({ open, closed, snapRows: [], priceRows: [] });
      await svcOf(prisma).getEquityCurve();
      expect((prisma.positionDailySnapshot.findMany as AnyFn).mock.calls.length).toBe(1);
      expect((prisma.stockDailyPrice.findMany as AnyFn).mock.calls.length).toBe(1);
      counts.push(n);
    }
    expect(counts).toEqual([5, 20]); // 두 규모 모두 위 단언 통과 = 상수 쿼리
  });

  it('메트릭값 회귀 0: grouped 그룹핑이 per-position take 표본/적중률과 동일', async () => {
    // OPEN: o0 6스냅(D5=1100 win), o1 6스냅(D5=900 loss), o2 5스냅(미달→null),
    //       o3 7스냅(6번째=1100 win, 7번째=9999 무시), o4 0스냅(null)
    // CLOSED: c0..c4 모두 6스냅(D5=1100 win) → 적중률 표본 5건 추가
    const open = ['o0', 'o1', 'o2', 'o3', 'o4'].map((id) => ({ id }));
    const closed = ['c0', 'c1', 'c2', 'c3', 'c4'].map((id, i) => ({
      id,
      corpCode: `CORP${i}`,
      closedAt: new Date('2026-01-10T00:00:00Z'),
    }));

    const sixWith = (id: string, d5: number, extra: number[] = []): SnapRow[] =>
      [100, 200, 300, 400, 500, d5, ...extra].map((closePrice) => ({ positionId: id, closePrice }));
    const snapRows: SnapRow[] = [
      ...sixWith('o0', 1100),
      ...sixWith('o1', 900),
      ...[100, 200, 300, 400, 500].map((c) => ({ positionId: 'o2', closePrice: c })), // 5개=미달
      ...sixWith('o3', 1100, [9999]), // 7번째는 take6 에서 무시
      // o4: 스냅 없음
      ...sixWith('c0', 1100),
      ...sixWith('c1', 1100),
      ...sixWith('c2', 1100),
      ...sixWith('c3', 1100),
      ...sixWith('c4', 1100),
    ];

    // 청산후 종가(>20260110): c0 D3=900(hit), c1 D3=1100(miss), c2 2개만(미달),
    //   c3 D3=900(hit), c4 0개(null)
    const after3 = (corp: string, d3: number): PriceRow[] =>
      [
        { corpCode: corp, tradeDate: '20260111', closePrice: 950 },
        { corpCode: corp, tradeDate: '20260112', closePrice: 970 },
        { corpCode: corp, tradeDate: '20260113', closePrice: d3 },
      ];
    const priceRows: PriceRow[] = [
      ...after3('CORP0', 900),
      ...after3('CORP1', 1100),
      { corpCode: 'CORP2', tradeDate: '20260111', closePrice: 950 }, // 2개만
      { corpCode: 'CORP2', tradeDate: '20260112', closePrice: 970 },
      ...after3('CORP3', 900),
      // CORP4: 행 없음
    ];

    const prisma = makePrisma({ open, closed, snapRows, priceRows });
    const { metrics } = await svcOf(prisma).getEquityCurve();

    // 적중률 표본 = o0,o1,o3,c0..c4 = 8건 (o2 5개미달·o4 0개 제외)
    expect(metrics.hitRateSampleSize).toBe(8);
    // 승(D5>0) = o0,o3,c0..c4 = 7 → 7/8
    expect(metrics.hitRateD5).toBeCloseTo(7 / 8, 10);

    // Exit 표본 = c0,c1,c3 = 3건 (c2 미달·c4 없음 제외)
    expect(metrics.exitAccuracySampleSize).toBe(3);
    // 손절적중(D3<0) = c0,c3 = 2 → 2/3
    expect(metrics.exitAccuracyD3).toBeCloseTo(2 / 3, 10);

    // 단일 grouped 호출 확인(상수)
    expect((prisma.positionDailySnapshot.findMany as AnyFn).mock.calls.length).toBe(1);
    expect((prisma.stockDailyPrice.findMany as AnyFn).mock.calls.length).toBe(1);
  });
});
