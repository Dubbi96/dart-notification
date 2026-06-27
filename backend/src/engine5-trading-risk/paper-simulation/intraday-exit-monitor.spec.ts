/**
 * intraday-exit-monitor.spec.ts — DAR-366 장중 손절 모니터(능동 fetch → 실가 평가 → 손절 발화)
 *
 * 검증:
 *   1) 장중(평일 09:00~15:30 KST) + 보유종목 실시간 -10% → 능동 fetch 로 캐시 적재 → evaluateExits EXIT 발화.
 *   2) 장외(주말/장 마감 후) → 평가/호출 없이 스킵(거짓 손절 방지).
 *   3) KIS 미설정 → 능동 fetch no-op(fetched=0), 평가는 폴백(회귀 0).
 *   4) 능동 fetch 는 RealtimeQuoteCache 를 '쓰기'(set)로 채운다 — 모바일 우연 캐싱 비의존.
 *
 * 통합: 실제 SimulationPriceSourceService + 실제 RealtimeQuoteCache + KIS 스텁으로 '능동 fetch→실가 평가'
 *   경로를 끝까지 통과시킨다. KST=UTC+9, 2026-06-19=금. 장중 12:00 KST = UTC 03:00Z, 장외 19:30 KST = UTC 10:30Z.
 *
 * ★AI 금지영역 불가침: 손절은 순수 Rule(exit-score 하드 스탑) — AI 미개입.
 */

import { PaperSimulationService, tradingDayDiff } from './paper-simulation.service';
import { SimulationPriceSourceService } from './simulation-price-source.service';
import { RealtimeQuoteCache } from '../../engine3-quant-market/market-data/realtime-quote.cache';

const MARKET_HOURS = new Date('2026-06-19T03:00:00Z'); // KST 금 12:00 (장중)
const AFTER_HOURS = new Date('2026-06-19T10:30:00Z'); // KST 금 19:30 (장외)
const WEEKEND = new Date('2026-06-20T03:00:00Z'); // KST 토 12:00 (주말)

const POS = {
  id: 'pos1',
  corpCode: '00126380',
  stockCode: '005930',
  entryPrice: 10000,
  quantity: 10,
  entryAmount: 100000,
  currentPrice: 10000,
  highestPrice: 10000,
  stopLossPct: 8,
  takeProfitPct: 20,
  maxHoldDays: 20,
  entryDate: new Date('2026-06-10T00:00:00Z'),
  positionThesisId: null,
  status: 'OPEN',
};

function makePrisma() {
  const state = { closed: false };
  const updates: Array<Record<string, unknown>> = [];
  return {
    _updates: updates,
    _state: state,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
    portfolio: { findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }), create: jest.fn() },
    position: {
      findMany: jest.fn(async ({ select }: { where?: any; select?: any }) => {
        if (state.closed) return [];
        // refreshHoldingsRealtime: select {corpCode, stockCode}
        if (select && select.corpCode && select.stockCode && !select.entryPrice) {
          return [{ corpCode: POS.corpCode, stockCode: POS.stockCode }];
        }
        // evaluateExits: 전체 OPEN
        return [POS];
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        if (data.status === 'CLOSED') state.closed = true;
        return {};
      }),
    },
    positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
    positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }) },
    paperTrade: { update: jest.fn().mockResolvedValue({}) },
    // 실시간 미가용(KIS 미설정) 시 latestPriceRow 가 REAL 폴백으로 조회 — 데이터 없음(null) → 평가 스킵.
    stockDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

function paperTradeStub() {
  return {
    placeOrder: jest.fn(async ({ direction, orderedShares, entryPrice }: {
      direction: string;
      orderedShares: number;
      entryPrice: number;
    }) => ({ id: direction === 'SELL' ? 'sell1' : 'buy1', filledShares: orderedShares, filledPrice: entryPrice, commission: 0, tax: 0 })),
  };
}

/** KIS 스텁 — fetchCurrentPrice 가 실시간 현재가를 돌려준다(능동 fetch 대상). */
function kisStub(price: number, configured = true) {
  return {
    isConfigured: configured,
    fetchCurrentPrice: jest.fn(async () => (price > 0 ? { price, open: price, high: price, low: price, volume: 1000 } : null)),
  };
}

afterEach(() => jest.clearAllMocks());

describe('DAR-366 — 장중 손절 모니터(능동 fetch → 실가 -8% EXIT)', () => {
  it('장중 + 실시간 -10% → 능동 fetch 후 EXIT 발화', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000); // 실시간 9000 = entry 10000 대비 -10%
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.ran).toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.fetched).toBe(1);
    expect(r.cached).toBe(1);
    expect(r.exited).toBe(1);
    // 능동 fetch 가 KIS 호출 + 캐시 적재(읽기 의존 아님)
    expect(kis.fetchCurrentPrice).toHaveBeenCalledWith(POS.stockCode);
    expect(cache.getFresh(POS.corpCode)?.price).toBe(9000);
    // 실가 기준 매도 체결
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter((c) => c[0].direction === 'SELL');
    expect(sells.length).toBe(1);
    expect(sells[0][0].entryPrice).toBe(9000);
    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(true);
  });

  it('장중 + 실시간 -5% → 손절 미발화(HOLD)', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(prisma as never, paperTrade as never, undefined, priceSource, kisStub(9500) as never, cache);

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.ran).toBe(true);
    expect(r.exited).toBe(0);
    expect((paperTrade.placeOrder as jest.Mock).mock.calls.length).toBe(0);
  });

  it('장외(장 마감 후 19:30) → 평가/fetch 없이 스킵', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(prisma as never, paperTrade as never, undefined, priceSource, kis as never, cache);

    const r = await svc.runIntradayExitMonitor(AFTER_HOURS);

    expect(r.ran).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.fetched).toBe(0);
    expect(r.exited).toBe(0);
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
    expect((paperTrade.placeOrder as jest.Mock).mock.calls.length).toBe(0);
  });

  it('주말 → 스킵(거짓 손절 없음)', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000);
    const svc = new PaperSimulationService(prisma as never, paperTradeStub() as never, undefined, priceSource, kis as never, cache);

    const r = await svc.runIntradayExitMonitor(WEEKEND);

    expect(r.ran).toBe(false);
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
  });

  it('KIS 미설정 → 능동 fetch no-op(fetched=0)·평가는 폴백(회귀 0)', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    // 캐시에 직전(미설정 전) 신선 실시간가가 우연히 있어도 평가는 폴백 경로로 동작해야 한다.
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000, false); // 미설정
    const svc = new PaperSimulationService(prisma as never, paperTradeStub() as never, undefined, priceSource, kis as never, cache);

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.ran).toBe(true);
    expect(r.fetched).toBe(0);
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
  });
});

// ── F1(2026-06-26): 장중 실시간 손절 vs cross-source 가짜손절 (entry=REAL 신선도 가드) ──
const ymdUtc = (d: Date) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
};

describe('F1 — entry=REAL 장중 손절 신선도 가드', () => {
  // REAL 일봉을 tradeDate(=sourceDate)로 통제. 실시간 sourceDate 는 오늘(fetchedAtMs=Date.now()).
  function makePrismaReal(barClose: number, barTradeDate: string) {
    const updates: Array<Record<string, unknown>> = [];
    const state = { closed: false };
    const POS_REAL = { ...POS, entryPriceSource: 'REAL' };
    return {
      _updates: updates,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        create: jest.fn(),
      },
      position: {
        findMany: jest.fn(async ({ select }: { where?: any; select?: any }) => {
          if (state.closed) return [];
          if (select && select.corpCode && select.stockCode && !select.entryPrice) {
            return [{ corpCode: POS.corpCode, stockCode: POS.stockCode }];
          }
          return [POS_REAL];
        }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          if (data.status === 'CLOSED') state.closed = true;
          return {};
        }),
      },
      positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
      positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }) },
      paperTrade: { update: jest.fn().mockResolvedValue({}) },
      // REAL 일봉 — entry 소스 정렬 조회 대상. tradeDate 로 신선/정체 통제.
      stockDailyPrice: {
        findFirst: jest.fn().mockResolvedValue({
          openPrice: barClose,
          highPrice: barClose,
          lowPrice: barClose,
          closePrice: barClose,
          volume: BigInt(1000),
          tradeDate: barTradeDate,
        }),
      },
      simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it('신선한 일봉(당일) + 실시간 -10% → 실시간 손절 발화(F1 복원)', async () => {
    const today = ymdUtc(new Date());
    const prisma = makePrismaReal(10000, today); // REAL 일봉=진입가(손실 아님), 당일=신선
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000); // 실시간 -10%
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.exited).toBe(1); // 신선 → 실시간 9000 평가 → -10% EXIT
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter(
      (c) => c[0].direction === 'SELL',
    );
    expect(sells[0][0].entryPrice).toBe(9000);
  });

  it('정체 일봉(40일 전) + 실시간 -10% → 미발화(DAR-433 가짜손절 가드 보존)', async () => {
    const staleBar = ymdUtc(new Date(Date.now() - 40 * 86_400_000));
    const prisma = makePrismaReal(10000, staleBar); // REAL 일봉=진입가(정체), 실시간만 9000
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.exited).toBe(0); // 정체 → 정렬된 REAL 10000 평가 → 손실 아님 → 미발화
    expect(
      (paperTrade.placeOrder as jest.Mock).mock.calls.filter(
        (c) => c[0].direction === 'SELL',
      ).length,
    ).toBe(0);
  });
});

describe('tradingDayDiff — 거래일 차(주말 흡수, 월요일 손절억제 회귀 차단)', () => {
  it('금요일→월요일 = 1 거래일(달력 3일 아님)', () => {
    expect(tradingDayDiff('20260619', '20260622')).toBe(1); // 금 → 월
  });
  it('목요일→월요일 = 2', () => {
    expect(tradingDayDiff('20260618', '20260622')).toBe(2);
  });
  it('같은 날 = 0', () => {
    expect(tradingDayDiff('20260622', '20260622')).toBe(0);
  });
  it('정체(달력 14일 초과) = 999', () => {
    expect(tradingDayDiff('20260601', '20260626')).toBe(999);
  });
});

// ── F3(2026-06-26): evaluateExits 에 실 악재 공시·지표 주입(6 트리거 복원) ──
describe('F3 — 악재 공시·지표 주입으로 청산점수 복원', () => {
  function makePrismaEnriched(opts: { events: Array<{ eventType: string; rcpNo: string }> }) {
    const exitSignals: Array<Record<string, unknown>> = [];
    const state = { closed: false };
    return {
      _exitSignals: exitSignals,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        create: jest.fn(),
      },
      position: {
        findMany: jest.fn(async ({ select }: { where?: any; select?: any }) => {
          if (state.closed) return [];
          if (select && select.corpCode && select.stockCode && !select.entryPrice) {
            return [{ corpCode: POS.corpCode, stockCode: POS.stockCode }];
          }
          return [POS]; // entryPriceSource 없음 → 신선도 가드 미적용(실시간 평가)
        }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.status === 'CLOSED') state.closed = true;
          return {};
        }),
      },
      positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
      positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      exitSignal: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          exitSignals.push(data);
          return { id: 'ex1' };
        }),
      },
      paperTrade: { update: jest.fn().mockResolvedValue({}) },
      technicalIndicator: { findFirst: jest.fn().mockResolvedValue(null) },
      disclosureEvent: { findMany: jest.fn().mockResolvedValue(opts.events) },
      stockDailyPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ lowPrice: 9000 }]),
      },
      simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it('고위험 악재 공시 주입 → 손실 없어도 청산점수 상승(severe → 최소 WATCH)', async () => {
    // 실시간=진입가(손실 0) — 악재 공시만으로 점수가 오르는지 검증(과거엔 events=[] 라 HOLD).
    const prisma = makePrismaEnriched({
      events: [{ eventType: 'TRADING_SUSPENSION', rcpNo: 'R1' }],
    });
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kisStub(10000) as never, // 진입가와 동일 → 손실 트리거 없음
      cache,
    );

    await svc.runIntradayExitMonitor(MARKET_HOURS);

    const sig = prisma._exitSignals[0] as any;
    expect(sig).toBeDefined();
    expect(sig.disclosureRiskScore).toBeGreaterThan(0); // 악재 주입 반영
    expect(sig.exitScore).toBeGreaterThanOrEqual(30); // severe → 최소 WATCH(공시 단독 자동매도는 아님)
    expect(sig.triggerTypes).toContain('THESIS_INVALIDATED');
  });

  it('빈 입력(악재 없음·지표 null) + 손실 없음 → HOLD(점수 0) — F3 전 동작과 동치(회귀 0)', async () => {
    const prisma = makePrismaEnriched({ events: [] });
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kisStub(10000) as never,
      cache,
    );

    await svc.runIntradayExitMonitor(MARKET_HOURS);

    const sig = prisma._exitSignals[0] as any;
    expect(sig.exitScore).toBe(0);
    expect(sig.exitAction).toBe('HOLD');
  });
});

// ── F2(2026-06-27): 익절 부분 스케일아웃(합성 CLOSED 행, 스키마 변경 0) ──
describe('F2 — 익절 부분 스케일아웃', () => {
  function makePrismaPartial() {
    const creates: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const state = { closed: false };
    return {
      _creates: creates,
      _updates: updates,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        create: jest.fn(),
      },
      position: {
        findMany: jest.fn(async ({ select }: { where?: any; select?: any }) => {
          if (state.closed) return [];
          if (select && select.corpCode && select.stockCode && !select.entryPrice) {
            return [{ corpCode: POS.corpCode, stockCode: POS.stockCode }];
          }
          return [POS]; // entryPrice 10000·quantity 10·takeProfitPct 20
        }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return { id: 'syn1' };
        }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          if (data.status === 'CLOSED') state.closed = true;
          return {};
        }),
      },
      positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
      positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      exitSignal: { create: jest.fn().mockResolvedValue({ id: 'ex1' }) },
      paperTrade: { update: jest.fn().mockResolvedValue({}) },
      technicalIndicator: { findFirst: jest.fn().mockResolvedValue(null) },
      disclosureEvent: { findMany: jest.fn().mockResolvedValue([]) },
      stockDailyPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it('익절 목표(+20%) 도달 → 절반 매도(합성 CLOSED 행) + 잔량 OPEN 유지', async () => {
    const prisma = makePrismaPartial();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const paperTrade = paperTradeStub();
    const svc = new PaperSimulationService(
      prisma as never,
      paperTrade as never,
      undefined,
      priceSource,
      kisStub(12000) as never, // entry 10000 → +20% 익절
      cache,
    );

    await svc.runIntradayExitMonitor(MARKET_HOURS);

    // 합성 CLOSED 행: 매도분 5주(=10×0.5), 실현손익>0
    const syn = prisma._creates.find((c) => c.status === 'CLOSED') as any;
    expect(syn).toBeDefined();
    expect(syn.quantity).toBe(5);
    expect(syn.unrealizedPnl).toBeGreaterThan(0);
    expect(syn.positionThesisId).toBeNull(); // @unique 충돌 방지
    // OPEN 잔량 축소(전량 청산 아님)
    const openUpdate = prisma._updates.find(
      (u) => u.quantity === 5 && u.status === undefined,
    );
    expect(openUpdate).toBeDefined();
    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(false);
    // 매도 주문 5주
    const sells = (paperTrade.placeOrder as jest.Mock).mock.calls.filter(
      (c) => c[0].direction === 'SELL',
    );
    expect(sells[0][0].orderedShares).toBe(5);
  });

  it('손절(전량 EXIT)은 부분 아님 — 합성 CLOSED 없이 전량 청산', async () => {
    const prisma = makePrismaPartial();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kisStub(9000) as never, // entry 10000 → -10% 손절
      cache,
    );

    await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(prisma._updates.some((u) => u.status === 'CLOSED')).toBe(true); // 전량 청산
    expect(prisma._creates.length).toBe(0); // 합성 CLOSED 미생성
  });
});
