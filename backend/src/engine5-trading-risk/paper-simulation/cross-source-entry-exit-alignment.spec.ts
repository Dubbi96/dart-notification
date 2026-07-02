/**
 * cross-source-entry-exit-alignment.spec.ts — DAR-433 진입↔청산 가격소스 정렬(가짜손절 차단)
 *                                              + 장외 체결 의미론(2026-07) 회귀
 *
 * 버그(실측): 진입은 정체된 일봉 종가(REAL, 예: 6/22)로 기록되는데 청산만 실시간(REALTIME, 6/24)으로
 *   평가되는 cross-source 비대칭 → 진입 직후 -8~-18% 가짜손절 발화(승률 0%·평균 -13.26%).
 *
 * 수정: 진입 시세 소스를 Position(entryPriceSource)에 영속하고, 청산/스냅샷/표시 평가가를 '진입 소스'로
 *   정렬(alignedPriceRow)한다 → '진입=일봉 ↔ 청산=실시간' 혼합 원천 차단. 같은 소스끼리만 비교.
 *
 * 장외 체결 의미론(2026-07): 일일(19:30) 경로의 진입/청산은 즉시 체결이 아니다.
 *   - 진입: 예약(PENDING PaperTrade) → 익일 '당일 시가' 체결. entryPriceSource 는 체결에 실제
 *     쓴 시가 행의 소스로 영속(정렬 계약 유지).
 *   - 청산: EXIT 판정·기록(deferredFill 마킹) → 익일 '당일 시가' 체결(갭다운 정직 반영).
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
 * 소스별 고정 조회 결과를, openRowForDate 는 '당일 시가' 행(개장 체결기용)을 돌려준다.
 */
function priceSourceStub(opts: {
  latest: SimPriceRow | null;
  bySource?: Partial<Record<SimPriceRow['source'], SimPriceRow | null>>;
  openRow?: SimPriceRow | null;
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
    openRowForDate: jest.fn().mockResolvedValue(opts.openRow ?? null),
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
  const exitSignals: Array<Record<string, unknown>> = [];
  return {
    _updates: updates,
    _exitSignals: exitSignals,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
    portfolio: {
      findFirst: jest.fn().mockResolvedValue(PF),
      findMany: jest.fn().mockResolvedValue([{ id: PF.id, name: '모의운용 포트폴리오' }]),
      create: jest.fn(),
    },
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
    exitSignal: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const sig = { id: `ex${exitSignals.length + 1}`, ...data };
        exitSignals.push(sig);
        return { id: sig.id };
      }),
      // executePendingExits 의 최신 EXIT 신호 조회 — 저장된 신호를 최신순(뒤에서부터)으로 반환.
      findMany: jest.fn(async () => [...exitSignals].reverse()),
      update: jest.fn().mockResolvedValue({}),
    },
    paperTrade: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'pt1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    tradingSignal: { findMany: jest.fn().mockResolvedValue([]) },
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('DAR-433 — 진입↔청산 가격소스 정렬(cross-source 가짜손절 차단)', () => {
  it('회귀: 진입=REAL 포지션은 청산도 REAL 로 정렬 → 실시간 -8.3% 가 있어도 가짜손절 판정 0건', async () => {
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

    expect(result.exitDeferred).toBe(0);
    expect(result.exited).toBe(0);
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells.length).toBe(0);
    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(false);
  });

  it('대조(가드 분리 증명): entryPriceSource=null(레거시)는 정렬 면제 → 실시간 -10% 로 EXIT 판정(이연)', async () => {
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

    // 장외 체결 의미론: 일일 경로는 판정·기록만 — 당일 즉시 매도 금지.
    expect(result.exitDeferred).toBe(1);
    expect(result.exited).toBe(0);
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells.length).toBe(0);
    const sig = prisma._exitSignals[0] as any;
    expect(sig.exitAction).toBe('EXIT');
    expect(sig.scoreDetail.deferredFill).toBe(true);
  });

  it('정렬: 진입=REAL 인데 REAL 일봉도 같이 하락(-8.3%)이면 EXIT 판정(이연) — 실제 하락은 정상 발화', async () => {
    const open = makeOpen(); // entry 353500(REAL)
    const prisma = makeExitPrisma(open);
    const paperTrade = paperTradeStub();
    // REAL 일봉 자체가 324338(-8.3%) 로 갱신된 경우 — cross-source 가짜갭이 아니라 실제 하락 → 판정 발화.
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

    expect(result.exitDeferred).toBe(1);
    expect(result.exited).toBe(0); // 체결은 익일 시가(아래 갭다운 체결 스펙에서 검증)
  });
});

// ─── 장외 체결 의미론: 이연 청산 → 익일 시가 체결(갭다운 정직 반영) ─────────
describe('장외 체결 의미론 — 이연 청산은 익일 시가로 체결(갭다운 반영)', () => {
  it('D0 19:30 EXIT 판정(이연) → D+1 사이클이 당일 시가(갭다운 8800)로 체결', async () => {
    const open = makeOpen({ entryPrice: 10000, entryAmount: 100000, entryPriceSource: null, currentPrice: 10000, currentValue: 100000, highestPrice: 10000 });
    const prisma = makeExitPrisma(open);
    const paperTrade = paperTradeStub();
    // D+1 당일 시가 = 8800(전일 평가 9000 대비 갭다운) — 체결가는 판정가가 아니라 시가여야 한다.
    const source = priceSourceStub({
      latest: row('REALTIME', 9000, '20260624'),
      bySource: { REAL: row('REAL', 9000, '20260622') },
      openRow: row('REALTIME', 8800, '20260625'),
    });
    const svc = new PaperSimulationService(prisma as never, paperTrade as never, undefined, source);

    // D0: 판정·이연 기록만.
    const d0 = await svc.runDailyCycle('20260624');
    expect(d0.exitDeferred).toBe(1);
    expect(d0.exited).toBe(0);

    // D+1: 개장 체결기(일일 폴백 경로)가 당일 시가 8800 으로 매도 체결.
    const d1 = await svc.runDailyCycle('20260625');
    expect(d1.exited).toBe(1);
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells.length).toBe(1);
    expect(sells[0][0].entryPrice).toBe(8800); // ★갭다운이 체결가에 정직 반영(판정가 9000 아님)
    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(true);
    // 소진 마킹 — 같은 판정이 재발화하지 않게 deferredFill=false 로 갱신.
    expect(prisma.exitSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scoreDetail: expect.objectContaining({ deferredFill: false, deferredFillPrice: 8800 }),
        }),
      }),
    );
  });
});

// ─── 진입(Entry) 경로 prisma 목 — 후보 1건, 기보유 없음 ──────────────────────
function makeEntryPrisma() {
  const created: Array<Record<string, unknown>> = [];
  const reservations: Array<Record<string, unknown>> = [];
  const candidate = { id: 's0', corpCode: 'C0', stockCode: '000660', signal: 'WATCH', buyScore: 80, entryReady: true };
  return {
    _created: created,
    _reservations: reservations,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn().mockResolvedValue({ id: 'u1' }) },
    portfolio: {
      findFirst: jest.fn().mockResolvedValue(PF),
      findMany: jest.fn().mockResolvedValue([{ id: PF.id, name: '모의운용 포트폴리오' }]),
      create: jest.fn(),
    },
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
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    paperTrade: {
      // 예약 원장 — create 로 쌓이고, PENDING 상태인 것만 체결기 조회에 노출.
      findMany: jest.fn(async () => reservations.filter((r) => r.status === 'PENDING')),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const rec = { id: `pt${reservations.length + 1}`, createdAt: new Date(), ...data };
        reservations.push(rec);
        return { id: rec.id };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const rec = reservations.find((r) => r.id === where.id);
        if (rec) Object.assign(rec, data);
        return {};
      }),
    },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
    tradingSignal: { findMany: jest.fn().mockResolvedValueOnce([candidate]).mockResolvedValue([]) },
  };
}

describe('DAR-433 + 장외 체결 의미론 — 예약 → 익일 시가 체결 시 진입 소스 영속(entryPriceSource)', () => {
  it('(a) D0: 예약(PENDING)만 생성 — 당일 Position 0. D+1 실시간 시가 체결: entryPriceSource=REALTIME', async () => {
    const prisma = makeEntryPrisma();
    const paperTrade = paperTradeStub(50000);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({
        latest: row('REALTIME', 50000, '20260624'),
        openRow: row('REALTIME', 50000, '20260625'),
      }),
    );

    // D0(수 20260624): 예약만 — 즉시 체결 금지.
    const d0 = await svc.runDailyCycle('20260624');
    expect(d0.reserved).toBe(1);
    expect(d0.bought).toBe(0);
    expect(prisma._created.length).toBe(0);
    const res = prisma._reservations[0] as any;
    expect(res.status).toBe('PENDING');
    expect(res.styleTag).toBe('paper-simulation');

    // D+1(목 20260625): 당일 시가(REALTIME open) 체결 → 진입 소스 영속.
    const d1 = await svc.runDailyCycle('20260625');
    expect(d1.bought).toBe(1);
    expect(prisma._created.length).toBe(1);
    expect(prisma._created[0].entryPriceSource).toBe('REALTIME');
    expect(res.status).toBe('FILLED');
  });

  it('(b) 실시간 부재: D+1 당일 REAL 일봉 시가로 체결 — entryPriceSource=REAL', async () => {
    const prisma = makeEntryPrisma();
    const paperTrade = paperTradeStub(50000);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub({
        latest: row('REAL', 50000, '20260622'),
        openRow: row('REAL', 49000, '20260625'), // 당일(체결일) REAL 일봉 시가
      }),
    );

    await svc.runDailyCycle('20260624'); // 예약
    const d1 = await svc.runDailyCycle('20260625'); // 체결

    expect(d1.bought).toBe(1);
    expect(prisma._created.length).toBe(1);
    expect(prisma._created[0].entryPriceSource).toBe('REAL');
    // 체결 기준가 = 당일 시가(49000) — 예약 기준가(50000)가 아니다.
    expect(prisma._created[0].entryPrice as number).toBeGreaterThanOrEqual(49000);
    expect(prisma._created[0].entryPrice as number).toBeLessThan(50000);
  });
});
