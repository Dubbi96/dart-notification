/**
 * DAR-485 — ParameterSweepService 통합 테스트(견고화 W3·P24)
 *
 * A. 오케스트레이션 배선(mock executeReplay): 그리드 실행 횟수·신호 1회 조립(최저 minBuyScore)·
 *    축 파라미터 정확성·프리셋 검증·날짜 검증·robustEventGate eventTypes 주입.
 * B. 러너 재사용 실증(real BacktestRunnerService + InMemory 어댑터): 이웃 파라미터(minBuyScore)가
 *    실제 러너 출력(거래수)을 바꾼다 → 측정 표면이 결정론적으로 동작함.
 */
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ParameterSweepService } from './parameter-sweep.service';
import { BacktestSignalAssemblyService } from '../replay/backtest-signal-assembly.service';
import { BacktestReplayService } from '../replay/backtest-replay.service';
import { EventEdgeSelectorService } from './event-edge-selector.service';
import { BacktestRunnerService } from '../backtest-runner.service';
import { PerformanceCalculatorService } from '../metrics/performance-calculator.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { PriceConstraintService } from '../constraint/price-constraint.service';
import { InMemoryPriceDataAdapter } from '../ports/in-memory-price-data.adapter';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DisclosureSignal,
  DailyPrice,
  StrategyParams,
  PerformanceMetrics,
  BacktestCostParams,
} from '../ports/backtest.types';
import { findPreset } from './strategy-presets';

const calendar = new MarketCalendarService();
const constraint = new PriceConstraintService();
const performance = new PerformanceCalculatorService(calendar);

function fakeMetrics(over: Partial<PerformanceMetrics>): PerformanceMetrics {
  return {
    totalReturn: 0,
    annualizedReturn: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    mdd: 0,
    sharpe: 0,
    totalTrades: 0,
    wonTrades: 0,
    lostTrades: 0,
    avgHoldDays: 0,
    monthlyReturns: {},
    byEventType: {},
    byPersona: {},
    worstTrades: [],
    realWorldGate: {} as PerformanceMetrics['realWorldGate'],
    passedGate: false,
    ...over,
  };
}

type ExecArgs = [DisclosureSignal[], unknown, StrategyParams, BacktestCostParams, string, string];

function buildService(overrides?: {
  assemble?: jest.Mock;
  executeReplay?: jest.Mock;
  selectEdges?: jest.Mock;
}) {
  const assemble = overrides?.assemble ?? jest.fn().mockResolvedValue([]);
  const executeReplay =
    overrides?.executeReplay ??
    jest.fn().mockResolvedValue({ trades: [], metrics: fakeMetrics({ totalTrades: 30 }), equityCurve: [] });
  const selectEdges =
    overrides?.selectEdges ?? jest.fn().mockResolvedValue({ eventTypes: ['SUPPLY_CONTRACT'], evaluated: [] });

  const assembly = { assemble } as unknown as BacktestSignalAssemblyService;
  const replay = { executeReplay } as unknown as BacktestReplayService;
  const selector = {
    selectPositiveEdgeEventTypes: selectEdges,
  } as unknown as EventEdgeSelectorService;

  const service = new ParameterSweepService(
    {} as PrismaService,
    assembly,
    replay,
    selector,
  );
  return { service, assemble, executeReplay, selectEdges };
}

describe('ParameterSweepService — 오케스트레이션 배선', () => {
  const WINDOW = { startDate: '2025-06-19', endDate: '2026-06-19' };

  it('그리드 9개 파라미터 집합을 모두 실행(baseline + 4축×2)', async () => {
    // aggressive-diversified: 손절 -8·익절 +20·보유 20·점수 30 → 4축 이웃 clamp 충돌 없음 → 9개
    const totalReturnFor = (p: StrategyParams) => 20 + (p.exitRules.takeProfitPct - 20) * 2;
    const executeReplay = jest.fn().mockImplementation((...args: ExecArgs) => {
      const strategy = args[2];
      return Promise.resolve({
        trades: [],
        metrics: fakeMetrics({ totalReturn: totalReturnFor(strategy), totalTrades: 30 }),
        equityCurve: [],
      });
    });
    const { service } = buildService({ executeReplay });

    const report = await service.run({ presetKey: 'aggressive-diversified', ...WINDOW });

    expect(executeReplay).toHaveBeenCalledTimes(9);
    expect(report.gridSize).toBe(9);
    // takeProfit 축만 흔들리게 설계 → SENSITIVE, 나머지 STABLE, overall SENSITIVE
    expect(report.overallVerdict).toBe('SENSITIVE');
    expect(report.mostSensitiveAxisKey).toBe('takeProfit');
    expect(report.baselineTrades).toBe(30);
  });

  it('신호는 그리드 최저 minBuyScore 로 1회만 조립(점수 30 → 25)', async () => {
    const { service, assemble } = buildService();
    await service.run({ presetKey: 'aggressive-diversified', ...WINDOW });
    expect(assemble).toHaveBeenCalledTimes(1);
    expect(assemble).toHaveBeenCalledWith('2025-06-19', '2026-06-19', {
      minBuyScore: 25,
      personas: undefined,
    });
  });

  it('각 축 이웃의 파라미터가 러너에 정확히 전달된다', async () => {
    const { service, executeReplay } = buildService();
    await service.run({ presetKey: 'aggressive-diversified', ...WINDOW });
    const passedStrategies = (executeReplay.mock.calls as ExecArgs[]).map((c) => c[2]);

    const stopLosses = passedStrategies.map((s) => s.exitRules.stopLossPct);
    const takeProfits = passedStrategies.map((s) => s.exitRules.takeProfitPct);
    const holdDays = passedStrategies.map((s) => s.exitRules.maxHoldDays);
    const minScores = passedStrategies.map((s) => s.minBuyScore);

    // baseline(-8) + 이웃(-10,-6)
    expect(stopLosses).toEqual(expect.arrayContaining([-8, -10, -6]));
    // baseline(20) + 이웃(15,25)
    expect(takeProfits).toEqual(expect.arrayContaining([20, 15, 25]));
    // baseline(20) + 이웃(15,25)
    expect(holdDays).toEqual(expect.arrayContaining([20, 15, 25]));
    // baseline(30) + 이웃(25,35)
    expect(minScores).toEqual(expect.arrayContaining([30, 25, 35]));
  });

  it('robustEventGate 프리셋(event-edge)은 selector eventTypes 를 base 에 주입', async () => {
    const selectEdges = jest.fn().mockResolvedValue({ eventTypes: ['CONTRACT', 'PATENT'], evaluated: [] });
    const { service, executeReplay, selectEdges: sel } = buildService({ selectEdges });
    await service.run({ presetKey: 'event-edge', ...WINDOW });
    expect(sel).toHaveBeenCalledTimes(1);
    const passed = (executeReplay.mock.calls as ExecArgs[]).map((c) => c[2]);
    // 전 그리드 점이 동일 eventTypes allowlist 를 상속
    expect(passed.every((s) => JSON.stringify(s.eventTypes) === JSON.stringify(['CONTRACT', 'PATENT']))).toBe(true);
  });

  it('게이트 없는 프리셋은 selector 를 호출하지 않는다', async () => {
    const { service, selectEdges } = buildService();
    await service.run({ presetKey: 'aggressive-diversified', ...WINDOW });
    expect(selectEdges).not.toHaveBeenCalled();
  });

  it('알 수 없는 프리셋 키 → NotFoundException', async () => {
    const { service } = buildService();
    await expect(service.run({ presetKey: 'nope', ...WINDOW })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('잘못된 날짜 형식·역전 → BadRequestException', async () => {
    const { service } = buildService();
    await expect(
      service.run({ presetKey: 'aggressive-diversified', startDate: '2025/06/19', endDate: '2026-06-19' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.run({ presetKey: 'aggressive-diversified', startDate: '2026-06-19', endDate: '2025-06-19' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── B. 러너 재사용 실증(real runner + InMemory) ───────────────────────────────
function price(date: string, open: number, close: number): DailyPrice {
  return { date, open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, close, volume: 100000 };
}

const TRADING_DAYS = ['2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06'];

// 4종목: 03-04 진입(다음 거래일 시가) → 03-05 +25% 익절(TP+20). buyScore 38 2종·32 2종.
const winPath = (code: string): [string, DailyPrice[]] => [
  code,
  [
    price('2025-03-04', 10000, 10000),
    price('2025-03-05', 12500, 12500),
    price('2025-03-06', 12500, 12500),
  ],
];
const PRICES: Record<string, DailyPrice[]> = Object.fromEntries([
  winPath('001'),
  winPath('002'),
  winPath('003'),
  winPath('004'),
]);

function sig(rcpNo: string, code: string, buyScore: number): DisclosureSignal {
  return {
    rcpNo,
    corpCode: `A${code}`,
    stockCode: code,
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore,
    disclosureAt: new Date('2025-03-03T10:00:00+09:00'),
  };
}

describe('ParameterSweepService — in-flight 가드(DAR-489)', () => {
  const WINDOW = { startDate: '2025-06-19', endDate: '2026-06-19' };

  function blockedReplay() {
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const executeReplay = jest.fn().mockImplementation(async () => {
      await blocked;
      return { trades: [], metrics: fakeMetrics({ totalTrades: 30 }), equityCurve: [] };
    });
    return { executeReplay, release: () => release() };
  }

  it('동일 프리셋 동시 실행 → 두 번째는 ConflictException(409) 즉시 거절', async () => {
    const { executeReplay, release } = blockedReplay();
    const { service } = buildService({ executeReplay });

    const first = service.run({ presetKey: 'aggressive-diversified', ...WINDOW });
    await expect(
      service.run({ presetKey: 'aggressive-diversified', ...WINDOW }),
    ).rejects.toBeInstanceOf(ConflictException);

    release();
    await expect(first).resolves.toBeDefined();
  });

  it('다른 프리셋은 병렬 허용(프리셋 키 단위 가드)', async () => {
    const { executeReplay, release } = blockedReplay();
    const { service } = buildService({ executeReplay });

    const a = service.run({ presetKey: 'aggressive-diversified', ...WINDOW });
    const b = service.run({ presetKey: 'short-momentum', ...WINDOW });

    release();
    await expect(a).resolves.toBeDefined();
    await expect(b).resolves.toBeDefined();
  });

  it('완료·실패 모두 가드 해제 — 실패 직후 재실행 허용', async () => {
    const executeReplay = jest
      .fn()
      .mockRejectedValueOnce(new Error('replay boom'))
      .mockResolvedValue({ trades: [], metrics: fakeMetrics({ totalTrades: 30 }), equityCurve: [] });
    const { service } = buildService({ executeReplay });

    await expect(service.run({ presetKey: 'aggressive-diversified', ...WINDOW })).rejects.toThrow(
      'replay boom',
    );
    await expect(
      service.run({ presetKey: 'aggressive-diversified', ...WINDOW }),
    ).resolves.toBeDefined();
  });
});

describe('ParameterSweepService — 러너 재사용 실증(결정론)', () => {
  it('minBuyScore 이웃(35)이 실제 러너에서 저점수 신호를 걸러 거래수를 줄인다', async () => {
    const adapter = new InMemoryPriceDataAdapter(PRICES, TRADING_DAYS);
    // executeReplay 를 진짜 러너 + 성과계산으로 구현(InMemory 어댑터). backtest-runner.service.ts 재사용.
    const executeReplay = jest
      .fn()
      .mockImplementation(async (...args: ExecArgs) => {
        const [signals, , strategy, costs, s, e] = args;
        const runner = new BacktestRunnerService(adapter, calendar, constraint);
        const trades = await runner.run(signals, strategy, costs, s, e);
        const metrics = performance.calculate(trades, strategy.initialCapital, s, e);
        return { trades, metrics, equityCurve: [] };
      });

    // 신호: score 38 2건(항상 통과)·32 2건(점수 35 이웃에서 탈락)
    const signals = [sig('W1', '001', 38), sig('W2', '002', 38), sig('L1', '003', 32), sig('L2', '004', 32)];
    const assemble = jest.fn().mockResolvedValue(signals);

    const { service } = buildService({ executeReplay, assemble });

    const report = await service.run({
      presetKey: 'aggressive-diversified', // minBuyScore 30 → 이웃 25/35
      startDate: '2025-03-03',
      endDate: '2025-03-06',
    });

    // baseline(점수 30): 4건 진입·전부 익절 청산
    expect(report.baselineTrades).toBe(4);
    expect(report.baseline.totalReturn).toBeGreaterThan(0);

    const scoreAxis = report.axes.find((a) => a.axisKey === 'minBuyScore')!;
    const tradesRow = scoreAxis.metrics.find((m) => m.metric === 'totalTrades')!;
    expect(tradesRow.baseline).toBe(4);
    // 점수 35 이웃: score 32 2건 탈락 → 2건
    expect(tradesRow.up).toBe(2);
    // 점수 25 이웃: 전부 통과 → 4건(변화 없음)
    expect(tradesRow.down).toBe(4);

    // 표본 4건 < 임계(20) → 판정은 보류(LOW_SAMPLE)지만 측정 표면은 이웃 차이를 정확히 포착
    expect(report.overallVerdict).toBe('LOW_SAMPLE');
    // 러너가 실제로 돌아 baseline 성과가 산출됨(익절 +25% 근방)
    expect(findPreset('aggressive-diversified')!.params.minBuyScore).toBe(30);
  });
});
