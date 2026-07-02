/**
 * cash-guard.spec.ts — 시스템모의 가용현금 가드 회귀 (DAR-426 + 장외 체결 의미론 2026-07, DB 미사용)
 *
 * 버그(실측): DEFAULT_RISK_LIMITS singleBuyMaxPct/maxSinglePositionPct × MAX_HOLDINGS(50) 의 합이
 *   100% 자본을 초과해, openNewPositions 가 가용현금 체크 없이 사이징(가상원금×비율)만으로 매수 →
 *   현금 음수(-11M)·과매수(보유평가 18M>자본 10M).
 *
 * 장외 체결 의미론(2026-07): openNewPositions 는 이제 즉시 체결이 아니라 **매수 예약(PENDING
 *   PaperTrade)** 만 만든다. 현금 가드는 두 겹으로 검증한다:
 *   (A) 예약 시점 — 예약 몫(주문수량×기준가)이 가용현금 이내로 배분(이중 배분 차단).
 *   (B) 체결 시점(fillPendingEntries) — 체결 직전 SSOT 현금으로 수량 재클램프(cash ≥ 0 불변식).
 * 실주문 없음 — 체결은 순수 Rule(simulateFill).
 */

import { PaperSimulationService } from './paper-simulation.service';
import { SimulationPriceSourceService, SimPriceRow } from './simulation-price-source.service';
import { KillSwitchManager } from '../domain/kill-switch';

const PRICE = 10_000; // 후보 종가(예약 기준가)
const INITIAL = PaperSimulationService.INITIAL_CAPITAL; // 10,000,000

interface PendingRow {
  id: string;
  corpCode: string;
  stockCode: string;
  direction: 'BUY';
  orderedShares: number;
  entryPrice: number;
  entryDate: Date;
  positionThesisId: string | null;
  status: 'PENDING';
  styleTag: string;
  createdAt: Date;
}

/**
 * @param existingPrincipal 기보유 OPEN 포지션의 진입원가 합(가용현금을 좁히는 값)
 * @param candidateCount 매수 후보(서로 다른 종목) 수
 * @param pending 미체결 매수 예약(체결기 검증용)
 */
function makePrismaMock(
  existingPrincipal: number,
  candidateCount: number,
  pending: PendingRow[] = [],
) {
  const created: Array<Record<string, unknown>> = [];
  const reservations: Array<Record<string, unknown>> = [];
  const tradeUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];

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
    _reservations: reservations,
    _tradeUpdates: tradeUpdates,
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
        // closedForCash / computeMetrics CLOSED — 실현손익 0
        if (where?.status === 'CLOSED') return [];
        // openNewPositions/fillPendingEntries 의 OPEN(corpCode+entryAmount select) —
        //   기보유 1건이 existingPrincipal 만큼 현금을 차지.
        if (select && select.corpCode && select.entryAmount && !select.entryPrice && !select.id) {
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
    exitSignal: {
      create: jest.fn().mockResolvedValue({ id: 'ex1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    paperTrade: {
      findMany: jest.fn().mockResolvedValue(pending),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        reservations.push(data);
        return { id: `pt${reservations.length}` };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        tradeUpdates.push({ id: where.id, data });
        return {};
      }),
    },
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

function makePriceSourceStub(openRow?: SimPriceRow | null): SimulationPriceSourceService {
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
    openRowForDate: jest.fn().mockResolvedValue(openRow === undefined ? null : openRow),
    closesAfter: jest.fn().mockResolvedValue([]),
    closesAfterMany: jest.fn().mockResolvedValue([]),
  } as unknown as SimulationPriceSourceService;
}

function makePaperTradeStub() {
  return {
    placeOrder: jest.fn(async ({ orderedShares }: { orderedShares: number }) => ({
      id: 't1',
      filledShares: orderedShares,
      filledPrice: PRICE,
      commission: 0,
      tax: 0,
    })),
  };
}

/** KST ymd 자정 Date. 예약 entryDate 표현(서비스 kstMidnight 과 동일 규약). */
function kstMidnight(ymd: string): Date {
  return new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`);
}

describe('DAR-426 가용현금 가드 (A) 예약 시점 — 현금 이내 배분·이중 배분 차단', () => {
  it('현금이 150,000 만 남으면 49 슬롯·5 후보라도 현금 한도까지만 예약(추가 예약 멈춤)', async () => {
    const existingPrincipal = INITIAL - 150_000; // 가용현금 150,000
    const prisma = makePrismaMock(existingPrincipal, 5);
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    // 슬롯(49)·후보(5)가 충분해도 가용현금(150,000)에서 1건만 예약(가드 발동). 즉시 체결 0.
    expect(result.reserved).toBe(1);
    expect(result.bought).toBe(0);
    expect(prisma._reservations.length).toBe(1);
    expect(prisma._created.length).toBe(0); // Position 은 예약 시점에 만들지 않는다
    // 예약 몫(주문수량×기준가) ≤ 가용현금 → 체결 시 현금 음수 불가(재클램프가 최종 방어).
    const r = prisma._reservations[0];
    // floor(min(400000,150000) / roundToTick(10000×1.0005)) = floor(150000/10010) = 14 주.
    expect(r.orderedShares).toBe(14);
    expect((r.orderedShares as number) * PRICE).toBeLessThanOrEqual(150_000);
    expect(r.status).toBe('PENDING');
    expect(r.styleTag).toBe('paper-simulation');
    // 예약 체결 예정일 = 다음 거래일(20260623 화 → 20260624 수).
    expect(r.entryDate).toEqual(kstMidnight('20260624'));
  });

  it('현금 완전 소진(가용현금 0) 시 추가 예약 0', async () => {
    const existingPrincipal = INITIAL; // 가용현금 0
    const prisma = makePrismaMock(existingPrincipal, 5);
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    expect(result.reserved).toBe(0);
    expect(prisma._reservations.length).toBe(0);
  });

  it('현금 충분하면 후보 전량 예약하되 예약 합계가 자본을 넘지 않는다', async () => {
    const prisma = makePrismaMock(0, 3); // 가용현금 = 전액 10,000,000
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    // 종목당 예산 400,000 × 3 = 1,200,000 < 10,000,000 → 3건 모두 예약.
    expect(result.reserved).toBe(3);
    expect(prisma._reservations.length).toBe(3);
    const reservedSum = prisma._reservations.reduce(
      (s, r) => s + (r.orderedShares as number) * PRICE,
      0,
    );
    expect(reservedSum).toBeLessThanOrEqual(INITIAL);
  });

  it('미체결 예약(PENDING)이 이미 현금을 잡고 있으면 새 예약이 그 몫을 재배분하지 않는다', async () => {
    // 기보유 0 이지만 기존 예약이 9,900,000 을 점유 → 잔여 100,000 만 배분 가능.
    const pending: PendingRow[] = [
      {
        id: 'pt-old',
        corpCode: 'HELD',
        stockCode: '999',
        direction: 'BUY',
        orderedShares: 990,
        entryPrice: PRICE, // 990×10000 = 9,900,000 점유
        entryDate: kstMidnight('20270101'), // 미래 예약 — 이번 사이클 체결 대상 아님
        positionThesisId: null,
        status: 'PENDING',
        styleTag: 'paper-simulation',
        createdAt: new Date('2026-06-22T10:30:00Z'),
      },
    ];
    const prisma = makePrismaMock(0, 5, pending);
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
    );

    const result = await svc.runDailyCycle('20260623');

    // 잔여 100,000 → floor(100000/10010)=9주 1건만 예약되고 멈춘다.
    expect(result.reserved).toBe(1);
    expect(prisma._reservations[0].orderedShares).toBe(9);
  });

  // ── F6(2026-06-27): kill-switch 가 시스템 모의 신규 진입(예약)을 차단 ──
  it('F6: kill-switch 발동 시 신규 예약 전면 차단(reserved 0)', async () => {
    const prisma = makePrismaMock(0, 5); // 가용현금 충분·후보 5(평소 다건 예약)
    const ks = new KillSwitchManager();
    await ks.activate('수동 점검', 'USER');
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
      undefined,
      undefined,
      ks,
    );

    const result = await svc.runDailyCycle('20260623');

    expect(result.reserved).toBe(0);
    expect(prisma._reservations.length).toBe(0);
  });

  it('F6: kill-switch 비활성이면 정상 예약(대조)', async () => {
    const prisma = makePrismaMock(0, 5);
    const ks = new KillSwitchManager(); // 미발동
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(),
      undefined,
      undefined,
      ks,
    );

    const result = await svc.runDailyCycle('20260623');

    expect(result.reserved).toBeGreaterThan(0);
  });
});

describe('DAR-426 가용현금 가드 (B) 체결 시점 — SSOT 현금 재클램프(cash ≥ 0 불변식)', () => {
  const duePending: PendingRow = {
    id: 'pt1',
    corpCode: 'C0',
    stockCode: '000',
    direction: 'BUY',
    orderedShares: 40, // 예약 당시엔 40주 여유였으나 이후 현금이 줄었다고 가정
    entryPrice: PRICE,
    entryDate: kstMidnight('20260623'), // 오늘 체결 예정
    positionThesisId: null,
    status: 'PENDING',
    styleTag: 'paper-simulation',
    createdAt: new Date('2026-06-22T10:30:00Z'),
  };

  const openRow: SimPriceRow = {
    openPrice: PRICE,
    highPrice: PRICE,
    lowPrice: PRICE,
    closePrice: PRICE,
    volume: BigInt(1_000_000),
    source: 'REAL',
    sourceDate: '20260623',
  };

  it('체결 시점 현금이 100,000 뿐이면 주문 40주를 9주로 절삭 체결(현금 음수 불가)', async () => {
    const existingPrincipal = INITIAL - 100_000; // 체결 시점 가용현금 100,000
    const prisma = makePrismaMock(existingPrincipal, 0, [duePending]);
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(openRow),
    );

    const result = await svc.runDailyCycle('20260623');

    expect(result.bought).toBe(1);
    expect(prisma._created.length).toBe(1);
    // floor(min(40×10000, 100000) / roundToTick(10000×1.0005)) = floor(100000/10010) = 9주.
    expect(prisma._created[0].quantity).toBe(9);
    expect(prisma._created[0].entryAmount as number).toBeLessThanOrEqual(100_000);
    // 예약 행이 체결 확정(FILLED)으로 갱신.
    const upd = prisma._tradeUpdates.find((u) => u.id === 'pt1');
    expect(upd?.data.status).toBe('FILLED');
    expect(upd?.data.filledShares).toBe(9);
  });

  it('체결 시점 현금 0 이면 체결 보류(PENDING 유지 — 이월)', async () => {
    const prisma = makePrismaMock(INITIAL, 0, [duePending]); // 가용현금 0
    const svc = new PaperSimulationService(
      prisma as never,
      makePaperTradeStub() as never,
      undefined,
      makePriceSourceStub(openRow),
    );

    const result = await svc.runDailyCycle('20260623');

    expect(result.bought).toBe(0);
    expect(prisma._created.length).toBe(0);
    // CANCELLED 로 바꾸지 않는다(청산으로 현금 회복 가능 — 이월 상한이 정리).
    expect(prisma._tradeUpdates.some((u) => u.data.status === 'CANCELLED')).toBe(false);
  });
});
