/**
 * DAR-385 — BacktestReplayService 단위 테스트
 *
 * 1. executeReplay: InMemory 어댑터로 결정론적 1년형 리플레이 → 트랙레코드(승률·수익률·자산곡선) 산출
 * 2. ★point-in-time(lookahead 0): 구간/데이터 밖 시점은 진입 불가(미래 미참조)
 * 3. run(): 가짜 Prisma 로 신호조립→러너→영속(BacktestRun/Trade) 전 구간 + COMPLETED 전이
 */
import {
  BacktestReplayService,
  isFinitePositive,
  finiteOrNull,
  finiteOr,
  clampReturnPct,
  RETURN_PCT_LIMIT,
} from './backtest-replay.service';
import { BacktestSignalAssemblyService } from './backtest-signal-assembly.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { PriceConstraintService } from '../constraint/price-constraint.service';
import { PerformanceCalculatorService } from '../metrics/performance-calculator.service';
import { InMemoryPriceDataAdapter } from '../ports/in-memory-price-data.adapter';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DisclosureSignal,
  DailyPrice,
  StrategyParams,
  BacktestCostParams,
} from '../ports/backtest.types';

const calendar = new MarketCalendarService();
const constraint = new PriceConstraintService();
const performance = new PerformanceCalculatorService(calendar);

function buildService(prisma: PrismaService): BacktestReplayService {
  return new BacktestReplayService(
    prisma,
    new BacktestSignalAssemblyService(prisma),
    calendar,
    constraint,
    performance,
  );
}

function price(date: string, open: number, close: number, low?: number): DailyPrice {
  return {
    date,
    open,
    high: Math.max(open, close) * 1.01,
    low: low ?? Math.min(open, close) * 0.99,
    close,
    volume: 100000,
  };
}

const TRADING_DAYS = [
  '2025-07-01', '2025-07-02', '2025-07-03',
  '2025-08-01', '2025-08-04', '2025-08-05',
];

// 2승(+10% 익절) 1패(-8% 손절), 청산 2개월에 분산(자산곡선·월별)
const PRICES: Record<string, DailyPrice[]> = {
  '005930': [price('2025-07-01', 70000, 70000), price('2025-07-02', 70000, 70000), price('2025-07-03', 77001, 77001)],
  '035420': [price('2025-07-01', 30000, 30000), price('2025-07-02', 30000, 30000), price('2025-07-03', 27500, 27500, 27500)],
  '000660': [price('2025-08-01', 50000, 50000), price('2025-08-04', 50000, 50000), price('2025-08-05', 55001, 55001)],
};

const STRATEGY: StrategyParams = {
  minBuyScore: 50,
  entryRule: 'NEXT_OPEN',
  exitRules: { takeProfitPct: 10, stopLossPct: -8, maxHoldDays: 20 },
  sizeRule: 'EQUAL_WEIGHT',
  maxPositions: 5,
  initialCapital: 10_000_000,
};
const ZERO_COST: BacktestCostParams = { commissionRate: 0, taxRate: 0, slippagePct: 0 };

function signal(rcpNo: string, corpCode: string, stockCode: string, dateIso: string, buyScore = 70): DisclosureSignal {
  return {
    rcpNo,
    corpCode,
    stockCode,
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore,
    disclosureAt: new Date(`${dateIso}T10:00:00+09:00`),
  };
}

describe('BacktestReplayService.executeReplay — 결정론적 트랙레코드 산출', () => {
  const service = buildService({} as PrismaService);

  it('2승1패 → 승률 66.7%·거래 3건·자산곡선 시작점=초기자본', async () => {
    const adapter = new InMemoryPriceDataAdapter(PRICES, TRADING_DAYS);
    const signals = [
      signal('W1', 'A005930', '005930', '2025-07-01'),
      signal('L1', 'A035420', '035420', '2025-07-01', 65),
      signal('W2', 'A000660', '000660', '2025-08-01', 75),
    ];

    const { trades, metrics, equityCurve } = await service.executeReplay(
      signals, adapter, STRATEGY, ZERO_COST, '2025-07-01', '2025-08-31',
    );

    expect(trades).toHaveLength(3);
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.wonTrades).toBe(2);
    expect(metrics.winRate).toBeCloseTo(66.67, 1);
    expect(metrics.totalReturn).toBeGreaterThan(0);
    expect(metrics.mdd).toBeLessThanOrEqual(0);

    // 자산곡선: 시작점(초기자본) + 청산점들
    expect(equityCurve[0].equity).toBe(10_000_000);
    expect(equityCurve.length).toBeGreaterThanOrEqual(2);
    expect(equityCurve[equityCurve.length - 1].returnPct).toBeCloseTo(metrics.totalReturn, 6);
    // 월별 수익 2개월 집계
    expect(Object.keys(metrics.monthlyReturns).sort()).toEqual(['2025-07', '2025-08']);
  });

  it('★point-in-time: 데이터 마지막 거래일 공시는 진입 불가(미래 시가 미참조)', async () => {
    const adapter = new InMemoryPriceDataAdapter(PRICES, TRADING_DAYS);
    // 마지막 거래일(2025-08-05)에 공시 → 다음 거래일 없음 → 진입 0
    const lateSignal = signal('LATE', 'A005930', '005930', '2025-08-05');
    const { trades } = await service.executeReplay(
      [lateSignal], adapter, STRATEGY, ZERO_COST, '2025-07-01', '2025-08-31',
    );
    expect(trades).toHaveLength(0);
  });
});

// =========================================================
// run() — 가짜 Prisma 로 신호조립→러너→영속 전 구간
// =========================================================

interface PriceRow {
  stockCode: string;
  tradeDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: bigint;
}

function row(stockCode: string, tradeDate: string, open: number, close: number, low?: number): PriceRow {
  return {
    stockCode,
    tradeDate,
    openPrice: open,
    highPrice: Math.round(Math.max(open, close) * 1.01),
    lowPrice: low ?? Math.round(Math.min(open, close) * 0.99),
    closePrice: close,
    volume: 100000n,
  };
}

const PRICE_ROWS: PriceRow[] = [
  row('005930', '20250701', 70000, 70000), row('005930', '20250702', 70000, 70000), row('005930', '20250703', 77001, 77001),
  row('035420', '20250701', 30000, 30000), row('035420', '20250702', 30000, 30000), row('035420', '20250703', 27500, 27500, 27500),
  row('000660', '20250801', 50000, 50000), row('000660', '20250804', 50000, 50000), row('000660', '20250805', 55001, 55001),
];

const SIGNAL_ROWS = [
  { rcpNo: 'W1', corpCode: 'A005930', stockCode: '005930', eventType: 'SUPPLY_CONTRACT', persona: 'GROWTH', buyScore: 70, disclosure: { rcpDt: '20250701' } },
  { rcpNo: 'L1', corpCode: 'A035420', stockCode: '035420', eventType: 'SUPPLY_CONTRACT', persona: 'GROWTH', buyScore: 65, disclosure: { rcpDt: '20250701' } },
  { rcpNo: 'W2', corpCode: 'A000660', stockCode: '000660', eventType: 'SUPPLY_CONTRACT', persona: 'GROWTH', buyScore: 75, disclosure: { rcpDt: '20250801' } },
];

function makeFakePrisma() {
  const store: { run?: Record<string, unknown>; trades?: unknown[] } = {};
  const prisma = {
    tradingSignal: {
      findMany: jest.fn(async (args: { where: { disclosure: { rcpDt: { gte: string; lte: string } } } }) => {
        const { gte, lte } = args.where.disclosure.rcpDt;
        return SIGNAL_ROWS.filter((s) => s.disclosure.rcpDt >= gte && s.disclosure.rcpDt <= lte);
      }),
    },
    // DAR-486: 일별 종목상태 이력 — 이 테스트엔 이력 없음(빈 배열) → 어댑터가 플래그 미설정(false).
    stockStatusDaily: {
      findMany: jest.fn(async () => [] as unknown[]),
    },
    stockDailyPrice: {
      findMany: jest.fn(async (args: { where: { stockCode: string; tradeDate: { gte: string; lte: string } } }) =>
        PRICE_ROWS.filter(
          (r) => r.stockCode === args.where.stockCode &&
            r.tradeDate >= args.where.tradeDate.gte && r.tradeDate <= args.where.tradeDate.lte,
        ).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
      ),
      findUnique: jest.fn(async (args: { where: { stockCode_tradeDate: { stockCode: string; tradeDate: string } } }) => {
        const k = args.where.stockCode_tradeDate;
        return PRICE_ROWS.find((r) => r.stockCode === k.stockCode && r.tradeDate === k.tradeDate) ?? null;
      }),
      groupBy: jest.fn(async (args: { where: { tradeDate: { gte: string; lte: string } } }) => {
        const dates = [...new Set(
          PRICE_ROWS.filter((r) => r.tradeDate >= args.where.tradeDate.gte && r.tradeDate <= args.where.tradeDate.lte)
            .map((r) => r.tradeDate),
        )].sort();
        return dates.map((tradeDate) => ({ tradeDate }));
      }),
    },
    backtestRun: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        store.run = { id: 'run-1', ...args.data };
        return { id: 'run-1' };
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        store.run = { ...store.run, ...args.data };
        return store.run;
      }),
      findFirst: jest.fn(async () => store.run ?? null),
      findUnique: jest.fn(async () => store.run ?? null),
    },
    backtestTrade: {
      createMany: jest.fn(async (args: { data: unknown[] }) => {
        store.trades = args.data;
        return { count: args.data.length };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, store };
}

describe('BacktestReplayService.run — 신호조립→러너→영속 전 구간', () => {
  it('COMPLETED 전이 + 트랙레코드 산출 + BacktestTrade 영속(3건)', async () => {
    const { prisma, store } = makeFakePrisma();
    const service = buildService(prisma);

    const tr = await service.run({
      startDate: '2025-06-19',
      endDate: '2025-08-31',
      strategy: { exitRules: { takeProfitPct: 10, stopLossPct: -8, maxHoldDays: 20 } },
      costs: { commissionRate: 0, taxRate: 0, slippagePct: 0 },
    });

    expect(tr.status).toBe('COMPLETED');
    expect(tr.totalSignals).toBe(3);
    expect(tr.metrics.totalTrades).toBe(3);
    expect(tr.metrics.winRate).toBeCloseTo(66.67, 1);
    expect(tr.equityCurve[0].equity).toBe(10_000_000);

    // 영속 검증
    expect((prisma.backtestTrade.createMany as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(store.trades).toHaveLength(3);
    const persisted = store.trades as Array<{ disclosureRcpNo: string; buyScoreSnapshot: number }>;
    expect(persisted.map((t) => t.disclosureRcpNo).sort()).toEqual(['L1', 'W1', 'W2']);
    expect(persisted[0].buyScoreSnapshot).toBeGreaterThan(0);
    expect((store.run as { status: string }).status).toBe('COMPLETED');
  });

  it('getLatest / getById 로 저장된 트랙레코드 복원', async () => {
    const { prisma } = makeFakePrisma();
    const service = buildService(prisma);
    const created = await service.run({
      startDate: '2025-06-19',
      endDate: '2025-08-31',
      strategy: { exitRules: { takeProfitPct: 10, stopLossPct: -8, maxHoldDays: 20 } },
      costs: { commissionRate: 0, taxRate: 0, slippagePct: 0 },
    });

    const latest = await service.getLatest();
    expect(latest?.runId).toBe(created.runId);
    expect(latest?.metrics.totalTrades).toBe(created.metrics.totalTrades);

    const byId = await service.getById('run-1');
    expect(byId.metrics.winRate).toBeCloseTo(created.metrics.winRate, 5);
  });

  it('잘못된 날짜 형식 → 거부(BadRequest)', async () => {
    const { prisma } = makeFakePrisma();
    const service = buildService(prisma);
    await expect(service.run({ startDate: '2025/06/19', endDate: '2025-08-31' })).rejects.toThrow();
  });
});

// =========================================================
// DAR-390 — persistTrades null/NaN 안전성 + 가격결측 graceful + 재실행 멱등
// =========================================================

describe('DAR-390 — 수치 정규화 헬퍼(영속 안전성)', () => {
  it('isFinitePositive: 유한·양수만 true', () => {
    expect(isFinitePositive(1)).toBe(true);
    expect(isFinitePositive(0)).toBe(false);
    expect(isFinitePositive(-1)).toBe(false);
    expect(isFinitePositive(NaN)).toBe(false);
    expect(isFinitePositive(Infinity)).toBe(false);
    expect(isFinitePositive(undefined)).toBe(false);
    expect(isFinitePositive(null)).toBe(false);
  });

  it('finiteOrNull: 비유한은 null, 유한은 보존(0 포함)', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(-5)).toBe(-5);
    expect(finiteOrNull(NaN)).toBeNull();
    expect(finiteOrNull(Infinity)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
  });

  it('finiteOr: 비유한은 fallback', () => {
    expect(finiteOr(3, 0)).toBe(3);
    expect(finiteOr(NaN, 0)).toBe(0);
    expect(finiteOr(undefined, 0)).toBe(0);
  });

  it('clampReturnPct: 비유한 null·범위 초과 클램프·정상 보존', () => {
    expect(clampReturnPct(12.5)).toBe(12.5);
    expect(clampReturnPct(-8)).toBe(-8);
    expect(clampReturnPct(NaN)).toBeNull();
    // 비유한(Infinity)은 계산 폭주 → 클램프가 아니라 정직하게 null
    expect(clampReturnPct(Infinity)).toBeNull();
    expect(clampReturnPct(-Infinity)).toBeNull();
    // 유한하지만 컬럼 한계 초과 → 표현 가능 범위로 클램프
    expect(clampReturnPct(99999)).toBe(RETURN_PCT_LIMIT);
    expect(clampReturnPct(-99999)).toBe(-RETURN_PCT_LIMIT);
  });
});

describe('DAR-390 — executeReplay: 가격 0/결측 신호 graceful 제외', () => {
  const service = buildService({} as PrismaService);

  it('시가 0 종목 신호는 진입 제외(NaN/Infinity 트레이드 미생성), 정상 신호는 거래', async () => {
    const pricesWithZero: Record<string, DailyPrice[]> = {
      ...PRICES,
      // 시가 0(백필 결측/이상치) — 진입 시 0 으로 나눠 Infinity/NaN 이 되는 케이스
      '900900': [
        price('2025-07-01', 0, 0),
        price('2025-07-02', 0, 0),
        price('2025-07-03', 0, 0),
      ],
    };
    const adapter = new InMemoryPriceDataAdapter(pricesWithZero, TRADING_DAYS);
    const signals = [
      signal('W1', 'A005930', '005930', '2025-07-01'),
      signal('BAD', 'A900900', '900900', '2025-07-01'),
    ];

    const { trades } = await service.executeReplay(
      signals, adapter, STRATEGY, ZERO_COST, '2025-07-01', '2025-08-31',
    );

    // 정상 1건만, 0 종목은 제외
    expect(trades).toHaveLength(1);
    expect(trades[0].stockCode).toBe('005930');
    // 모든 트레이드 수치 유한
    for (const t of trades) {
      expect(Number.isFinite(t.entryPrice)).toBe(true);
      expect(Number.isFinite(t.entryShares)).toBe(true);
      expect(Number.isFinite(t.entryValue)).toBe(true);
      expect(t.entryPrice).toBeGreaterThan(0);
      expect(t.entryShares).toBeGreaterThan(0);
    }
  });
});

// 가격결측 종목/신호를 포함하는 가짜 Prisma
function makeFakePrismaWithZeroPrice() {
  const extraPriceRows: PriceRow[] = [
    ...PRICE_ROWS,
    // 시가 0 = 백필 이상치 (신호백필 #341 이후 재실행에서 깨지던 케이스 재현)
    { stockCode: '900900', tradeDate: '20250701', openPrice: 0, highPrice: 0, lowPrice: 0, closePrice: 0, volume: 0n },
    { stockCode: '900900', tradeDate: '20250702', openPrice: 0, highPrice: 0, lowPrice: 0, closePrice: 0, volume: 0n },
    { stockCode: '900900', tradeDate: '20250703', openPrice: 0, highPrice: 0, lowPrice: 0, closePrice: 0, volume: 0n },
  ];
  const extraSignalRows = [
    ...SIGNAL_ROWS,
    { rcpNo: 'BAD', corpCode: 'A900900', stockCode: '900900', eventType: 'SUPPLY_CONTRACT', persona: 'GROWTH', buyScore: 80, disclosure: { rcpDt: '20250701' } },
  ];

  const store: { run?: Record<string, unknown>; trades?: unknown[]; runs: Record<string, unknown>[] } = { runs: [] };
  let seq = 0;
  const prisma = {
    tradingSignal: {
      findMany: jest.fn(async (args: { where: { disclosure: { rcpDt: { gte: string; lte: string } } } }) => {
        const { gte, lte } = args.where.disclosure.rcpDt;
        return extraSignalRows.filter((s) => s.disclosure.rcpDt >= gte && s.disclosure.rcpDt <= lte);
      }),
    },
    // DAR-486: 일별 종목상태 이력 — 이 테스트엔 이력 없음(빈 배열) → 어댑터가 플래그 미설정(false).
    stockStatusDaily: {
      findMany: jest.fn(async () => [] as unknown[]),
    },
    stockDailyPrice: {
      findMany: jest.fn(async (args: { where: { stockCode: string; tradeDate: { gte: string; lte: string } } }) =>
        extraPriceRows.filter(
          (r) => r.stockCode === args.where.stockCode &&
            r.tradeDate >= args.where.tradeDate.gte && r.tradeDate <= args.where.tradeDate.lte,
        ).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
      ),
      findUnique: jest.fn(async (args: { where: { stockCode_tradeDate: { stockCode: string; tradeDate: string } } }) => {
        const k = args.where.stockCode_tradeDate;
        return extraPriceRows.find((r) => r.stockCode === k.stockCode && r.tradeDate === k.tradeDate) ?? null;
      }),
      groupBy: jest.fn(async (args: { where: { tradeDate: { gte: string; lte: string } } }) => {
        const dates = [...new Set(
          extraPriceRows.filter((r) => r.tradeDate >= args.where.tradeDate.gte && r.tradeDate <= args.where.tradeDate.lte)
            .map((r) => r.tradeDate),
        )].sort();
        return dates.map((tradeDate) => ({ tradeDate }));
      }),
    },
    backtestRun: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        seq += 1;
        const id = `run-${seq}`;
        store.run = { id, ...args.data };
        store.runs.push(store.run);
        return { id };
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        store.run = { ...store.run, ...args.data };
        return store.run;
      }),
      findFirst: jest.fn(async () => store.run ?? null),
      findUnique: jest.fn(async () => store.run ?? null),
    },
    backtestTrade: {
      createMany: jest.fn(async (args: { data: unknown[] }) => {
        store.trades = args.data;
        return { count: args.data.length };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, store };
}

describe('DAR-390 — run(): 가격결측 신호 포함해도 replay 성공 + 영속 안전 + 재실행 멱등', () => {
  it('가격 0 신호 포함 재실행 → 500 없이 COMPLETED, 정상 트레이드만 영속(NaN/Infinity 0건)', async () => {
    const { prisma, store } = makeFakePrismaWithZeroPrice();
    const service = buildService(prisma);

    const tr = await service.run({
      startDate: '2025-06-19',
      endDate: '2025-08-31',
      strategy: { exitRules: { takeProfitPct: 10, stopLossPct: -8, maxHoldDays: 20 } },
      costs: { commissionRate: 0, taxRate: 0, slippagePct: 0 },
    });

    // 200 경로: 예외 없이 COMPLETED 전이
    expect(tr.status).toBe('COMPLETED');
    expect((store.run as { status: string }).status).toBe('COMPLETED');
    // 가격 0 종목(BAD)은 트랙레코드 거래에 미포함
    const persisted = store.trades as Array<Record<string, number | string | null>>;
    expect(persisted.map((t) => t.disclosureRcpNo)).not.toContain('BAD');
    // 영속 수치 전부 유한(NaN/Infinity 0건)
    for (const t of persisted) {
      expect(Number.isFinite(t.entryPrice as number)).toBe(true);
      expect(Number.isFinite(t.entryShares as number)).toBe(true);
      expect(Number.isFinite(t.entryValue as number)).toBe(true);
      expect(t.entryPrice as number).toBeGreaterThan(0);
      expect(t.entryShares as number).toBeGreaterThan(0);
      if (t.returnPct !== null) {
        expect(Number.isFinite(t.returnPct as number)).toBe(true);
      }
    }
  });

  it('동일 구간 재실행 → 매번 신규 runId·유니크 충돌 0·COMPLETED (멱등)', async () => {
    const { prisma, store } = makeFakePrismaWithZeroPrice();
    const service = buildService(prisma);
    const input = {
      startDate: '2025-06-19',
      endDate: '2025-08-31',
      strategy: { exitRules: { takeProfitPct: 10, stopLossPct: -8, maxHoldDays: 20 } },
      costs: { commissionRate: 0, taxRate: 0, slippagePct: 0 },
    };

    const first = await service.run(input);
    const second = await service.run(input);

    expect(first.status).toBe('COMPLETED');
    expect(second.status).toBe('COMPLETED');
    // 매 실행 신규 runId (이전 run 트레이드와 FK 충돌 없음)
    expect(first.runId).not.toBe(second.runId);
    expect(store.runs.length).toBe(2);
    // createMany 가 매 실행 호출되고 throw 없음
    expect((prisma.backtestTrade.createMany as jest.Mock).mock.calls.length).toBe(2);
  });
});
