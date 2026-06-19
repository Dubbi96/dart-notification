/**
 * simulation-synthetic-cycle.spec.ts — 합성 시세로 모의 사이클 동작 재현 (DAR-124, DB 미사용)
 *
 * DoD 동작 재현(결정론): 합성 시세 소스를 주입하면 run-once 한 사이클이
 *   (1) 신규 매수 bought>0, (2) 일일 스냅샷이 합성 종가 기준 평가손익을 반영(가격변동 반영)함을
 *   mocked prisma 로 결정적으로 보인다. 실주문 없음 — paperTrade.placeOrder 는 모의 체결 스텁.
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimulationPriceSourceService, SimPriceRow } from './simulation-price-source.service';

const ENTRY_FILL_PRICE = 49_500; // 슬리피지 반영 체결가
const SYNTH_CLOSE = 50_000; // 합성 종가(스냅샷 평가 기준) — entry 와 달라 가격변동 반영 증명

function buildPosition() {
  return {
    id: 'pos1',
    portfolioId: 'pf1',
    corpCode: '00126380',
    stockCode: '005930',
    positionThesisId: null,
    entryDate: new Date('2026-06-08T10:00:00Z'),
    entryPrice: ENTRY_FILL_PRICE,
    quantity: 8,
    entryAmount: ENTRY_FILL_PRICE * 8,
    currentPrice: ENTRY_FILL_PRICE,
    currentValue: ENTRY_FILL_PRICE * 8,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    highestPrice: ENTRY_FILL_PRICE,
    highestAt: new Date('2026-06-08T10:00:00Z'),
    stopLossPct: 8,
    takeProfitPct: 20,
    maxHoldDays: 20,
    status: 'OPEN',
  };
}

function makePrismaMock() {
  const created: Array<Record<string, unknown>> = [];
  const snapshotUpserts: Array<Record<string, unknown>> = [];
  let positionExists = false; // 매수 전엔 OPEN 0건, 매수 후 스냅샷/Exit 단계엔 1건

  const prisma = {
    _created: created,
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
      create: jest.fn(),
    },
    position: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        if (where?.status === 'CLOSED') return [];
        // openNewPositions: openCorpCodes (select corpCode 단독) — 매수 전 보유 없음
        if (select && select.corpCode && !select.entryPrice && !select.id) {
          return [];
        }
        if (!positionExists) return [];
        // computeMetrics OPEN (select.entryPrice 포함)
        if (select && select.entryPrice) {
          const p = buildPosition();
          return [{ id: p.id, entryPrice: p.entryPrice, quantity: p.quantity, unrealizedPnl: 0, entryDate: p.entryDate }];
        }
        // snapshot/exit: 전체 포지션
        return [buildPosition()];
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        positionExists = true;
        return { id: 'pos1', ...data };
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
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }) },
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

function makePriceSourceStub(): SimulationPriceSourceService {
  const row: SimPriceRow = {
    openPrice: SYNTH_CLOSE,
    highPrice: SYNTH_CLOSE + 500,
    lowPrice: SYNTH_CLOSE - 500,
    closePrice: SYNTH_CLOSE,
    volume: BigInt(1_000_000),
    source: 'SYNTHETIC',
  };
  return {
    isSynthetic: true,
    prepareUniverse: jest.fn().mockResolvedValue({ stocks: 1, inserted: 60 }),
    latestPriceRow: jest.fn().mockResolvedValue(row),
    closesAfter: jest.fn().mockResolvedValue([]),
  } as unknown as SimulationPriceSourceService;
}

function makePaperTradeStub() {
  return {
    placeOrder: jest.fn(async ({ direction, orderedShares }: { direction: string; orderedShares: number }) => {
      if (direction === 'BUY') {
        return { id: 't1', filledShares: orderedShares, filledPrice: ENTRY_FILL_PRICE, commission: 0, tax: 0 };
      }
      return { id: 't2', filledShares: orderedShares, filledPrice: SYNTH_CLOSE, commission: 0, tax: 0 };
    }),
  };
}

describe('합성 시세 모의 사이클(DAR-124) — bought>0 · 스냅샷 가격변동 반영', () => {
  it('합성 소스 주입 시 run-once 가 신규 매수 + 합성 종가 스냅샷을 만든다', async () => {
    const prisma = makePrismaMock();
    const priceSource = makePriceSourceStub();
    const paperTrade = makePaperTradeStub();

    // tradingSignal 후보 1건(WATCH·entryReady) — 매수 후보 공급
    (prisma as any).tradingSignal = {
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', corpCode: '00126380', stockCode: '005930', signal: 'WATCH', buyScore: 41, entryReady: true },
      ]),
    };

    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
    );

    const result = await svc.runDailyCycle('20260608');

    // (0) 사이클 직전 합성 유니버스 준비 호출됨
    expect((priceSource.prepareUniverse as jest.Mock)).toHaveBeenCalledWith('pf1', '20260608');

    // (1) 신규 매수 bought>0
    expect(result.bought).toBeGreaterThan(0);
    expect(prisma._created.length).toBe(1);
    expect(prisma._created[0].entryPrice).toBe(ENTRY_FILL_PRICE);
    // DAR-362: buyScore 차등 사이징 — WATCH·buyScore41 →
    //   baseBudget(1,000,000) × 등급계수(0.4) × buyScore가중(0.675) = 270,000 → floor(270000/50000)=5.
    //   (종전 균일 8주에서 확신도 비례 축소 — '균일 탈피' 동작 재현)
    expect(prisma._created[0].quantity).toBe(5);

    // (2) 스냅샷이 합성 종가(50,000) 기준 평가손익을 반영 — entry(49,500) 대비 가격변동 반영
    expect(result.snapshotted).toBeGreaterThan(0);
    expect(prisma._snapshotUpserts.length).toBe(1);
    const snap = prisma._snapshotUpserts[0];
    expect(snap.closePrice).toBe(SYNTH_CLOSE);
    // unrealizedPnl = (50000 - 49500) * 8 = 4000 (>0, 가격변동이 평가에 반영됨)
    expect(snap.unrealizedPnl).toBe((SYNTH_CLOSE - ENTRY_FILL_PRICE) * 8);
    expect(snap.unrealizedPnl).toBeGreaterThan(0);

    // 실주문 직결 없음 — BUY 모의 체결만(SELL 미발생: Exit HOLD)
    const calls = (paperTrade.placeOrder as jest.Mock).mock.calls;
    expect(calls.some((c) => c[0].direction === 'BUY')).toBe(true);
  });

  it('합성 소스 미주입(실데이터 모드 폴백)이면 종전 경로 — 가격 없으면 매수 0', async () => {
    const prisma = makePrismaMock();
    // 실데이터 모드: StockDailyPrice 직접 읽기 → 미설정이라 null
    (prisma as any).stockDailyPrice = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    (prisma as any).tradingSignal = {
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', corpCode: '00126380', stockCode: '005930', signal: 'WATCH', buyScore: 41, entryReady: true },
      ]),
    };
    const paperTrade = makePaperTradeStub();

    const svc = new PaperSimulationService(prisma as never, paperTrade as never);
    const result = await svc.runDailyCycle('20260608');

    // 폴백 경로: 시세 없음 → 매수 0 (회귀 0: 종전과 동일 거동)
    expect(result.bought).toBe(0);
    expect(prisma._created.length).toBe(0);
  });
});
