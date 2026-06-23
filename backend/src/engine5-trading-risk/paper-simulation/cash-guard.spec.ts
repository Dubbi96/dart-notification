/**
 * cash-guard.spec.ts — 시스템모의 가용현금 가드 회귀 (DAR-426, DB 미사용)
 *
 * 버그(실측): DEFAULT_RISK_LIMITS singleBuyMaxPct/maxSinglePositionPct × MAX_HOLDINGS(50) 의 합이
 *   100% 자본을 초과해, openNewPositions 가 가용현금 체크 없이 사이징(가상원금×비율)만으로 매수 →
 *   현금 음수(-11M)·과매수(보유평가 18M>자본 10M).
 *
 * DoD 회귀(결정론·mocked prisma):
 *   (1) 현금이 거의 소진된 상태에서 슬롯(49)·후보(5)가 남아도 추가 매수가 현금 한도에서 멈춘다.
 *   (2) 매수 후에도 현금 ≥ 0 (cash = 초기자본 + 실현손익 − 보유 진입원가).
 *   (3) 현금 완전 소진 시 추가 매수 0.
 * 실주문 없음 — paperTrade.placeOrder 는 모의 체결 스텁.
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimulationPriceSourceService, SimPriceRow } from './simulation-price-source.service';

const PRICE = 10_000; // 후보 종가(체결 기준가)

/**
 * @param existingPrincipal 기보유 OPEN 포지션의 진입원가 합(가용현금을 좁히는 값)
 * @param candidateCount 매수 후보(서로 다른 종목) 수
 */
function makePrismaMock(existingPrincipal: number, candidateCount: number) {
  const created: Array<Record<string, unknown>> = [];

  const candidates = Array.from({ length: candidateCount }, (_, i) => ({
    id: `s${i}`,
    corpCode: `C${i}`,
    stockCode: `00${i}`,
    signal: 'WATCH',
    buyScore: 80, // 고확신 → buyScore 가중 1.0 (등급계수 0.4 → 종목당 예산 400,000)
    entryReady: true,
  }));

  const prisma = {
    _created: created,
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
        // closedForCash / computeMetrics CLOSED — 실현손익 0
        if (where?.status === 'CLOSED') return [];
        // openNewPositions openPositions(select corpCode+entryAmount, entryPrice/id 없음) —
        //   기보유 1건이 existingPrincipal 만큼 현금을 차지.
        if (
          select &&
          select.corpCode &&
          select.entryAmount &&
          !select.entryPrice &&
          !select.id
        ) {
          return existingPrincipal > 0
            ? [{ corpCode: 'EXIST', currentValue: existingPrincipal, entryAmount: existingPrincipal }]
            : [];
        }
        // 그 외 OPEN(computeMetrics/snapshot/exit) — 검증에 불필요하므로 빈 목록(graceful).
        return [];
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `pos${created.length}`, ...data };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
    positionDailySnapshot: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }) },
    aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    portfolioRiskSnapshot: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    companyOverview: { findMany: jest.fn().mockResolvedValue([]) },
    tradingSignal: {
      // ready 후보는 1회만 공급, fallback 보강 조회는 빈 목록.
      findMany: jest
        .fn()
        .mockResolvedValueOnce(candidates)
        .mockResolvedValue([]),
    },
  };
  return prisma;
}

function makePriceSourceStub(): SimulationPriceSourceService {
  const row: SimPriceRow = {
    openPrice: PRICE,
    highPrice: PRICE,
    lowPrice: PRICE,
    closePrice: PRICE,
    volume: BigInt(1_000_000),
    source: 'SYNTHETIC',
  };
  return {
    isSynthetic: true,
    prepareUniverse: jest.fn().mockResolvedValue({ stocks: 1, inserted: 1 }),
    latestPriceRow: jest.fn().mockResolvedValue(row),
    closesAfter: jest.fn().mockResolvedValue([]),
    closesAfterMany: jest.fn().mockResolvedValue([]),
  } as unknown as SimulationPriceSourceService;
}

function makePaperTradeStub() {
  return {
    placeOrder: jest.fn(async ({ orderedShares }: { orderedShares: number }) => ({
      id: 't1',
      filledShares: orderedShares,
      filledPrice: PRICE, // 진입원가 = PRICE × 수량 (가드가 산정한 슬리피지 반영가 이하)
      commission: 0,
      tax: 0,
    })),
  };
}

const INITIAL = PaperSimulationService.INITIAL_CAPITAL; // 10,000,000

function cashAfter(created: Array<Record<string, unknown>>, existingPrincipal: number): number {
  const newPrincipal = created.reduce((s, p) => s + (p.entryAmount as number), 0);
  // 현금 = 초기자본 + 실현손익(0) − 보유 진입원가(기존 + 신규)
  return INITIAL - existingPrincipal - newPrincipal;
}

describe('DAR-426 가용현금 가드 — 현금 ≥ 0 · 과매수 차단', () => {
  it('현금이 150,000 만 남아도 49 슬롯·5 후보 중 현금 한도까지만 매수(추가 매수 멈춤)', async () => {
    const existingPrincipal = INITIAL - 150_000; // 가용현금 150,000
    const prisma = makePrismaMock(existingPrincipal, 5);
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    // 슬롯(49)·후보(5)가 충분해도 가용현금(150,000)에서 1건만 체결(가드 발동).
    expect(result.bought).toBe(1);
    expect(prisma._created.length).toBe(1);
    // 진입원가 ≤ 가용현금 → 현금 음수 불가.
    const entryAmount = prisma._created[0].entryAmount as number;
    expect(entryAmount).toBeLessThanOrEqual(150_000);
    // floor(min(400000,150000) / (10000×1.0005)) = floor(14.99) = 14 → 진입원가 140,000.
    expect(prisma._created[0].quantity).toBe(14);
    expect(entryAmount).toBe(140_000);
    // ★불변식: 매수 후에도 현금 ≥ 0.
    expect(cashAfter(prisma._created, existingPrincipal)).toBeGreaterThanOrEqual(0);
  });

  it('현금 완전 소진(가용현금 0) 시 추가 매수 0', async () => {
    const existingPrincipal = INITIAL; // 가용현금 0
    const prisma = makePrismaMock(existingPrincipal, 5);
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    expect(result.bought).toBe(0);
    expect(prisma._created.length).toBe(0);
    expect(cashAfter(prisma._created, existingPrincipal)).toBe(0);
  });

  it('현금 충분하면 후보 전량 매수하되 합산 진입원가가 자본을 넘지 않는다', async () => {
    const prisma = makePrismaMock(0, 3); // 가용현금 = 전액 10,000,000
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    // 종목당 예산 400,000 × 3 = 1,200,000 < 10,000,000 → 3건 모두 체결.
    expect(result.bought).toBe(3);
    expect(prisma._created.length).toBe(3);
    // 현금 ≥ 0 유지.
    expect(cashAfter(prisma._created, 0)).toBeGreaterThanOrEqual(0);
  });
});
