/**
 * cross-source-entry-exit-alignment.spec.ts — DAR-433 진입↔청산 가격소스 정렬(가짜손절 차단)
 *
 * 버그(실측): 진입은 정체된 일봉 종가(REAL, 예: 6/22)로 기록되는데 청산만 실시간(REALTIME, 6/24)으로
 *   평가되는 cross-source 비대칭 → 진입 직후 -8~-18% 가짜손절 발화(승률 0%·평균 -13.26%).
 *
 * 수정: 진입 시세 소스를 Position(entryPriceSource)에 영속하고, 청산/스냅샷/표시 평가가를 '진입 소스'로
 *   정렬(alignedPriceRow)한다 → '진입=일봉 ↔ 청산=실시간' 혼합 원천 차단. 같은 소스끼리만 비교.
 *
 * DoD 검증(결정론·mocked prisma):
 *   (a) 실시간 신선가 존재: 진입가가 REALTIME 소스로 기록.
 *   (b) 실시간 부재: 진입가가 REAL(일봉) 소스로 기록.
 *   (회귀) 진입=REAL 포지션은 청산도 REAL 로 정렬 → 실시간 -8.3% 가 있어도 cross-source 가짜손절 0건.
 *   (대조) entryPriceSource=null(레거시)는 정렬 면제 → 종전대로 실시간 평가(가드의 효과를 분리 증명).
 *
 * ★AI 금지영역 불가침: 시세 소스 정렬은 순수 수집/평가(Rule). 손절은 exit-score 하드룰 유지.
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimPriceRow } from './simulation-price-source.service';

const PF = { id: 'pf1', maxSinglePositionPct: 10, maxSectorPct: 30 };

function row(source: SimPriceRow['source'], price: number, sourceDate: string): SimPriceRow {
  return {
    openPrice: price,
    highPrice: price,
    lowPrice: price,
    closePrice: price,
    volume: BigInt(1000),
    source,
    sourceDate,
  };
}

/**
 * priceSource 스텁. latestPriceRow 는 폴백 체인(실시간 우선) 결과를, priceRowForSource 는
 * 소스별 고정 조회 결과를 돌려준다(DAR-433 정렬 가드 검증).
 */
function priceSourceStub(opts: {
  latest: SimPriceRow | null;
  bySource?: Partial<Record<SimPriceRow['source'], SimPriceRow | null>>;
}) {
  return {
    mode: 'REAL',
    isSynthetic: false,
    seedsSynthetic: false,
    modeLabel: '실데이터(최신 가용 실 KRX 일봉)',
    prepareUniverse: jest.fn().mockResolvedValue({ stocks: 0, inserted: 0 }),
    latestPriceRow: jest.fn().mockResolvedValue(opts.latest),
    priceRowForSource: jest.fn(async (_c: string, _t: string, source: SimPriceRow['source']) =>
      opts.bySource?.[source] ?? null,
    ),
    closesAfter: jest.fn().mockResolvedValue([]),
    closesAfterMany: jest.fn().mockResolvedValue([]),
  } as unknown as ConstructorParameters<typeof PaperSimulationService>[3];
}

function paperTradeStub(fillPrice?: number) {
  return {
    placeOrder: jest.fn(async ({ direction, orderedShares, entryPrice }: {
      direction: string;
      orderedShares: number;
      entryPrice: number;
    }) => ({
      id: direction === 'SELL' ? 'sell1' : 'buy1',
      filledShares: orderedShares,
      filledPrice: fillPrice ?? entryPrice,
      commission: 0,
      tax: 0,
    })),
  };
}

// ─── 청산(Exit) 경로 prisma 목 — 기보유 1건, 신규 후보 없음 ──────────────────
interface OpenRow {
  id: string;
  corpCode: string;
  stockCode: string;
  entryPrice: number;
  entryPriceSource: string | null;
  quantity: number;
  entryAmount: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  highestPrice: number | null;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxHoldDays: number | null;
  entryDate: Date;
  positionThesisId: string | null;
  status: string;
}

function makeOpen(overrides: Partial<OpenRow> = {}): OpenRow {
  return {
    id: 'pos1',
    corpCode: '00126380',
    stockCode: '005930',
    entryPrice: 353500, // 6/22 일봉 종가로 진입
    entryPriceSource: 'REAL',
    quantity: 10,
    entryAmount: 3_535_000,
    currentPrice: 353500,
    currentValue: 3_535_000,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    highestPrice: 353500,
    stopLossPct: 8,
    takeProfitPct: 20,
    maxHoldDays: 20,
    entryDate: new Date('2026-06-22T00:00:00Z'),
    positionThesisId: null,
    status: 'OPEN',
    ...overrides,
  };
}

function makeExitPrisma(open: OpenRow) {
  const state = { closed: false };
  const updates: Array<Record<string, unknown>> = [];
  return {
    _updates: updates,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
    portfolio: { findFirst: jest.fn().mockResolvedValue(PF), create: jest.fn() },
    position: {
      count: jest.fn().mockResolvedValue(state.closed ? 0 : 1),
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        // openNewPositions openPositions(select corpCode+currentValue+entryAmount)
        if (select && select.corpCode && select.entryAmount && !select.id && !select.entryPrice) {
          return state.closed ? [] : [{ corpCode: open.corpCode, currentValue: open.currentValue, entryAmount: open.entryAmount }];
        }
        // computeMetrics OPEN(id+entryPrice select)
        if (select && select.id && select.entryPrice) {
          return state.closed ? [] : [{ id: open.id, corpCode: open.corpCode, entryPrice: open.entryPrice, quantity: open.quantity, unrealizedPnl: open.unrealizedPnl, entryDate: open.entryDate }];
        }
        if (where?.status === 'CLOSED') return [];
        // snapshot/exit/details: 전체 OPEN
        return state.closed ? [] : [open];
      }),
      create: jest.fn(),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        if (data.status === 'CLOSED') state.closed = true;
        return {};
      }),
    },
    positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
    positionDailySnapshot: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }), findMany: jest.fn().mockResolvedValue([]) },
    paperTrade: { update: jest.fn().mockResolvedValue({}) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    tradingSignal: { findMany: jest.fn().mockResolvedValue([]) },
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('DAR-433 — 진입↔청산 가격소스 정렬(cross-source 가짜손절 차단)', () => {
  it('회귀: 진입=REAL 포지션은 청산도 REAL 로 정렬 → 실시간 -8.3% 가 있어도 가짜손절 0건', async () => {
    const open = makeOpen(); // entry 353500(REAL), stopLoss 8%
    const prisma = makeExitPrisma(open);
    const paperTrade = paperTradeStub();
    // latestPriceRow(폴백 체인)는 실시간 -8.3%(324338) 를 돌려주지만,
    // 진입 소스(REAL)로 정렬되면 REAL 일봉 종가(=진입가 353500) 로 평가 → 손익 0 → 손절 미발화.
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({
        latest: row('REALTIME', 324338, '20260624'),
        bySource: { REAL: row('REAL', 353500, '20260622') },
      }),
    );

    const result = await svc.runDailyCycle('20260624');

    expect(result.exited).toBe(0);
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells.length).toBe(0);
    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(false);
  });

  it('대조(가드 분리 증명): entryPriceSource=null(레거시)는 정렬 면제 → 실시간 -10% 로 손절 발화', async () => {
    const open = makeOpen({ entryPrice: 10000, entryAmount: 100000, entryPriceSource: null, currentPrice: 10000, currentValue: 100000, highestPrice: 10000 });
    const prisma = makeExitPrisma(open);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({
        latest: row('REALTIME', 9000, '20260624'), // -10% ≤ -8%
        bySource: { REAL: row('REAL', 9000, '20260622') },
      }),
    );

    const result = await svc.runDailyCycle('20260624');

    expect(result.exited).toBe(1);
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells.length).toBe(1);
    // 레거시 null 은 latestPriceRow(REALTIME 9000) 그대로 사용해 체결
    expect(sells[0][0].entryPrice).toBe(9000);
  });

  it('정렬: 진입=REAL 인데 실시간이 진짜로 -8.3% 하락(REAL 일봉도 같이 하락)이면 손절은 정상 발화', async () => {
    const open = makeOpen(); // entry 353500(REAL)
    const prisma = makeExitPrisma(open);
    const paperTrade = paperTradeStub();
    // REAL 일봉 자체가 324338(-8.3%) 로 갱신된 경우 — cross-source 가짜갭이 아니라 실제 하락 → 손절 발화.
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({
        latest: row('REALTIME', 324338, '20260624'),
        bySource: { REAL: row('REAL', 324338, '20260624') },
      }),
    );

    const result = await svc.runDailyCycle('20260624');

    expect(result.exited).toBe(1);
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells[0][0].entryPrice).toBe(324338); // REAL 일봉 종가로 정렬 체결
  });
});

// ─── 진입(Entry) 경로 prisma 목 — 후보 1건, 기보유 없음 ──────────────────────
function makeEntryPrisma() {
  const created: Array<Record<string, unknown>> = [];
  const candidate = { id: 's0', corpCode: 'C0', stockCode: '000660', signal: 'WATCH', buyScore: 80, entryReady: true };
  return {
    _created: created,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn().mockResolvedValue({ id: 'u1' }) },
    portfolio: { findFirst: jest.fn().mockResolvedValue(PF), create: jest.fn() },
    position: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        if (where?.status === 'CLOSED') return [];
        if (select && select.corpCode && select.entryAmount && !select.id && !select.entryPrice) return [];
        return [];
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `pos${created.length}` };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
    positionDailySnapshot: { upsert: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]) },
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }), findMany: jest.fn().mockResolvedValue([]) },
    paperTrade: { update: jest.fn().mockResolvedValue({}) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
    tradingSignal: { findMany: jest.fn().mockResolvedValueOnce([candidate]).mockResolvedValue([]) },
  };
}

describe('DAR-433 — 진입가 시세 소스 영속(entryPriceSource)', () => {
  it('(a) 실시간 신선가 존재: 진입가가 REALTIME 소스로 Position 에 기록', async () => {
    const prisma = makeEntryPrisma();
    const paperTrade = paperTradeStub(50000);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({ latest: row('REALTIME', 50000, '20260624') }),
    );

    await svc.runDailyCycle('20260624');

    expect(prisma._created.length).toBe(1);
    expect(prisma._created[0].entryPriceSource).toBe('REALTIME');
  });

  it('(b) 실시간 부재: 진입가가 REAL(일봉 종가) 소스로 Position 에 기록', async () => {
    const prisma = makeEntryPrisma();
    const paperTrade = paperTradeStub(50000);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({ latest: row('REAL', 50000, '20260622') }),
    );

    await svc.runDailyCycle('20260624');

    expect(prisma._created.length).toBe(1);
    expect(prisma._created[0].entryPriceSource).toBe('REAL');
  });
});
