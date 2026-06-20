/**
 * equity-header-curve-consistency.spec.ts — DAR-393 헤더 평가금액 == 자산곡선 최신점 정합
 *
 * 버그: 헤더(getSimulationStatus.equity)는 '지금' 실시간 실가로 재평가(live)하는데,
 *   자산곡선(getEquityCurve.points)은 과거 사이클 시점 스냅샷(일봉 백필 전 정체가)으로 굳어
 *   같은 평가금액을 다른 가격 시점으로 표시 → 헤더 +5.73% vs 곡선 -0.11% 모순.
 * 수정: getEquityCurve 가 헤더와 동일한 computeLiveEquity 를 재사용하고, 곡선 끝에 live 점을
 *   정합 병합(withLivePoint) → 곡선 최신점 totalValue === 헤더 equity (±0)·부호·% 일치.
 *
 * 핵심 단언:
 *   1) status.equity === curve.points[last].totalValue (오차 0)
 *   2) 부호·등락률 일치(둘 다 +; status.metrics.cumulativeReturnPct === curve.points[last].returnPct)
 *   3) 과거 스냅샷은 kind='snapshot'(정체가·음수)로 보존, 최신점은 kind='live'(실가·양수)로 구분
 *   4) latestSnapshotDate 는 저장 스냅샷일(과거) — live 점 날짜(오늘)와 구분(stale 신선도 라벨 근거)
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimPriceRow } from './simulation-price-source.service';

const INITIAL = 10_000_000;
const PF = { id: 'pf1', maxSinglePositionPct: 10 };

/** 실시간 실가 1행(REALTIME) 스텁. */
function realtimeRow(price: number): SimPriceRow {
  return {
    openPrice: price,
    highPrice: price,
    lowPrice: price,
    closePrice: price,
    volume: BigInt(1000),
    source: 'REALTIME',
    sourceDate: '20260620',
  };
}

function priceSourceStub(row: SimPriceRow | null) {
  return {
    mode: 'REAL',
    isSynthetic: false,
    seedsSynthetic: false,
    modeLabel: '실데이터',
    prepareUniverse: jest.fn().mockResolvedValue({ stocks: 0, inserted: 0 }),
    latestPriceRow: jest.fn().mockResolvedValue(row),
    closesAfter: jest.fn().mockResolvedValue([]),
    closesAfterMany: jest.fn().mockResolvedValue([]),
  } as unknown as ConstructorParameters<typeof PaperSimulationService>[3];
}

/** OPEN 1건 + stale 저장 스냅샷을 가진 prisma 목. */
function makePrisma(opts: {
  liveStored: { currentPrice: number; currentValue: number; unrealizedPnl: number; unrealizedPnlPct: number };
  staleSnapshotTotalValue: number;
  staleSnapshotDate: string;
}) {
  const open = {
    id: 'pos1',
    corpCode: '00126380',
    stockCode: '005930',
    entryPrice: 10000,
    quantity: 10,
    // 저장(스냅샷)값 — 정체. 실시간 실가와 분리된 표시값.
    currentPrice: opts.liveStored.currentPrice,
    currentValue: opts.liveStored.currentValue,
    unrealizedPnl: opts.liveStored.unrealizedPnl,
    unrealizedPnlPct: opts.liveStored.unrealizedPnlPct,
    entryDate: new Date('2026-06-10T00:00:00Z'),
    status: 'OPEN',
  };
  return {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
    portfolio: { findFirst: jest.fn().mockResolvedValue(PF), create: jest.fn() },
    position: {
      count: jest.fn().mockResolvedValue(0), // CLOSED 0
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        // computeMetrics CLOSED
        if (where?.status === 'CLOSED') return [];
        // computeMetrics OPEN (id+entryPrice select)
        if (select && select.id && select.entryPrice) {
          return [{
            id: open.id,
            entryPrice: open.entryPrice,
            quantity: open.quantity,
            unrealizedPnl: open.unrealizedPnl,
            entryDate: open.entryDate,
          }];
        }
        // getOpenPositionDetails OPEN (corpCode+stockCode+currentValue select)
        return [open];
      }),
    },
    positionDailySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    stockDailyPrice: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    exitSignal: { findMany: jest.fn().mockResolvedValue([]) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    company: { findMany: jest.fn().mockResolvedValue([{ corpCode: '00126380', corpName: '삼성전자' }]) },
    portfolioRiskSnapshot: {
      findFirst: jest.fn().mockResolvedValue({ snapshotDate: opts.staleSnapshotDate }),
      findMany: jest.fn().mockResolvedValue([
        { snapshotDate: opts.staleSnapshotDate, totalValue: opts.staleSnapshotTotalValue },
      ]),
    },
  };
}

function svc(prisma: ReturnType<typeof makePrisma>, livePrice: number) {
  return new PaperSimulationService(
    prisma as never,
    {} as never,
    undefined,
    priceSourceStub(realtimeRow(livePrice)),
  );
}

describe('DAR-393 — 헤더 평가금액 == 자산곡선 최신점 (모순 해소)', () => {
  // 이슈 재현: 헤더는 live 실가(+), 곡선 스냅샷은 정체가(-) → 같은 지표가 다른 시점으로 모순.
  // 과거 스냅샷일은 임의 실행일과 무관하게 항상 과거가 되도록 '20200101' 고정(live 점=오늘 append 보장).
  const STALE_DATE = '20200101';
  const STALE_TOTAL = 9_989_123; // 곡선 정체가(-0.11%)

  function setup() {
    const livePrice = 12000; // 실시간 +20% → live unrealizedPnl = (12000-10000)*10 = +20,000
    const prisma = makePrisma({
      liveStored: { currentPrice: 10000, currentValue: 100000, unrealizedPnl: 0, unrealizedPnlPct: 0 },
      staleSnapshotTotalValue: STALE_TOTAL,
      staleSnapshotDate: STALE_DATE,
    });
    return { prisma, service: svc(prisma, livePrice), expectedEquity: INITIAL + (12000 - 10000) * 10 };
  }

  it('★ status.equity === curve.points[last].totalValue (오차 0) — 같은 live 계산', async () => {
    const { service, expectedEquity } = setup();
    const status = await service.getSimulationStatus();
    const curve = await service.getEquityCurve();
    const last = curve.points[curve.points.length - 1];

    expect(status.equity).toBe(expectedEquity); // 10,020,000
    expect(last.totalValue).toBe(status.equity); // 곡선 끝 === 헤더 (±0)
  });

  it('부호·등락률 일치: 헤더 누적수익률 === 곡선 최신점 returnPct (둘 다 +)', async () => {
    const { service } = setup();
    const status = await service.getSimulationStatus();
    const curve = await service.getEquityCurve();
    const last = curve.points[curve.points.length - 1];

    expect(last.returnPct).toBeGreaterThan(0);
    expect(status.metrics.cumulativeReturnPct).toBeGreaterThan(0);
    expect(last.returnPct).toBeCloseTo(status.metrics.cumulativeReturnPct, 9);
    // 헤더·곡선 metrics 가 같은 live 평가를 재사용 → 누적수익률 동일
    expect(curve.metrics.cumulativeReturnPct).toBeCloseTo(status.metrics.cumulativeReturnPct, 9);
  });

  it('과거 스냅샷은 kind=snapshot(정체가·음수) 보존, 최신점은 kind=live(실가·양수)로 구분', async () => {
    const { service } = setup();
    const curve = await service.getEquityCurve();

    expect(curve.points.length).toBe(2);
    const [snap, live] = curve.points;
    expect(snap.kind).toBe('snapshot');
    expect(snap.totalValue).toBe(STALE_TOTAL);
    expect(snap.returnPct).toBeLessThan(0); // 정체가 -0.11%
    expect(live.kind).toBe('live');
    expect(live.returnPct).toBeGreaterThan(0); // 실가 +
  });

  it('latestSnapshotDate 는 저장 스냅샷일(과거) — live 점 날짜와 구분(stale 라벨 근거)', async () => {
    const { service } = setup();
    const curve = await service.getEquityCurve();
    const live = curve.points[curve.points.length - 1];

    expect(curve.latestSnapshotDate).toBe(STALE_DATE);
    expect(live.snapshotDate > STALE_DATE).toBe(true); // live 점은 오늘(과거 스냅샷 이후)
  });
});
