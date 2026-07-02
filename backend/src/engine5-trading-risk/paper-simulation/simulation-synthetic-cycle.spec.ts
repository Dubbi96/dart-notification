/**
 * simulation-synthetic-cycle.spec.ts — 합성 시세 모의 사이클 동작 재현 (DAR-124 + 장외 체결 의미론
 * 2026-07, DB 미사용)
 *
 * DoD 동작 재현(결정론): 합성 시세 소스를 주입하면
 *   (1) D0 사이클: 신규 매수 '예약'(PENDING PaperTrade, entryDate=다음 거래일) — 즉시 체결 0,
 *   (2) D+1 사이클: 예약이 '당일 시가'로 체결(Position 생성) + 일일 스냅샷이 합성 종가 기준
 *       평가손익을 반영(가격변동 반영),
 *   (3) 이월: 당일 시가 데이터 없으면 PENDING 유지, 이월 상한(3거래일) 초과면 CANCELLED,
 * 을 mocked prisma 로 결정적으로 보인다. 실주문 없음 — 체결은 순수 Rule(simulateFill).
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimulationPriceSourceService, SimPriceRow } from './simulation-price-source.service';

const SYNTH_CLOSE = 50_000; // 합성 종가(예약 기준가 · 체결일 시가 · 스냅샷 평가 기준)

function makePrismaMock() {
  const created: Array<Record<string, unknown>> = [];
  const reservations: Array<Record<string, unknown>> = [];
  const snapshotUpserts: Array<Record<string, unknown>> = [];

  const prisma = {
    _created: created,
    _reservations: reservations,
    _snapshotUpserts: snapshotUpserts,
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'u1' }),
      create: jest.fn().mockResolvedValue({ id: 'u1' }),
    },
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'pf1',
        maxSinglePositionPct: 10,
        maxSectorPct: 30,
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'pf1', name: '모의운용 포트폴리오' }]),
      create: jest.fn(),
    },
    position: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        if (where?.status === 'CLOSED') return [];
        // openNewPositions/fillPendingEntries: OPEN(corpCode+entryAmount select)
        if (select && select.corpCode && !select.entryPrice && !select.id) {
          return created.map((c) => ({
            corpCode: c.corpCode,
            currentValue: c.currentValue,
            entryAmount: c.entryAmount,
          }));
        }
        // computeMetrics OPEN (select.entryPrice 포함)
        if (select && select.entryPrice) {
          return created.map((c, i) => ({
            id: `pos${i + 1}`,
            entryPrice: c.entryPrice,
            quantity: c.quantity,
            unrealizedPnl: c.unrealizedPnl ?? 0,
            entryDate: c.entryDate,
          }));
        }
        // snapshot/exit: 전체 포지션(생성된 그대로 + id)
        return created.map((c, i) => ({ id: `pos${i + 1}`, ...c }));
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `pos${created.length}`, ...data };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
    positionDailySnapshot: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        snapshotUpserts.push(create);
        return create;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]), // 6개 미만 → 적중률 표본 없음(graceful)
    },
    exitSignal: {
      create: jest.fn().mockResolvedValue({ id: 'ex1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    paperTrade: {
      // 예약 원장 — PENDING 만 체결기 조회에 노출(서비스 where 시맨틱 재현).
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
    portfolioRiskSnapshot: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    // DAR-362: 섹터 분산 가드용 업종 조회(industryCode). 미설정이면 섹터 미상 → 가드 면제.
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

/** 합성 소스 스텁 — latestPriceRow(평가·기준가) + openRowForDate(체결일 '당일 시가'). */
function makePriceSourceStub(opts: { openRowDates?: string[] } = {}): SimulationPriceSourceService {
  const row = (sourceDate?: string): SimPriceRow => ({
    openPrice: SYNTH_CLOSE,
    highPrice: SYNTH_CLOSE + 500,
    lowPrice: SYNTH_CLOSE - 500,
    closePrice: SYNTH_CLOSE,
    volume: BigInt(1_000_000),
    source: 'SYNTHETIC',
    ...(sourceDate ? { sourceDate } : {}),
  });
  return {
    isSynthetic: true,
    prepareUniverse: jest.fn().mockResolvedValue({ stocks: 1, inserted: 60 }),
    latestPriceRow: jest.fn().mockResolvedValue(row()),
    // '당일' 시가 행 — 허용된 날짜만 반환(없으면 null → 체결기 이월).
    openRowForDate: jest.fn(async (_c: string, tradeDate: string) =>
      (opts.openRowDates ?? []).includes(tradeDate) ? row(tradeDate) : null,
    ),
    closesAfter: jest.fn().mockResolvedValue([]),
    closesAfterMany: jest.fn().mockResolvedValue([]),
  } as unknown as SimulationPriceSourceService;
}

function makePaperTradeStub() {
  return {
    placeOrder: jest.fn(async ({ direction, orderedShares }: { direction: string; orderedShares: number }) => ({
      id: direction === 'SELL' ? 't2' : 't1',
      filledShares: orderedShares,
      filledPrice: SYNTH_CLOSE,
      commission: 0,
      tax: 0,
    })),
  };
}

const CANDIDATE = {
  id: 's1',
  corpCode: '00126380',
  stockCode: '005930',
  signal: 'WATCH',
  buyScore: 41,
  entryReady: true,
};

/** KST ymd 자정 Date — 예약 entryDate 규약. */
function kstMidnight(ymd: string): Date {
  return new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`);
}

describe('합성 시세 모의 사이클(DAR-124 + 장외 체결 의미론) — 예약 → 익일 시가 체결 → 스냅샷', () => {
  it('D0: 예약(PENDING)만 생성 → D+1: 당일 시가 체결 + 합성 종가 스냅샷', async () => {
    const prisma = makePrismaMock();
    const priceSource = makePriceSourceStub({ openRowDates: ['20260609'] });
    const paperTrade = makePaperTradeStub();
    (prisma as any).tradingSignal = {
      findMany: jest.fn().mockResolvedValueOnce([CANDIDATE]).mockResolvedValue([]),
    };

    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
    );

    // ── D0(월 20260608): 예약만 — 즉시 체결 0(lookahead 편향 차단) ──
    const d0 = await svc.runDailyCycle('20260608');
    expect((priceSource.prepareUniverse as jest.Mock)).toHaveBeenCalledWith('pf1', '20260608');
    expect(d0.reserved).toBe(1);
    expect(d0.bought).toBe(0);
    expect(prisma._created.length).toBe(0); // Position 미생성
    const res = prisma._reservations[0] as any;
    expect(res.status).toBe('PENDING');
    // DAR-362 사이징 보존: WATCH·buyScore41 → 270,000 예산 → floor(270000/50100)=5주 주문.
    expect(res.orderedShares).toBe(5);
    expect(res.entryPrice).toBe(SYNTH_CLOSE);
    // 체결 예정일 = 다음 거래일(20260608 월 → 20260609 화).
    expect(res.entryDate).toEqual(kstMidnight('20260609'));

    // ── D+1(화 20260609): 당일 시가로 체결 + 스냅샷 ──
    const d1 = await svc.runDailyCycle('20260609');
    expect(d1.bought).toBe(1);
    expect(prisma._created.length).toBe(1);
    const pos = prisma._created[0] as any;
    // 체결가 = 당일 시가(50000) × 슬리피지 → 호가 정렬 50100. 예산 envelope(5×50000)로 4주.
    expect(pos.entryPrice).toBe(50_100);
    expect(pos.quantity).toBe(4);
    expect(pos.entryPriceSource).toBe('SYNTHETIC');
    expect(res.status).toBe('FILLED');

    // 스냅샷이 합성 종가(50,000) 기준 평가손익을 반영 — 체결가(50,100) 대비 가격변동 반영.
    expect(d1.snapshotted).toBeGreaterThan(0);
    const snap = prisma._snapshotUpserts[prisma._snapshotUpserts.length - 1];
    expect(snap.closePrice).toBe(SYNTH_CLOSE);
    // unrealizedPnl = (50000 - 50100) × 4 = -400 (가격변동이 평가에 반영됨)
    expect(snap.unrealizedPnl).toBe((SYNTH_CLOSE - 50_100) * 4);

    // 실주문 직결 없음 — SELL 미발생(Exit HOLD 수준), BUY 는 예약→체결 경로(placeOrder 미사용).
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter(
      (c) => c[0].direction === 'SELL',
    );
    expect(sells.length).toBe(0);
  });

  it('합성 소스 미주입(실데이터 모드 폴백)이면 종전 경로 — 가격 없으면 예약 0', async () => {
    const prisma = makePrismaMock();
    // 실데이터 모드: StockDailyPrice 직접 읽기 → 미설정이라 null
    (prisma as any).stockDailyPrice = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    (prisma as any).tradingSignal = {
      findMany: jest.fn().mockResolvedValueOnce([CANDIDATE]).mockResolvedValue([]),
    };
    const paperTrade = makePaperTradeStub();

    const svc = new PaperSimulationService(prisma as never, paperTrade as never);
    const result = await svc.runDailyCycle('20260608');

    // 폴백 경로: 시세 없음 → 예약 0 (회귀 0: 종전과 동일 거동)
    expect(result.reserved).toBe(0);
    expect(prisma._reservations.length).toBe(0);
    expect(prisma._created.length).toBe(0);
  });

  // ★DAR-389: 백필 신호가 라이브 모의 진입 후보를 오염시키지 않도록 후보 조회 where 에
  //   disclosure.isBackfill=false 가드를 강제한다(DAR-129 불가침과 동일 원칙).
  it('라이브 진입 후보 조회는 disclosure.isBackfill=false 로 백필 신호를 배제한다', async () => {
    const prisma = makePrismaMock();
    const priceSource = makePriceSourceStub();
    const paperTrade = makePaperTradeStub();
    const findMany = jest.fn().mockResolvedValue([]);
    (prisma as any).tradingSignal = { findMany };

    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
    );
    await svc.runDailyCycle('20260608');

    // 후보 조회가 한 번 이상 일어났고, 매 호출의 where 가 백필을 배제한다.
    expect(findMany).toHaveBeenCalled();
    for (const call of findMany.mock.calls) {
      expect(call[0].where.disclosure).toEqual({ isBackfill: false });
    }
  });
});

// ─── 장외 체결 의미론: 미체결 이월 · 이월 상한 취소 ────────────────────────
describe('장외 체결 의미론 — 예약 이월(당일 데이터 부재)과 3거래일 초과 취소', () => {
  function seedPending(prisma: ReturnType<typeof makePrismaMock>, entryYmd: string) {
    prisma._reservations.push({
      id: 'pt1',
      corpCode: '00126380',
      stockCode: '005930',
      direction: 'BUY',
      orderedShares: 5,
      entryPrice: SYNTH_CLOSE,
      entryDate: kstMidnight(entryYmd),
      positionThesisId: null,
      status: 'PENDING',
      styleTag: 'paper-simulation',
      createdAt: new Date('2026-06-05T10:30:00Z'),
    });
  }

  it('당일 시가 데이터가 없으면 체결하지 않고 PENDING 유지(이월) — 스테일 가격 체결 금지', async () => {
    const prisma = makePrismaMock();
    (prisma as any).tradingSignal = { findMany: jest.fn().mockResolvedValue([]) };
    seedPending(prisma, '20260609'); // 오늘 체결 예정
    // openRowForDate 허용 날짜 없음 → 당일 행 null → 이월.
    const priceSource = makePriceSourceStub({ openRowDates: [] });
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      priceSource,
    );

    const result = await svc.runDailyCycle('20260609');

    expect(result.bought).toBe(0);
    expect(prisma._created.length).toBe(0);
    expect((prisma._reservations[0] as any).status).toBe('PENDING'); // 이월(취소 아님)
  });

  it('체결 예정일로부터 3거래일 초과(월 20260602 → 화 20260609 = 5거래일)면 CANCELLED — 무한 이월 방지', async () => {
    const prisma = makePrismaMock();
    (prisma as any).tradingSignal = { findMany: jest.fn().mockResolvedValue([]) };
    seedPending(prisma, '20260602');
    // 당일 데이터가 있어도 상한 초과분은 체결하지 않고 취소한다(스테일 결정 폐기).
    const priceSource = makePriceSourceStub({ openRowDates: ['20260609'] });
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      priceSource,
    );

    const result = await svc.runDailyCycle('20260609');

    expect(result.bought).toBe(0);
    expect(prisma._created.length).toBe(0);
    expect((prisma._reservations[0] as any).status).toBe('CANCELLED');
  });

  it('상한 이내 이월분(금 20260605 → 화 20260609 = 2거래일)은 당일 데이터가 생기면 체결된다', async () => {
    const prisma = makePrismaMock();
    (prisma as any).tradingSignal = { findMany: jest.fn().mockResolvedValue([]) };
    seedPending(prisma, '20260605');
    const priceSource = makePriceSourceStub({ openRowDates: ['20260609'] });
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      priceSource,
    );

    const result = await svc.runDailyCycle('20260609');

    expect(result.bought).toBe(1);
    expect(prisma._created.length).toBe(1);
    expect((prisma._reservations[0] as any).status).toBe('FILLED');
  });
});
