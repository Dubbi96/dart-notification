/**
 * exit-accuracy-exit-price.spec.ts — DAR-332 Exit Accuracy(D+3)가 진입가 아닌 청산가 기준 측정 회귀 고정
 *
 * 버그: computeMetrics 의 CLOSED 포지션 select 가 currentPrice(=청산가)를 누락하고
 *   exitPx = p.entryPrice 로 대용 → 'D+3가 진입가 대비' 라는 무관한 통계를 산출.
 * 수정: select 에 currentPrice 추가 + exitPx = p.currentPrice ?? p.entryPrice (청산가 우선, 결측 폴백).
 *
 * 핵심 단언: entry≠exit 인 CLOSED 포지션에서 d3ReturnPct 의 부호가 청산가 기준일 때와
 *   진입가 기준일 때 서로 뒤집히는 케이스로 고정 → 진입가 회귀 시 즉시 적발.
 *   (exitAccuracyD3 = d3ReturnPct<0 비율; 부호가 뒤집히면 적중률도 1.0↔0.0 로 뒤집힘)
 */

import { PaperSimulationService } from './paper-simulation.service';

interface PriceRow {
  corpCode: string;
  tradeDate: string;
  closePrice: number;
}

function makePrisma(opts: {
  closed: Array<{ id: string; corpCode: string; entryPrice: number; currentPrice: number | null; closedAt: Date | null }>;
  priceRows: PriceRow[];
}) {
  return {
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
            entryPrice: c.entryPrice,
            currentPrice: c.currentPrice,
            quantity: 1,
            unrealizedPnl: 0,
            closedAt: c.closedAt,
            corpCode: c.corpCode,
          }));
        }
        return []; // OPEN 없음
      }),
    },
    positionDailySnapshot: { findMany: jest.fn(async () => []) },
    stockDailyPrice: { findMany: jest.fn(async () => opts.priceRows) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function svcOf(prisma: ReturnType<typeof makePrisma>) {
  return new PaperSimulationService(prisma as never, {} as never);
}

const after3 = (corp: string, d3: number): PriceRow[] => [
  { corpCode: corp, tradeDate: '20260111', closePrice: 850 },
  { corpCode: corp, tradeDate: '20260112', closePrice: 880 },
  { corpCode: corp, tradeDate: '20260113', closePrice: d3 },
];

describe('DAR-332 — Exit Accuracy(D+3)는 청산가(currentPrice) 기준', () => {
  it('entry≠exit: D+3가 청산가 대비 측정되어 진입가 기준과 적중률이 뒤집힌다', async () => {
    // entry=1000, exit(currentPrice)=800, D+3 종가=900
    //  - 진입가 기준(버그): (900-1000)/1000 = -10% → 손절적중(<0) → exitAccuracyD3=1.0
    //  - 청산가 기준(수정): (900-800)/800 = +12.5% → 미적중(>0) → exitAccuracyD3=0.0
    const prisma = makePrisma({
      closed: [
        { id: 'c0', corpCode: 'CORP0', entryPrice: 1000, currentPrice: 800, closedAt: new Date('2026-01-10T00:00:00Z') },
      ],
      priceRows: after3('CORP0', 900),
    });
    const { metrics } = await svcOf(prisma).getEquityCurve();

    expect(metrics.exitAccuracySampleSize).toBe(1);
    // 청산가 기준이라 D+3(+12.5%)는 손절적중이 아님 → 0.0 (진입가 기준이면 1.0 이 나와 실패)
    expect(metrics.exitAccuracyD3).toBeCloseTo(0, 10);
    expect(metrics.gates.exitAccuracyPass).toBe(false);
  });

  it('청산가 기준에서 D+3가 실제로 더 하락하면 손절 적중으로 카운트된다', async () => {
    // entry=1000, exit=800, D+3=700 → (700-800)/800 = -12.5% → 적중(<0) → 1.0
    const prisma = makePrisma({
      closed: [
        { id: 'c0', corpCode: 'CORP0', entryPrice: 1000, currentPrice: 800, closedAt: new Date('2026-01-10T00:00:00Z') },
      ],
      priceRows: after3('CORP0', 700),
    });
    const { metrics } = await svcOf(prisma).getEquityCurve();

    expect(metrics.exitAccuracySampleSize).toBe(1);
    expect(metrics.exitAccuracyD3).toBeCloseTo(1, 10);
    expect(metrics.gates.exitAccuracyPass).toBe(true);
  });

  it('currentPrice 결측(null) 시 진입가로 보수적 폴백한다', async () => {
    // currentPrice=null → exitPx=entryPrice=1000, D+3=900 → (900-1000)/1000 = -10% → 적중 → 1.0
    const prisma = makePrisma({
      closed: [
        { id: 'c0', corpCode: 'CORP0', entryPrice: 1000, currentPrice: null, closedAt: new Date('2026-01-10T00:00:00Z') },
      ],
      priceRows: after3('CORP0', 900),
    });
    const { metrics } = await svcOf(prisma).getEquityCurve();

    expect(metrics.exitAccuracySampleSize).toBe(1);
    expect(metrics.exitAccuracyD3).toBeCloseTo(1, 10);
  });

  it('CLOSED select 에 currentPrice 가 포함되어 청산가가 메트릭 계산에 도달한다', async () => {
    const prisma = makePrisma({
      closed: [
        { id: 'c0', corpCode: 'CORP0', entryPrice: 1000, currentPrice: 800, closedAt: new Date('2026-01-10T00:00:00Z') },
      ],
      priceRows: after3('CORP0', 900),
    });
    await svcOf(prisma).getEquityCurve();

    const closedCall = (prisma.position.findMany as jest.Mock).mock.calls.find(
      ([arg]) => arg?.where?.status === 'CLOSED',
    );
    expect(closedCall).toBeDefined();
    expect(closedCall[0].select.currentPrice).toBe(true);
  });
});
