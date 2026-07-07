/**
 * strategy-forward-simulation.service.spec.ts — 전략 4종 forward 운용·집계 검증 (live-readiness W1)
 *
 * 결정론적 mock(prisma/paperTrade/eventEdgeSelector)으로:
 *  - 진입 필터: preset.minBuyScore·eventTypes allowlist·isBackfill=false 라이브 한정이 쿼리에 반영되는지
 *  - 사이징: EQUAL/SCORE_WEIGHT 프리셋 예산이 Risk envelope(가상원금×maxSinglePositionPct) 이내인지
 *  - 청산 파라미터: preset.exitRules(익절/손절/최대보유)가 Position 에 대입되는지(부호 정규화 포함)
 *  - do-no-harm: event-edge allowlist 가 비면 진입 0 유지(정직) — 신호 조회·주문 0
 *  - 당일 1회 해석: runDailyCycleAllStrategies 가 EventEdgeSelector 를 사이클당 1번만 호출
 *  - 집계 비교: 전략별 자산곡선·성적표 분리 + 누적수익률 랭킹(getStyleComparison 패턴)
 * 을 고정한다. ★ 실주문/AI 미개입(모의 + 순수 Rule).
 */
import {
  StrategyForwardSimulationService,
  strategyStyleTag,
  strategyForwardPortfolioName,
  presetExitParams,
  strategyEntryBudget,
  StrategyCycleResult,
} from './strategy-forward-simulation.service';
import {
  STRATEGY_PRESETS,
  findPreset,
} from '../../engine3-quant-market/backtest/strategies/strategy-presets';

/** key → portfolioId */
const pfId = (key: string) => `pf-${key}`;

const EVENT_EDGE = findPreset('event-edge')!;
const SHORT_MOMENTUM = findPreset('short-momentum')!;
const CONSERVATIVE = findPreset('conservative-value')!;
const AGGRESSIVE = findPreset('aggressive-diversified')!;

describe('StrategyForwardSimulationService (live-readiness W1)', () => {
  describe('순수 Rule 헬퍼', () => {
    it('strategy:<key> 태그·포트폴리오 이름 네임스페이스를 고정한다', () => {
      expect(strategyStyleTag('event-edge')).toBe('strategy:event-edge');
      expect(strategyForwardPortfolioName('event-edge')).toBe(
        '모의운용 포트폴리오 [strategy:event-edge]',
      );
    });

    it('presetExitParams — exitRules 를 Position 파라미터로 대입(손절 부호 정규화)', () => {
      expect(presetExitParams(EVENT_EDGE)).toEqual({
        stopLossPct: 10, // preset -10 → abs
        takeProfitPct: 20,
        maxHoldDays: 20,
      });
      expect(presetExitParams(SHORT_MOMENTUM)).toEqual({
        stopLossPct: 5,
        takeProfitPct: 10,
        maxHoldDays: 5,
      });
    });

    it('strategyEntryBudget — EQUAL_WEIGHT 는 균등배분(점수 무관)', () => {
      // aggressive-diversified: 10M / 50 = 200,000 (envelope 1M 이내)
      expect(strategyEntryBudget(AGGRESSIVE.params, 30, 10)).toBe(200_000);
      expect(strategyEntryBudget(AGGRESSIVE.params, 95, 10)).toBe(200_000);
    });

    it('strategyEntryBudget — SCORE_WEIGHT 가중이 Risk envelope 를 넘지 못한다(하드룰 보존)', () => {
      // conservative-value: 10M/10 × 1.5(score 100) = 1.5M → envelope 1M(10%) 절단
      expect(strategyEntryBudget(CONSERVATIVE.params, 100, 10)).toBe(1_000_000);
      // event-edge: 10M/20 × 1.0(score 50) = 500,000 (envelope 이내 그대로)
      expect(strategyEntryBudget(EVENT_EDGE.params, 50, 10)).toBe(500_000);
    });
  });

  describe('진입(프리셋 필터·사이징) — 개장 체결 정렬: PENDING 예약 생성', () => {
    /** 예약 entryDate 규약 — 20260702(목) 다음 거래일 = 20260703(금) KST 자정. */
    const NEXT_OPEN_KST = new Date('2026-07-03T00:00:00+09:00');

    function buildEntryService(openRows: Array<Record<string, unknown>> = []) {
      const createdPositions: Record<string, unknown>[] = [];
      const reservations: Record<string, unknown>[] = [];
      const prisma = {
        position: {
          // OPEN(corpCode+entryAmount)·CLOSED(현금 산정) 분기.
          findMany: jest.fn(({ where }: { where: { status: string } }) =>
            Promise.resolve(where.status === 'OPEN' ? openRows : []),
          ),
          create: jest.fn((args: { data: Record<string, unknown> }) => {
            createdPositions.push(args.data);
            return Promise.resolve({});
          }),
        },
        tradingSignal: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sig1', corpCode: 'A', stockCode: '000A', signal: 'WATCH', buyScore: 45 },
          ]),
        },
        positionThesis: { findUnique: jest.fn().mockResolvedValue(null) },
        stockDailyPrice: {
          findFirst: jest.fn().mockResolvedValue({
            openPrice: 1000,
            highPrice: 1000,
            lowPrice: 1000,
            closePrice: 1000,
            volume: 100,
          }),
        },
        paperTrade: {
          // 미체결 예약(PENDING) 조회 — 없음.
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn((args: { data: Record<string, unknown> }) => {
            reservations.push(args.data);
            return Promise.resolve({ id: `pt${reservations.length}` });
          }),
        },
      };
      const paperTrade = {
        placeOrder: jest
          .fn()
          .mockResolvedValue({ id: 't1', filledShares: 500, filledPrice: 1000 }),
      };
      const selector = { selectPositiveEdgeEventTypes: jest.fn() };
      const service = new StrategyForwardSimulationService(
        prisma as never,
        paperTrade as never,
        selector as never,
      );
      const open = (preset: typeof EVENT_EDGE, allowlist: string[] | null) =>
        (
          service as never as {
            openStrategyPositions: (
              p: typeof EVENT_EDGE,
              pf: { id: string; maxSinglePositionPct: number },
              tradeDate: string,
              gated: string[] | null,
            ) => Promise<{ reserved: number; allowlistEmpty: boolean }>;
          }
        ).openStrategyPositions(
          preset,
          { id: pfId(preset.key), maxSinglePositionPct: 10 },
          '20260702',
          allowlist,
        );
      return { service, prisma, paperTrade, createdPositions, reservations, open };
    }

    it('minBuyScore·라이브(isBackfill=false) 필터가 쿼리에 반영되고 PENDING 예약을 만든다', async () => {
      const { prisma, paperTrade, createdPositions, reservations, open } = buildEntryService();
      const result = await open(SHORT_MOMENTUM, null);

      expect(result).toEqual({ reserved: 1, allowlistEmpty: false });
      const where = prisma.tradingSignal.findMany.mock.calls[0][0].where;
      expect(where.buyScore).toEqual({ gte: 40 }); // short-momentum minBuyScore
      expect(where.disclosure).toEqual({ isBackfill: false });
      expect(where.eventType).toBeUndefined(); // 정적 allowlist 미지정 → 전 이벤트

      // ★개장 체결 정렬: 즉시 체결(placeOrder)·Position 생성 없음 — 예약만. exit 파라미터는
      //   체결기가 프리셋 exitRules 로 대입(exitParamsForStyleTag — 예약엔 미저장).
      expect(paperTrade.placeOrder).not.toHaveBeenCalled();
      expect(createdPositions).toHaveLength(0);
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toEqual(
        expect.objectContaining({
          corpCode: 'A',
          stockCode: '000A',
          direction: 'BUY',
          status: 'PENDING',
          // strategy:<key> 네임스페이스 — 예약 시점부터 태깅(체결기 식별 축).
          styleTag: 'strategy:short-momentum',
          // EQUAL_WEIGHT 결정 시점 사이징: 10M/20 = 500,000 → price 1000 → 500주.
          orderedShares: 500,
          filledShares: 0,
          entryPrice: 1000,
          expectedPrice: 1000,
        }),
      );
      // entryDate = 다음 거래일(20260702 목 → 20260703 금) KST 자정.
      expect((reservations[0].entryDate as Date).getTime()).toBe(NEXT_OPEN_KST.getTime());
    });

    it('event-edge allowlist 는 eventType IN 필터로 주입된다(당일 해석분)', async () => {
      const { prisma, open } = buildEntryService();
      await open(EVENT_EDGE, ['SUPPLY_CONTRACT', 'BUYBACK']);
      const where = prisma.tradingSignal.findMany.mock.calls[0][0].where;
      expect(where.buyScore).toEqual({ gte: 35 }); // event-edge minBuyScore
      expect(where.eventType).toEqual({ in: ['SUPPLY_CONTRACT', 'BUYBACK'] });
    });

    it('event-edge allowlist 가 비면 진입 0 유지(do-no-harm) — 신호 조회·예약 0', async () => {
      const { prisma, paperTrade, reservations, open } = buildEntryService();
      const result = await open(EVENT_EDGE, []);
      expect(result).toEqual({ reserved: 0, allowlistEmpty: true });
      expect(prisma.tradingSignal.findMany).not.toHaveBeenCalled();
      expect(paperTrade.placeOrder).not.toHaveBeenCalled();
      expect(reservations).toHaveLength(0);
    });

    it('보유+예약이 maxPositions 에 달하면 신규 예약 0(신호 조회 생략)', async () => {
      const openRows = Array.from({ length: SHORT_MOMENTUM.params.maxPositions }, (_, i) => ({
        corpCode: `c${i}`,
        entryAmount: 500_000,
      }));
      const { prisma, paperTrade, open } = buildEntryService(openRows);
      const result = await open(SHORT_MOMENTUM, null);
      expect(result).toEqual({ reserved: 0, allowlistEmpty: false });
      expect(prisma.tradingSignal.findMany).not.toHaveBeenCalled();
      expect(paperTrade.placeOrder).not.toHaveBeenCalled();
    });
  });

  describe('runStrategyCycle — 사이클 서두 개장 체결 폴백(일반화된 fillPendingEntries 소비)', () => {
    type PrivateCycleApi = {
      openStrategyPositions: (
        ...a: never[]
      ) => Promise<{ reserved: number; allowlistEmpty: boolean }>;
      snapshotOpenPositions: (...a: never[]) => Promise<number>;
      evaluateExits: (...a: never[]) => Promise<number>;
      computeEquity: (...a: never[]) => Promise<{ equity: number; openPositions: number }>;
      saveStrategySnapshot: (...a: never[]) => Promise<void>;
    };

    it('fillPendingEntries 를 strategy:<key> 네임스페이스로 예약보다 먼저 1회 호출한다', async () => {
      const paperSim = { fillPendingEntries: jest.fn().mockResolvedValue(2) };
      const service = new StrategyForwardSimulationService(
        {} as never,
        {} as never,
        {} as never,
        undefined,
        paperSim as never,
      );
      jest
        .spyOn(service, 'getOrCreateStrategyPortfolio')
        .mockResolvedValue({ id: pfId('short-momentum'), maxSinglePositionPct: 10 });
      const priv = service as unknown as PrivateCycleApi;
      const openSpy = jest
        .spyOn(priv, 'openStrategyPositions')
        .mockResolvedValue({ reserved: 1, allowlistEmpty: false });
      jest.spyOn(priv, 'snapshotOpenPositions').mockResolvedValue(1);
      jest.spyOn(priv, 'evaluateExits').mockResolvedValue(0);
      jest.spyOn(priv, 'computeEquity').mockResolvedValue({ equity: 10_000_000, openPositions: 1 });
      jest.spyOn(priv, 'saveStrategySnapshot').mockResolvedValue(undefined);

      const result = await service.runStrategyCycle(SHORT_MOMENTUM, '20260706', null);

      expect(paperSim.fillPendingEntries).toHaveBeenCalledTimes(1);
      expect(paperSim.fillPendingEntries).toHaveBeenCalledWith(
        pfId('short-momentum'),
        '20260706',
        { styleTag: 'strategy:short-momentum', initialCapital: 10_000_000 },
      );
      // 폴백 체결이 신규 예약보다 먼저(전일 예약 소진 후 슬롯 산정).
      expect(paperSim.fillPendingEntries.mock.invocationCallOrder[0]).toBeLessThan(
        openSpy.mock.invocationCallOrder[0],
      );
      expect(result.bought).toBe(2);
      expect(result.reserved).toBe(1);
    });
  });

  describe('runDailyCycleAllStrategies (당일 1회 allowlist 해석)', () => {
    function buildCycleService() {
      const selector = {
        selectPositiveEdgeEventTypes: jest
          .fn()
          .mockResolvedValue({ eventTypes: ['SUPPLY_CONTRACT'], evaluated: [] }),
      };
      const service = new StrategyForwardSimulationService(
        {} as never,
        {} as never,
        selector as never,
      );
      const cycleSpy = jest
        .spyOn(service, 'runStrategyCycle')
        .mockImplementation(async (preset): Promise<StrategyCycleResult> => ({
          strategyKey: preset.key,
          portfolioId: pfId(preset.key),
          bought: 0,
          reserved: 0,
          snapshotted: 1,
          exited: 0,
          openPositions: 1,
          equity: 10_000_000,
        }));
      return { service, selector, cycleSpy };
    }

    it('EventEdgeSelector 를 사이클당 1회만 해석하고 4개 전략을 모두 운용한다', async () => {
      const { service, selector, cycleSpy } = buildCycleService();
      const result = await service.runDailyCycleAllStrategies('20260702');

      expect(selector.selectPositiveEdgeEventTypes).toHaveBeenCalledTimes(1);
      expect(cycleSpy).toHaveBeenCalledTimes(STRATEGY_PRESETS.length);
      // gated 전략(event-edge)엔 해석 allowlist, 비게이트 전략엔 동일 인자 전달(내부에서 무시)
      expect(cycleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'event-edge' }),
        '20260702',
        ['SUPPLY_CONTRACT'],
      );
      expect(result.tradeDate).toBe('20260702');
      expect(result.strategies.map((s) => s.strategyKey)).toEqual(
        STRATEGY_PRESETS.map((p) => p.key),
      );
    });

    it('겹침 락 — 진행 중이면 스킵(빈 결과)', async () => {
      const { service, selector } = buildCycleService();
      (service as never as { isRunning: boolean }).isRunning = true;
      const result = await service.runDailyCycleAllStrategies('20260702');
      expect(result.strategies).toEqual([]);
      expect(selector.selectPositiveEdgeEventTypes).not.toHaveBeenCalled();
    });
  });

  describe('getStrategyForwardComparison (분리 집계 + 랭킹)', () => {
    /** 전략별 CLOSED 포지션(pnl) 생성 */
    function closedPositions(n: number, pnlEach: number) {
      return Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        corpCode: `c${i}`,
        stockCode: `s${i}`,
        status: 'CLOSED',
        entryDate: new Date('2026-07-01T00:00:00Z'),
        entryPrice: 1000,
        quantity: 10,
        closedAt: new Date('2026-07-02T00:00:00Z'),
        unrealizedPnl: pnlEach,
        unrealizedPnlPct: (pnlEach / 10000) * 100,
        stopLossPct: 10,
        takeProfitPct: 20,
        maxHoldDays: 20,
      }));
    }

    const CLOSED: Record<string, ReturnType<typeof closedPositions>> = {
      [pfId('event-edge')]: closedPositions(6, 100_000), // +600k → 6.0%
      [pfId('short-momentum')]: closedPositions(8, 150_000), // +1.2M → 12.0% (최고)
      [pfId('conservative-value')]: closedPositions(3, -100_000), // -300k → -3.0% (lowSample)
      [pfId('aggressive-diversified')]: [], // 표본 0
    };
    const SNAPS: Record<string, { snapshotDate: string; totalValue: number }[]> = {
      [pfId('event-edge')]: [
        { snapshotDate: '20260701', totalValue: 10_000_000 },
        { snapshotDate: '20260702', totalValue: 10_600_000 },
      ],
      [pfId('short-momentum')]: [{ snapshotDate: '20260702', totalValue: 11_200_000 }],
      [pfId('conservative-value')]: [],
      [pfId('aggressive-diversified')]: [],
    };

    function buildService() {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
        portfolio: {
          findFirst: jest.fn(({ where }: { where: { name: string } }) => {
            const key = where.name.match(/\[strategy:([\w-]+)\]/)?.[1] ?? '';
            return Promise.resolve({ id: pfId(key), maxSinglePositionPct: 10 });
          }),
          create: jest.fn(),
        },
        portfolioRiskSnapshot: {
          findMany: jest.fn(({ where }: { where: { portfolioId: string } }) =>
            Promise.resolve(SNAPS[where.portfolioId] ?? []),
          ),
        },
        position: {
          findMany: jest.fn(({ where }: { where: { portfolioId: string; status: string } }) =>
            Promise.resolve(where.status === 'CLOSED' ? CLOSED[where.portfolioId] ?? [] : []),
          ),
          count: jest.fn(() => Promise.resolve(0)),
        },
      };
      const service = new StrategyForwardSimulationService(
        prisma as never,
        {} as never,
        {} as never,
      );
      return { service, prisma };
    }

    it('4개 전략을 분리 집계하고 표본 우선 + 누적수익률로 랭킹한다', async () => {
      const { service } = buildService();
      const cmp = await service.getStrategyForwardComparison();

      expect(cmp.strategies).toHaveLength(4);
      expect(cmp.strategies.map((s) => s.key)).toEqual(STRATEGY_PRESETS.map((p) => p.key));

      const edge = cmp.strategies.find((s) => s.key === 'event-edge')!;
      expect(edge.scorecard.cumulativeReturnPct).toBe(6);
      expect(edge.scorecard.sampleSize).toBe(6);
      expect(edge.lowSample).toBe(false);
      expect(edge.equityCurve.length).toBeGreaterThanOrEqual(2);
      expect(edge.label).toBe('이벤트엣지');
      expect(edge.rules.entry).toContain('매수점수 ≥35');

      const cons = cmp.strategies.find((s) => s.key === 'conservative-value')!;
      expect(cons.scorecard.cumulativeReturnPct).toBe(-3);
      expect(cons.lowSample).toBe(true); // 3 < 5

      const aggr = cmp.strategies.find((s) => s.key === 'aggressive-diversified')!;
      expect(aggr.scorecard.sampleSize).toBe(0);
      expect(aggr.equityCurve).toEqual([]);
      expect(aggr.latestSnapshotDate).toBeNull();

      // 랭킹: 표본 있는 전략 먼저(수익 내림차순) → 무표본 후순위
      expect(cmp.ranking.ranking).toEqual([
        'short-momentum',
        'event-edge',
        'conservative-value',
        'aggressive-diversified',
      ]);
      expect(cmp.ranking.bestKey).toBe('short-momentum');
      expect(cmp.ranking.allLowSample).toBe(false);
      expect(cmp.lowSampleThreshold).toBe(5);
      expect(cmp.initialCapital).toBe(10_000_000);
    });
  });
});
