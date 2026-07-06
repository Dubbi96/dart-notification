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

// 장외 REALTIME 오염 게이트(2026-07)가 quote 의 fetchedAtMs(=Date.now())로 정규장 여부를 판정한다.
// 테스트 실행 시각(벽시계)에 좌우되지 않도록 Date.now 를 '장중' 고정 시각으로 스핀(결정론).
let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(MARKET_HOURS.getTime());
});

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
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'pf1', name: '모의운용 포트폴리오' }]),
      create: jest.fn(),
    },
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
    exitSignal: {
      create: jest.fn().mockResolvedValue({ id: 'ex1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    paperTrade: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
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

afterEach(() => {
  nowSpy.mockRestore();
  jest.clearAllMocks();
});

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
describe('F1 — entry=REAL 장중 손절 신선도 가드', () => {
  // REAL 일봉을 tradeDate(=sourceDate)로 통제. 실시간 sourceDate 는 '오늘'(fetchedAtMs=Date.now(),
  // 위 스파이로 20260619 고정 — 결정론).
  function makePrismaReal(barClose: number, barTradeDate: string) {
    const updates: Array<Record<string, unknown>> = [];
    const state = { closed: false };
    const POS_REAL = { ...POS, entryPriceSource: 'REAL' };
    return {
      _updates: updates,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'pf1', name: '모의운용 포트폴리오' }]),
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
      exitSignal: {
        create: jest.fn().mockResolvedValue({ id: 'ex1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      paperTrade: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
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
    const today = '20260619'; // = 고정 스파이 시각(MARKET_HOURS)의 거래일
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
    const staleBar = '20260510'; // 고정 스파이 시각(20260619) 대비 40일 전 = 정체
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
        findMany: jest.fn().mockResolvedValue([{ id: 'pf1', name: '모의운용 포트폴리오' }]),
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
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      paperTrade: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
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
        findMany: jest.fn().mockResolvedValue([{ id: 'pf1', name: '모의운용 포트폴리오' }]),
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
      exitSignal: {
        create: jest.fn().mockResolvedValue({ id: 'ex1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      paperTrade: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
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

// ── F7(2026-06-27): 매수 수수료 회계 반영(청산 netPnl) ──
describe('F7 — 매수 수수료 차감', () => {
  function paperTradeWithCosts() {
    return {
      placeOrder: jest.fn(
        async ({
          direction,
          orderedShares,
          entryPrice,
        }: {
          direction: string;
          orderedShares: number;
          entryPrice: number;
        }) => ({
          id: direction === 'SELL' ? 'sell1' : 'buy1',
          filledShares: orderedShares,
          filledPrice: entryPrice,
          commission: direction === 'SELL' ? 50 : 0,
          tax: direction === 'SELL' ? 100 : 0,
        }),
      ),
    };
  }

  it('청산 netPnl = grossPnl − 매수수수료 − 매도수수료 − 세금 (매수 수수료 누락 교정)', async () => {
    const prisma = makePrisma(); // POS entryPrice 10000·quantity 10·entryAmount 100000
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeWithCosts() as never,
      undefined,
      priceSource,
      kisStub(9000) as never, // -10% 손절 전량청산
      cache,
    );

    await svc.runIntradayExitMonitor(MARKET_HOURS);

    const closed = prisma._updates.find((u) => u.status === 'CLOSED') as any;
    expect(closed).toBeDefined();
    // gross=(9000-10000)*10=-10000, buyComm=100000×0.00015=15, sellComm=50, tax=100 → -10165
    expect(closed.unrealizedPnl).toBeCloseTo(-10165, 5);
  });
});

// ── 장외 체결 의미론(2026-07): 개장 체결기 · 다중 포트폴리오 모니터 · 장외 warm 게이트 ──

/** KST ymd 자정 Date — 예약 entryDate 규약(서비스 kstMidnight 과 동일). */
const kstMidnight = (ymd: string) =>
  new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`);

describe('개장 체결기 — 장중 첫 유효 틱이 매수 예약을 당일 시가(실시간 open)로 체결', () => {
  function makeFillPrisma() {
    const created: Array<Record<string, unknown>> = [];
    const reservations: Array<Record<string, unknown>> = [
      {
        id: 'pt1',
        corpCode: POS.corpCode,
        stockCode: POS.stockCode,
        direction: 'BUY',
        orderedShares: 10,
        entryPrice: 10000, // 예약 기준가(전일 평가가)
        entryDate: kstMidnight('20260619'), // 오늘 체결 예정
        positionThesisId: null,
        status: 'PENDING',
        styleTag: 'paper-simulation',
        createdAt: new Date('2026-06-18T10:30:00Z'),
      },
    ];
    return {
      _created: created,
      _reservations: reservations,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'pf1', name: '모의운용 포트폴리오' }]),
        create: jest.fn(),
      },
      position: {
        findMany: jest.fn().mockResolvedValue([]), // 보유 없음(신규 체결 검증)
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `pos${created.length}` };
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
      positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      exitSignal: {
        create: jest.fn().mockResolvedValue({ id: 'ex1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      paperTrade: {
        findMany: jest.fn(async () => reservations.filter((r) => r.status === 'PENDING')),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const rec = reservations.find((r) => r.id === where.id);
          if (rec) Object.assign(rec, data);
          return {};
        }),
      },
      stockDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
      simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it('첫 틱: 예약 → KIS 실시간 quote 의 open(당일 시가)으로 체결 + entryPriceSource=REALTIME', async () => {
    const prisma = makeFillPrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    // KIS: 현재가 9500·당일 시가 9400 — 체결은 '시가(9400)' 기준이어야 한다(현재가 아님).
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async () => ({ price: 9500, open: 9400, high: 9550, low: 9350, volume: 1000 })),
    };
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.ran).toBe(true);
    expect(r.entryFilled).toBe(1);
    // 체결가 = 시가(9400) × 동적 슬리피지 → 호가 정렬(9420). 현재가(9500) 기준이 아니다.
    expect(prisma._created.length).toBe(1);
    const pos = prisma._created[0] as any;
    expect(pos.entryPriceSource).toBe('REALTIME');
    expect(pos.entryPrice).toBe(9420);
    expect(pos.quantity).toBe(10);
    // 예약 원장이 FILLED 로 확정.
    expect((prisma._reservations[0] as any).status).toBe('FILLED');
    expect((prisma._reservations[0] as any).filledShares).toBe(10);
  });

  it('멱등: 체결 후 다음 틱에서는 PENDING 이 없어 재체결 0', async () => {
    const prisma = makeFillPrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async () => ({ price: 9500, open: 9400, high: 9550, low: 9350, volume: 1000 })),
    };
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const first = await svc.runIntradayExitMonitor(MARKET_HOURS);
    const second = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(first.entryFilled).toBe(1);
    expect(second.entryFilled).toBe(0);
    expect(prisma._created.length).toBe(1); // Position 중복 생성 없음
  });
});

describe('다중 포트폴리오 모니터 — 시스템 모의 + styleTag 네임스페이스 전 트랙 손절', () => {
  const POS_B = { ...POS, id: 'pos2', corpCode: '00999999', stockCode: '000660' };

  function makeMultiPrisma() {
    const closed = new Set<string>();
    const updates: Array<Record<string, unknown>> = [];
    const byPortfolio: Record<string, typeof POS> = { pf1: POS, pf2: POS_B };
    return {
      _updates: updates,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        // 이름 규약(prefix)으로 시스템 모의 + 스타일 트랙이 함께 잡힌다 — 하드코딩 목록 없음.
        findMany: jest.fn().mockResolvedValue([
          { id: 'pf1', name: '모의운용 포트폴리오' },
          { id: 'pf2', name: '모의운용 포트폴리오 [BUFFETT]' },
        ]),
        create: jest.fn(),
      },
      position: {
        findMany: jest.fn(async ({ where, select }: { where?: any; select?: any }) => {
          const pos = byPortfolio[where?.portfolioId as string];
          if (!pos || closed.has(pos.id)) return [];
          if (select && select.corpCode && select.stockCode && !select.entryPrice) {
            return [{ corpCode: pos.corpCode, stockCode: pos.stockCode }];
          }
          return [pos];
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, ...data });
          if (data.status === 'CLOSED') closed.add(where.id);
          return {};
        }),
      },
      positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
      positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      exitSignal: {
        create: jest.fn().mockResolvedValue({ id: 'ex1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      paperTrade: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      technicalIndicator: { findFirst: jest.fn().mockResolvedValue(null) },
      disclosureEvent: { findMany: jest.fn().mockResolvedValue([]) },
      stockDailyPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it('두 트랙(pf1·pf2) 보유 종목 모두 실시간 -10% → 둘 다 손절 발화(단일 포트폴리오 하드코딩 아님)', async () => {
    const prisma = makeMultiPrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000); // 두 종목 다 -10%
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

    expect(r.portfolios).toBe(2);
    expect(r.exited).toBe(2);
    // 두 종목 모두 능동 fetch 됐다(트랙별 보유 종목).
    expect(kis.fetchCurrentPrice).toHaveBeenCalledWith(POS.stockCode);
    expect(kis.fetchCurrentPrice).toHaveBeenCalledWith(POS_B.stockCode);
    // 두 포지션 모두 CLOSED.
    expect(prisma._updates.filter((u) => u.status === 'CLOSED').length).toBe(2);
  });
});

describe('장외 warm 게이트 — 정규장 밖 KIS fetch 차단(REALTIME 오염 방지)', () => {
  it('장외 시각을 넘기면 warmRealtimeQuotes 가 no-op(fetch 0·KIS 미호출)', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const r = await (svc as unknown as {
      warmRealtimeQuotes: (
        t: Array<{ corpCode: string | null; stockCode: string | null }>,
        now: Date,
      ) => Promise<{ fetched: number; cached: number }>;
    }).warmRealtimeQuotes([{ corpCode: POS.corpCode, stockCode: POS.stockCode }], AFTER_HOURS);

    expect(r.fetched).toBe(0);
    expect(r.cached).toBe(0);
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
  });

  it('장중 시각이면 warm 이 동작(대조)', async () => {
    const prisma = makePrisma();
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const kis = kisStub(9000);
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      undefined,
      priceSource,
      kis as never,
      cache,
    );

    const r = await (svc as unknown as {
      warmRealtimeQuotes: (
        t: Array<{ corpCode: string | null; stockCode: string | null }>,
        now: Date,
      ) => Promise<{ fetched: number; cached: number }>;
    }).warmRealtimeQuotes([{ corpCode: POS.corpCode, stockCode: POS.stockCode }], MARKET_HOURS);

    expect(r.fetched).toBe(1);
    expect(kis.fetchCurrentPrice).toHaveBeenCalledWith(POS.stockCode);
  });
});

// ── 개장 체결기 — 트랙 네임스페이스 일반화(개장 체결 정렬, 2026-07-06) ──
// 장중 모니터가 포트폴리오 이름 규약에서 styleTag 를 도출해 철학/전략 forward 예약도 당일 시가로
// 체결한다. 도출 불가한 이름([alloc:*] 등)은 스킵. 시스템 모의(paper-simulation) 경로는 무변경.
describe('개장 체결기 — 트랙 네임스페이스 일반화(철학/전략 예약 체결·미상 스킵)', () => {
  function makeTrackFillPrisma(reservations: Array<Record<string, unknown>>) {
    const created: Array<Record<string, unknown>> = [];
    const styleTagQueries: string[] = [];
    return {
      _created: created,
      _reservations: reservations,
      _styleTagQueries: styleTagQueries,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
      portfolio: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pf1', maxSinglePositionPct: 10 }),
        // 이름 규약: 시스템 + 철학 + 전략 + 미상(alloc — 자체 체결기 보유 트랙) 혼재.
        findMany: jest.fn().mockResolvedValue([
          { id: 'pf1', name: '모의운용 포트폴리오' },
          { id: 'pf2', name: '모의운용 포트폴리오 [BUFFETT]' },
          { id: 'pf3', name: '모의운용 포트폴리오 [strategy:short-momentum]' },
          { id: 'pf4', name: '모의운용 포트폴리오 [alloc:dual-momentum]' },
        ]),
        create: jest.fn(),
      },
      position: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `pos${created.length}` };
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
      positionDailySnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      exitSignal: {
        create: jest.fn().mockResolvedValue({ id: 'ex1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      paperTrade: {
        // 네임스페이스(styleTag) 쿼리 분기 — 어떤 트랙이 조회됐는지 기록.
        findMany: jest.fn(async ({ where }: { where: { styleTag: string } }) => {
          styleTagQueries.push(where.styleTag);
          return reservations.filter(
            (r) => r.status === 'PENDING' && r.styleTag === where.styleTag,
          );
        }),
        update: jest.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const rec = reservations.find((r) => r.id === where.id);
            if (rec) Object.assign(rec, data);
            return {};
          },
        ),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ corpName: '삼성전자' }) },
      stockDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
      simulatedDailyPrice: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  const openQuoteKis = {
    isConfigured: true,
    fetchCurrentPrice: jest.fn(async () => ({
      price: 9500,
      open: 9400,
      high: 9550,
      low: 9350,
      volume: 1000,
    })),
  };

  it('철학([BUFFETT]) 예약을 당일 시가로 체결하고 체결 알림 strategyKey=styleTag 로 발행한다', async () => {
    const prisma = makeTrackFillPrisma([
      {
        id: 'ptB',
        corpCode: POS.corpCode,
        stockCode: POS.stockCode,
        direction: 'BUY',
        orderedShares: 10,
        entryPrice: 10000,
        entryDate: kstMidnight('20260619'),
        positionThesisId: null,
        tradingSignalId: 'sigB',
        status: 'PENDING',
        styleTag: 'BUFFETT',
        createdAt: new Date('2026-06-18T10:40:00Z'),
      },
    ]);
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const notifyProducer = {
      enqueueTradeEntry: jest.fn().mockResolvedValue(undefined),
      enqueueTradeExit: jest.fn().mockResolvedValue(undefined),
      enqueueExit: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      notifyProducer as never,
      priceSource,
      openQuoteKis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.ran).toBe(true);
    expect(r.portfolios).toBe(4);
    expect(r.entryFilled).toBe(1);
    // 예약 원장 FILLED + Position 생성(pf2·thesis null → 기본 exit 파라미터).
    expect((prisma._reservations[0] as { status: string }).status).toBe('FILLED');
    expect(prisma._created).toHaveLength(1);
    expect(prisma._created[0]).toEqual(
      expect.objectContaining({
        portfolioId: 'pf2',
        entryPriceSource: 'REALTIME',
        stopLossPct: 8,
        takeProfitPct: 20,
        maxHoldDays: 20,
      }),
    );
    // 네임스페이스 조회: 시스템+철학+전략은 조회, 미상(alloc:*)은 스킵(안전).
    expect(prisma._styleTagQueries).toEqual(
      expect.arrayContaining(['paper-simulation', 'BUFFETT', 'strategy:short-momentum']),
    );
    expect(prisma._styleTagQueries).not.toContain('alloc:dual-momentum');
    // 체결 알림 — strategyKey=styleTag 그대로 + 트랙 라벨/딥링크(SSOT 라벨 '버핏').
    expect(notifyProducer.enqueueTradeEntry).toHaveBeenCalledTimes(1);
    expect(notifyProducer.enqueueTradeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ENTRY',
        phase: 'FILLED',
        strategyKey: 'BUFFETT',
        strategyLabel: '버핏',
        deepLink: '/portfolio?tab=style',
      }),
    );
  });

  it('전략([strategy:short-momentum]) 예약 체결은 프리셋 exitRules 를 대입한다(정체성 보존)', async () => {
    const prisma = makeTrackFillPrisma([
      {
        id: 'ptS',
        corpCode: POS.corpCode,
        stockCode: POS.stockCode,
        direction: 'BUY',
        orderedShares: 10,
        entryPrice: 10000,
        entryDate: kstMidnight('20260619'),
        positionThesisId: null,
        tradingSignalId: 'sigS',
        status: 'PENDING',
        styleTag: 'strategy:short-momentum',
        createdAt: new Date('2026-06-18T10:45:00Z'),
      },
    ]);
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const notifyProducer = {
      enqueueTradeEntry: jest.fn().mockResolvedValue(undefined),
      enqueueTradeExit: jest.fn().mockResolvedValue(undefined),
      enqueueExit: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      notifyProducer as never,
      priceSource,
      openQuoteKis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.entryFilled).toBe(1);
    // 프리셋 exitRules 대입(short-momentum: 손절 5·익절 10·보유 5) — thesis 파생·기본값 아님.
    expect(prisma._created[0]).toEqual(
      expect.objectContaining({
        portfolioId: 'pf3',
        stopLossPct: 5,
        takeProfitPct: 10,
        maxHoldDays: 5,
      }),
    );
    // 체결 알림 strategyKey 는 styleTag 그대로('strategy:short-momentum') — 라벨은 프리셋.
    expect(notifyProducer.enqueueTradeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyKey: 'strategy:short-momentum',
        strategyLabel: '단기모멘텀',
        deepLink: '/portfolio?tab=strategy',
      }),
    );
  });

  it('시스템 모의 예약 경로 중립성 — 일반화 후에도 기본 네임스페이스 체결이 종전과 동일', async () => {
    const prisma = makeTrackFillPrisma([
      {
        id: 'ptSys',
        corpCode: POS.corpCode,
        stockCode: POS.stockCode,
        direction: 'BUY',
        orderedShares: 10,
        entryPrice: 10000,
        entryDate: kstMidnight('20260619'),
        positionThesisId: null,
        tradingSignalId: null,
        status: 'PENDING',
        styleTag: 'paper-simulation',
        createdAt: new Date('2026-06-18T10:30:00Z'),
      },
    ]);
    const cache = new RealtimeQuoteCache();
    const priceSource = new SimulationPriceSourceService(prisma as never, cache);
    const notifyProducer = {
      enqueueTradeEntry: jest.fn().mockResolvedValue(undefined),
      enqueueTradeExit: jest.fn().mockResolvedValue(undefined),
      enqueueExit: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new PaperSimulationService(
      prisma as never,
      paperTradeStub() as never,
      notifyProducer as never,
      priceSource,
      openQuoteKis as never,
      cache,
    );

    const r = await svc.runIntradayExitMonitor(MARKET_HOURS);

    expect(r.entryFilled).toBe(1);
    // 종전 시스템 모의 계약 그대로: pf1·REALTIME 시가(9400) 슬리피지 후 9420·기본 exit 파라미터.
    expect(prisma._created[0]).toEqual(
      expect.objectContaining({
        portfolioId: 'pf1',
        entryPrice: 9420,
        entryPriceSource: 'REALTIME',
        stopLossPct: 8,
        takeProfitPct: 20,
        maxHoldDays: 20,
      }),
    );
    // 알림 메타도 종전 상수 그대로(시스템 모의 라벨·딥링크 — M10 무변경 봉인).
    expect(notifyProducer.enqueueTradeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyKey: 'paper-simulation',
        strategyLabel: '시스템 모의',
        deepLink: '/portfolio?tab=sim',
      }),
    );
  });
});
