/**
 * realtime-stoploss-price.spec.ts — DAR-364 손절 평가 가격을 실시간 실가로 통일
 *
 * 검증(표시=엔진, 손절 실발화):
 *   1) evaluateExits: 보유 포지션 실시간 실가가 -8% 이하면 하드 스탑로스로 EXIT 발화(모의 매도 체결).
 *   2) getSimulationStatus: 보유 포지션 currentPrice·평가손익·priceSource 가 실시간 실가를 반영
 *      (사용자가 보는 손실 = 엔진이 손절 평가에 쓰는 손실).
 *   3) computeMetrics equity 도 같은 실시간 실가로 재평가(표시·엔진 동일 가격).
 *   4) 실가 미가용(priceSource 미주입)이면 저장 스냅샷값으로 폴백(회귀 0).
 *
 * ★AI 금지영역 불가침: 손절은 순수 Rule(exit-score 하드 스탑) — AI 미개입.
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimPriceRow } from './simulation-price-source.service';

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
    sourceDate: '20260619',
  };
}

/** REAL 모드 priceSource 스텁(rebase no-op·실시간 실가 1순위). */
function priceSourceStub(row: SimPriceRow | null) {
  return {
    mode: 'REAL',
    isSynthetic: false,
    seedsSynthetic: false,
    modeLabel: '실데이터(최신 가용 실 KRX 일봉)',
    prepareUniverse: jest.fn().mockResolvedValue({ stocks: 0, inserted: 0 }),
    latestPriceRow: jest.fn().mockResolvedValue(row),
    closesAfter: jest.fn().mockResolvedValue([]),
    closesAfterMany: jest.fn().mockResolvedValue([]),
  } as unknown as ConstructorParameters<typeof PaperSimulationService>[3];
}

function paperTradeStub() {
  return {
    placeOrder: jest.fn(async ({ direction, orderedShares, entryPrice }: {
      direction: string;
      orderedShares: number;
      entryPrice: number;
    }) => ({
      id: direction === 'SELL' ? 'sell1' : 'buy1',
      filledShares: orderedShares,
      filledPrice: entryPrice,
      commission: 0,
      tax: 0,
    })),
  };
}

interface OpenRow {
  id: string;
  corpCode: string;
  stockCode: string;
  entryPrice: number;
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
    entryPrice: 10000,
    quantity: 10,
    entryAmount: 100000,
    currentPrice: 10000, // 저장(스냅샷)값은 정체 — 실시간 실가와 분리된 표시값
    currentValue: 100000,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    highestPrice: 10000,
    stopLossPct: 8,
    takeProfitPct: 20,
    maxHoldDays: 20,
    entryDate: new Date('2026-06-10T00:00:00Z'),
    positionThesisId: null,
    status: 'OPEN',
    ...overrides,
  };
}

/** runDailyCycle/getSimulationStatus 가 읽는 prisma 목. closed 플래그로 매도 후 상태 전이. */
function makePrisma(open: OpenRow) {
  const state = { closed: false };
  const updates: Array<Record<string, unknown>> = [];
  return {
    _updates: updates,
    _state: state,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
    portfolio: { findFirst: jest.fn().mockResolvedValue(PF), create: jest.fn() },
    position: {
      count: jest.fn().mockResolvedValue(state.closed ? 0 : 1),
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        // openNewPositions: openCorpCodes (corpCode 단독 select)
        if (select && select.corpCode && !select.id && !select.entryPrice) {
          return state.closed ? [] : [{ corpCode: open.corpCode }];
        }
        // computeMetrics OPEN (id+corpCode+entryPrice select)
        if (select && select.id && select.entryPrice) {
          return state.closed
            ? []
            : [{
                id: open.id,
                corpCode: open.corpCode,
                entryPrice: open.entryPrice,
                quantity: open.quantity,
                unrealizedPnl: open.unrealizedPnl,
                entryDate: open.entryDate,
              }];
        }
        // computeMetrics CLOSED
        if (where?.status === 'CLOSED') {
          return [];
        }
        // snapshot/exit/getOpenPositionDetails: 전체 OPEN
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
    // DAR-362(#323) 섹터 분산 가드가 openNewPositions 에서 보유/후보 corpCode 의 업종을 조회한다.
    // 이 스펙은 #324 와 병렬 머지되어 해당 모델 목이 없으면 사이클이 'undefined.findMany' 로 깨진다
    // (머지순서 회귀). []=업종 미상 → 가드 면제 → exit 평가 경로 불변.
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('DAR-364 — 손절 평가 가격 = 실시간 실가(표시=엔진, -8% 손절 실발화)', () => {
  it('실시간 실가가 -10%(≤ -8% 손절)면 evaluateExits 가 EXIT(모의 매도) 발화', async () => {
    const open = makeOpen(); // entry 10000, stopLoss 8%
    const prisma = makePrisma(open);
    const paperTrade = paperTradeStub();
    // 실시간 실가 9000 → pnl -10% ≤ -8% → 하드 스탑로스 EXIT
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub(realtimeRow(9000)),
    );

    const result = await svc.runDailyCycle('20260619');

    expect(result.exited).toBe(1);
    const sellCalls = (paperTrade.placeOrder as jest.Mock).mock.calls.filter(
      (c) => c[0].direction === 'SELL',
    );
    expect(sellCalls.length).toBe(1);
    // 청산은 실시간 실가(9000) 기준 체결
    expect(sellCalls[0][0].entryPrice).toBe(9000);
    // 포지션이 CLOSED 로 전이
    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(true);
  });

  it('실시간 실가가 -5%(> -8%)면 손절 미발화(HOLD)', async () => {
    const open = makeOpen();
    const prisma = makePrisma(open);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub(realtimeRow(9500)), // -5%
    );

    const result = await svc.runDailyCycle('20260619');

    expect(result.exited).toBe(0);
    const sellCalls = (paperTrade.placeOrder as jest.Mock).mock.calls.filter(
      (c) => c[0].direction === 'SELL',
    );
    expect(sellCalls.length).toBe(0);
  });

  it('getSimulationStatus: 보유 포지션 currentPrice·평가손익·priceSource 가 실시간 실가(-20%) 반영', async () => {
    const open = makeOpen(); // 저장 currentPrice=10000(정체)
    const prisma = makePrisma(open);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSourceStub(realtimeRow(8000)), // 실시간 -20%
    );

    const status = await svc.getSimulationStatus();

    expect(status.positions.length).toBe(1);
    const p = status.positions[0];
    // 표시값이 저장(10000)이 아니라 실시간 실가(8000)
    expect(p.currentPrice).toBe(8000);
    expect(p.unrealizedPnlPct).toBeCloseTo(-20, 6);
    expect(p.unrealizedPnl).toBe((8000 - 10000) * 10);
    expect(p.priceSource).toBe('REALTIME');
    expect(p.priceSourceDate).toBe('20260619');
    // equity 도 같은 실가 반영(표시=엔진): 1천만 + (-2000*10)
    expect(status.equity).toBe(PaperSimulationService.INITIAL_CAPITAL + (8000 - 10000) * 10);
  });

  it('priceSource 미주입(실가 미가용)이면 저장 스냅샷값으로 폴백(회귀 0)', async () => {
    const open = makeOpen({ currentPrice: 10500, currentValue: 105000, unrealizedPnl: 5000, unrealizedPnlPct: 5 });
    const prisma = makePrisma(open);
    (prisma as any).stockDailyPrice = {
      findFirst: jest.fn().mockResolvedValue(null), // 실데이터도 없음 → 폴백
      findMany: jest.fn().mockResolvedValue([]),
    };
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(prisma as never, paperTrade as never); // priceSource 미주입

    const status = await svc.getSimulationStatus();

    expect(status.positions.length).toBe(1);
    const p = status.positions[0];
    // 저장값 그대로(라벨 미상)
    expect(p.currentPrice).toBe(10500);
    expect(p.unrealizedPnl).toBe(5000);
    expect(p.priceSource).toBeUndefined();
  });
});
