/**
 * simulation-rebase.spec.ts — 레거시 포지션 합성가 재기준 (DAR-135, DB 미사용)
 *
 * 배경: DAR-124 합성 시세 활성화 전에 열린 포지션은 진입가가 '실 KRX 가격'인데 평가는 합성가로
 *   이뤄져 진입↔평가 기준이 불일치 → 첫 스냅샷에서 괴리가 통째로 손익으로 잡혀 equity 가
 *   비현실적으로 점프했다. rebaseLegacyPositions 가 합성 모드에서 이를 합성가 기준으로 재설정한다.
 *
 * DoD 동작 재현(결정론): mocked prisma 로
 *   (1) 실가격 진입 레거시 포지션 → 합성 종가로 재기준(진입가/원금/최고가 리셋·손익 0),
 *   (2) 이미 합성가 일관(신규/재기준 완료) 포지션 → 재대상 아님(멱등),
 *   (3) 실데이터 모드(priceSource 미주입) → no-op(회귀 0).
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimulationPriceSourceService, SimPriceRow } from './simulation-price-source.service';

const SYNTH_CLOSE = 1_000; // 합성 종가(재기준 기준가)

function buildPosition(entryPrice: number) {
  return {
    id: 'posL',
    portfolioId: 'pf1',
    corpCode: '00126380',
    stockCode: '005930',
    positionThesisId: null,
    entryDate: new Date('2026-06-08T10:00:00Z'),
    entryPrice,
    quantity: 8,
    entryAmount: entryPrice * 8,
    currentPrice: entryPrice,
    currentValue: entryPrice * 8,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    highestPrice: entryPrice,
    highestAt: new Date('2026-06-08T10:00:00Z'),
    stopLossPct: 8,
    takeProfitPct: 20,
    maxHoldDays: 20,
    status: 'OPEN',
  };
}

/**
 * prisma 목 — no-select OPEN findMany 의 첫 호출(재기준)만 레거시 포지션을 반환하고,
 * 이후(스냅샷/Exit)·computeMetrics 는 빈 배열을 줘 재기준 동작만 격리 검증한다.
 */
function makePrismaMock(legacy: ReturnType<typeof buildPosition> | null) {
  const updates: Array<Record<string, unknown>> = [];
  let openNoSelectCalls = 0;
  const prisma = {
    _updates: updates,
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'u1' }),
      create: jest.fn().mockResolvedValue({ id: 'u1' }),
    },
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
      create: jest.fn(),
    },
    position: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
        if (where?.status === 'CLOSED') return [];
        // openNewPositions openCorpCodes (corpCode 단독 select)
        if (select?.corpCode && !select.entryPrice && !select.id) return [];
        // computeMetrics OPEN (entryPrice select) — 평탄
        if (select?.entryPrice) return [];
        // no-select OPEN: 1st=재기준(레거시 반환), 이후=스냅샷/Exit(빈 배열)
        openNoSelectCalls++;
        return openNoSelectCalls === 1 && legacy ? [legacy] : [];
      }),
      create: jest.fn(),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
    positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
    positionDailySnapshot: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    tradingSignal: { findMany: jest.fn().mockResolvedValue([]) }, // 신규 후보 없음
    stockDailyPrice: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return prisma;
}

function makeSyntheticPriceSource(): SimulationPriceSourceService {
  const row: SimPriceRow = {
    openPrice: SYNTH_CLOSE,
    highPrice: SYNTH_CLOSE + 20,
    lowPrice: SYNTH_CLOSE - 20,
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
    placeOrder: jest.fn(async ({ orderedShares }: { orderedShares: number }) => ({
      id: 't', filledShares: orderedShares, filledPrice: SYNTH_CLOSE, commission: 0, tax: 0,
    })),
  };
}

describe('레거시 포지션 합성가 재기준(DAR-135)', () => {
  it('실가격 진입(50,000) 레거시 → 합성 종가(1,000) 기준으로 재기준(손익 0·최고가 리셋)', async () => {
    const prisma = makePrismaMock(buildPosition(50_000)); // 합성가와 49배 괴리 = 레거시
    const priceSource = makeSyntheticPriceSource();

    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      priceSource,
    );
    const result = await svc.runDailyCycle('20260608');

    expect(result.rebased).toBe(1);
    // 재기준 update: 진입가=합성 종가, 원금=합성가×수량, 손익 0, 최고가=합성가
    const rebaseUpdate = prisma._updates.find((u) => u.entryPrice === SYNTH_CLOSE);
    expect(rebaseUpdate).toBeDefined();
    expect(rebaseUpdate?.entryAmount).toBe(SYNTH_CLOSE * 8);
    expect(rebaseUpdate?.currentValue).toBe(SYNTH_CLOSE * 8);
    expect(rebaseUpdate?.unrealizedPnl).toBe(0);
    expect(rebaseUpdate?.unrealizedPnlPct).toBe(0);
    expect(rebaseUpdate?.highestPrice).toBe(SYNTH_CLOSE);
  });

  it('이미 합성가 일관(진입가≈합성가, drift 10% 이내) → 재대상 아님(멱등)', async () => {
    // 진입가 1,050 vs 합성 1,000 → drift 5% ≤ 임계 10% → 재기준 안 함
    const prisma = makePrismaMock(buildPosition(1_050));
    const priceSource = makeSyntheticPriceSource();

    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      priceSource,
    );
    const result = await svc.runDailyCycle('20260608');

    expect(result.rebased).toBe(0);
    expect(prisma._updates.find((u) => u.entryPrice !== undefined)).toBeUndefined();
  });

  it('실데이터 모드(priceSource 미주입) → 재기준 no-op(회귀 0)', async () => {
    const prisma = makePrismaMock(buildPosition(50_000));
    const svc = new PaperSimulationService(prisma as never, makePaperTradeStub() as never);
    const result = await svc.runDailyCycle('20260608');

    expect(result.rebased).toBe(0);
    expect(prisma._updates.find((u) => u.entryPrice !== undefined)).toBeUndefined();
  });
});
