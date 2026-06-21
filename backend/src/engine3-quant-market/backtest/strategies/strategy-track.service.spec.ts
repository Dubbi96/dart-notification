import { NotFoundException } from '@nestjs/common';
import { StrategyTrackService, LOW_SAMPLE_TRADES } from './strategy-track.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { BacktestReplayService } from '../replay/backtest-replay.service';

/**
 * DAR-404 — 전략 변형 다중 트랙 비교/거래내역/갱신 서비스 단위 테스트.
 */
describe('StrategyTrackService (DAR-404)', () => {
  let prisma: any;
  let replay: jest.Mocked<Pick<BacktestReplayService, 'run'>>;
  let calendar: MarketCalendarService;
  let service: StrategyTrackService;

  function runRow(over: Record<string, unknown>) {
    return {
      id: 'run-x',
      strategyKey: 'event-edge',
      startDate: new Date(Date.UTC(2025, 5, 21)),
      endDate: new Date(Date.UTC(2026, 5, 21)),
      summary: { metrics: makeMetrics(5, 50, 1), equityCurve: [] },
      completedAt: new Date('2026-06-21T05:00:00Z'),
      ...over,
    };
  }

  function makeMetrics(totalReturn: number, winRate: number, totalTrades: number) {
    return { totalReturn, winRate, totalTrades, sharpe: 0.5, mdd: -10 };
  }

  beforeEach(() => {
    prisma = {
      backtestRun: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      backtestTrade: { findMany: jest.fn() },
      company: { findMany: jest.fn() },
    };
    replay = { run: jest.fn() } as any;
    calendar = new MarketCalendarService();
    service = new StrategyTrackService(prisma, replay as any, calendar);
  });

  describe('getComparison', () => {
    it('전략별 최신 트랙을 누적수익 내림차순으로 ranking + bestStrategy 부여', async () => {
      prisma.backtestRun.findMany.mockResolvedValue([
        runRow({ strategyKey: 'event-edge', summary: { metrics: makeMetrics(12.5, 55, 40), equityCurve: [] } }),
        runRow({ strategyKey: 'short-momentum', summary: { metrics: makeMetrics(-3.2, 30, 60), equityCurve: [] } }),
        runRow({ strategyKey: 'conservative-value', summary: { metrics: makeMetrics(8.1, 50, 25), equityCurve: [] } }),
        // aggressive-diversified 없음 → hasTrack false
      ]);

      const res = await service.getComparison();
      expect(res.strategies).toHaveLength(4);

      const ranked = res.strategies.filter((s) => s.rank != null).sort((a, b) => a.rank! - b.rank!);
      expect(ranked.map((s) => s.strategyKey)).toEqual([
        'event-edge', // +12.5
        'conservative-value', // +8.1
        'short-momentum', // -3.2
      ]);
      expect(ranked[0].bestStrategy).toBe(true);
      expect(ranked.slice(1).every((s) => !s.bestStrategy)).toBe(true);

      const missing = res.strategies.find((s) => s.strategyKey === 'aggressive-diversified')!;
      expect(missing.hasTrack).toBe(false);
      expect(missing.rank).toBeNull();
      expect(missing.bestStrategy).toBe(false);
      expect(missing.equityCurve).toEqual([]);
      expect(missing.lowSample).toBe(true);
    });

    it('표본 수가 임계 미만이면 lowSample 플래그를 켠다', async () => {
      prisma.backtestRun.findMany.mockResolvedValue([
        runRow({ strategyKey: 'event-edge', summary: { metrics: makeMetrics(5, 50, LOW_SAMPLE_TRADES - 1), equityCurve: [] } }),
        runRow({ strategyKey: 'short-momentum', summary: { metrics: makeMetrics(5, 50, LOW_SAMPLE_TRADES), equityCurve: [] } }),
      ]);
      const res = await service.getComparison();
      const ee = res.strategies.find((s) => s.strategyKey === 'event-edge')!;
      const sm = res.strategies.find((s) => s.strategyKey === 'short-momentum')!;
      expect(ee.lowSample).toBe(true);
      expect(sm.lowSample).toBe(false);
    });

    it('전략별 가장 최근 완료 run 1개만 사용한다(중복 키 중 첫 값)', async () => {
      prisma.backtestRun.findMany.mockResolvedValue([
        runRow({ id: 'new', strategyKey: 'event-edge', summary: { metrics: makeMetrics(20, 60, 30), equityCurve: [] } }),
        runRow({ id: 'old', strategyKey: 'event-edge', summary: { metrics: makeMetrics(1, 10, 30), equityCurve: [] } }),
      ]);
      const res = await service.getComparison();
      const ee = res.strategies.find((s) => s.strategyKey === 'event-edge')!;
      expect(ee.cumulativeReturnPct).toBe(20);
    });
  });

  describe('getTradeHistory', () => {
    it('알 수 없는 키는 NotFound', async () => {
      await expect(service.getTradeHistory('bogus')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('트랙이 없으면 graceful 빈 결과(게스트 데모)', async () => {
      prisma.backtestRun.findFirst.mockResolvedValue(null);
      const res = await service.getTradeHistory('event-edge');
      expect(res.hasTrack).toBe(false);
      expect(res.trades).toEqual([]);
      expect(res.totalTrades).toBe(0);
      expect(res.label).toBe('이벤트엣지');
    });

    it('트랙의 거래를 corpName 결합 + Decimal 숫자화해 최신순 반환', async () => {
      prisma.backtestRun.findFirst.mockResolvedValue({
        id: 'run-1',
        startDate: new Date(Date.UTC(2025, 5, 21)),
        endDate: new Date(Date.UTC(2026, 5, 21)),
      });
      prisma.backtestTrade.findMany.mockResolvedValue([
        {
          corpCode: 'A005930',
          stockCode: '005930',
          eventType: 'SUPPLY_CONTRACT',
          persona: 'GROWTH',
          buyScoreSnapshot: 72,
          entryDate: new Date(Date.UTC(2025, 6, 1)),
          exitDate: new Date(Date.UTC(2025, 6, 10)),
          entryPrice: { toString: () => '70000' },
          exitPrice: { toString: () => '77000' },
          returnPct: { toString: () => '9.5' },
          netPnl: { toString: () => '120000' },
          exitReason: 'TAKE_PROFIT',
          holdDays: 9,
        },
        {
          corpCode: 'B000660',
          stockCode: '000660',
          eventType: 'EARNINGS_SURPRISE',
          persona: 'MOMENTUM',
          buyScoreSnapshot: null,
          entryDate: new Date(Date.UTC(2025, 6, 5)),
          exitDate: null,
          entryPrice: { toString: () => '120000' },
          exitPrice: null,
          returnPct: null,
          netPnl: null,
          exitReason: null,
          holdDays: null,
        },
      ]);
      prisma.company.findMany.mockResolvedValue([
        { corpCode: 'A005930', corpName: '삼성전자' },
        // B000660 회사명 결측 → corpCode 폴백
      ]);

      const res = await service.getTradeHistory('event-edge');
      expect(res.hasTrack).toBe(true);
      expect(res.runId).toBe('run-1');
      expect(res.totalTrades).toBe(2);

      const [t0, t1] = res.trades;
      expect(t0.corpName).toBe('삼성전자');
      expect(t0.entryPrice).toBe(70000);
      expect(t0.returnPct).toBe(9.5);
      expect(t0.exitReason).toBe('TAKE_PROFIT');
      expect(t0.entryDate).toBe('2025-07-01');
      expect(t0.exitDate).toBe('2025-07-10');

      expect(t1.corpName).toBe('B000660'); // 회사명 결측 폴백
      expect(t1.exitPrice).toBeNull();
      expect(t1.returnPct).toBeNull();
      expect(t1.exitDate).toBeNull();

      // 최신순 정렬을 prisma orderBy 로 위임 — entryDate desc, createdAt desc
      expect(prisma.backtestTrade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { backtestRunId: 'run-1' },
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });
  });

  describe('refreshAll', () => {
    it('4 프리셋을 각각 리플레이 실행하고 직전 트랙을 정리(멱등)', async () => {
      replay.run.mockImplementation(async (input: any) => ({
        runId: `run-${input.strategyKey}`,
        metrics: makeMetrics(5, 50, 30),
      }) as any);
      prisma.backtestRun.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.refreshAll({ startDate: '2025-06-21', endDate: '2026-06-21' });

      expect(replay.run).toHaveBeenCalledTimes(4);
      // 전략 키 + 윈도가 그대로 전달되는지
      expect(replay.run).toHaveBeenCalledWith(
        expect.objectContaining({ strategyKey: 'event-edge', startDate: '2025-06-21', endDate: '2026-06-21' }),
      );
      // 멱등 정리: 새 run 제외하고 동일 키 삭제
      expect(prisma.backtestRun.deleteMany).toHaveBeenCalledWith({
        where: { strategyKey: 'event-edge', id: { not: 'run-event-edge' } },
      });
      expect(res.results).toHaveLength(4);
      expect(res.results.every((r) => r.status === 'COMPLETED')).toBe(true);
    });

    it('한 전략이 실패해도 나머지는 계속 진행(부분 성공)', async () => {
      replay.run.mockImplementation(async (input: any) => {
        if (input.strategyKey === 'short-momentum') throw new Error('가격 데이터 없음');
        return { runId: `run-${input.strategyKey}`, metrics: makeMetrics(5, 50, 30) } as any;
      });

      const res = await service.refreshAll({ startDate: '2025-06-21', endDate: '2026-06-21' });
      expect(res.results).toHaveLength(4);
      const failed = res.results.find((r) => r.strategyKey === 'short-momentum')!;
      expect(failed.status).toBe('FAILED');
      expect(failed.error).toContain('가격 데이터 없음');
      expect(res.results.filter((r) => r.status === 'COMPLETED')).toHaveLength(3);
    });
  });
});
