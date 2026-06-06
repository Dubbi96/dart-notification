/**
 * philosophy-style-simulation.service.spec.ts — 스타일 분기 운용·집계 검증 (DAR-76, P-D)
 *
 * 결정론적 mock(prisma/paperTrade/philosophyFit/graduation)으로:
 *  - 진입 분기: 적합도 적격 종목만 스타일 포트폴리오에 진입하고 styleTag 로 태깅하는지
 *  - 집계 비교: 스타일별 자산곡선·성적표·졸업지표 분리 + 누적수익률 랭킹
 *  - 졸업지표 요약 매핑(summarizeGraduation)
 * 을 고정한다. ★ 실주문/AI 미개입(모의 + Rule).
 */
import {
  PhilosophyStyleSimulationService,
  summarizeGraduation,
} from './philosophy-style-simulation.service';

/** style → portfolioId */
const pfId = (style: string) => `pf-${style}`;

function makeGraduation(pfIdArg: string, sharpe: number | null, hitRatePct: number) {
  return {
    portfolioId: pfIdArg,
    asOf: '2026-06-06T00:00:00.000Z',
    hitRate: { evaluated: 6, hits: 4, hitRatePct },
    cumulativeReturn: { initialCapital: 10_000_000, currentValue: 10_500_000, absolutePnl: 500_000, returnPct: 5 },
    aiCostEfficiency: { aiCostKrw: 0, netPnlKrw: 0, netPnlAfterAiCost: 0, aiCostToNetPnlRatio: -1 },
    exitAccuracy: { evaluated: 3, correct: 2, accuracyPct: 66.7 },
    riskAdjusted: { sharpe, mddPct: -4.2, observations: 5, measurable: true },
    benchmarkAlpha: {
      indexCode: '0001',
      portfolioReturnPct: 5,
      benchmarkReturnPct: 2,
      alphaPct: 3,
      fromDate: '20260601',
      toDate: '20260606',
    },
    config: { hitRateHorizonDays: 5, exitAccuracyHorizonDays: 3, usdKrwRate: 1380 },
  };
}

/** 스타일별 CLOSED 포지션(pnl) 생성 */
function closedPositions(n: number, pnlEach: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    corpCode: `c${i}`,
    stockCode: `s${i}`,
    status: 'CLOSED',
    entryDate: new Date('2026-06-01T00:00:00Z'),
    entryPrice: 1000,
    quantity: 10,
    closedAt: new Date('2026-06-05T00:00:00Z'),
    unrealizedPnl: pnlEach,
    unrealizedPnlPct: (pnlEach / 10000) * 100,
    stopLossPct: 8,
    takeProfitPct: 20,
    maxHoldDays: 20,
  }));
}

describe('PhilosophyStyleSimulationService (DAR-76)', () => {
  describe('summarizeGraduation', () => {
    it('GraduationMetrics 핵심 필드를 발췌(결측은 null/0 정직 표기)', () => {
      const s = summarizeGraduation(makeGraduation('pf', 1.5, 60) as never);
      expect(s).toEqual({
        hitRatePct: 60,
        hitRateSampleSize: 6,
        sharpe: 1.5,
        mddPct: -4.2,
        benchmarkAlphaPct: 3,
      });
    });
  });

  describe('getStyleComparison (분리 집계 + 랭킹)', () => {
    const CLOSED: Record<string, ReturnType<typeof closedPositions>> = {
      [pfId('BUFFETT')]: closedPositions(6, 100_000), // +600k → 6.0%
      [pfId('LYNCH')]: closedPositions(8, 150_000), // +1.2M → 12.0% (최고)
      [pfId('GREENBLATT')]: closedPositions(3, -100_000), // -300k → -3.0% (lowSample)
      [pfId('DRUCKENMILLER')]: [], // 표본 0
    };
    const SNAPS: Record<string, { snapshotDate: string; totalValue: number }[]> = {
      [pfId('BUFFETT')]: [
        { snapshotDate: '20260601', totalValue: 10_000_000 },
        { snapshotDate: '20260605', totalValue: 10_600_000 },
      ],
      [pfId('LYNCH')]: [{ snapshotDate: '20260605', totalValue: 11_200_000 }],
      [pfId('GREENBLATT')]: [],
      [pfId('DRUCKENMILLER')]: [],
    };

    function buildService() {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn() },
        portfolio: {
          findFirst: jest.fn(({ where }: { where: { name: string } }) => {
            const style = where.name.match(/\[(\w+)\]/)?.[1] ?? '';
            return Promise.resolve({ id: pfId(style), maxSinglePositionPct: 10 });
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
      const graduation = {
        getMetrics: jest.fn((id: string) =>
          Promise.resolve(makeGraduation(id, id === pfId('LYNCH') ? 2.1 : 1.0, 55)),
        ),
      };
      const service = new PhilosophyStyleSimulationService(
        prisma as never,
        {} as never,
        {} as never,
        graduation as never,
      );
      return { service, prisma, graduation };
    }

    it('4개 스타일을 분리 집계하고 누적수익률로 랭킹한다', async () => {
      const { service, graduation } = buildService();
      const cmp = await service.getStyleComparison();

      expect(cmp.styles).toHaveLength(4);
      expect(cmp.styles.map((s) => s.style)).toEqual([
        'BUFFETT',
        'LYNCH',
        'GREENBLATT',
        'DRUCKENMILLER',
      ]);

      const buffett = cmp.styles.find((s) => s.style === 'BUFFETT')!;
      expect(buffett.scorecard.cumulativeReturnPct).toBe(6);
      expect(buffett.scorecard.sampleSize).toBe(6);
      expect(buffett.lowSample).toBe(false);
      expect(buffett.equityCurve).toHaveLength(2);
      expect(buffett.label).toBe('버핏');

      const greenblatt = cmp.styles.find((s) => s.style === 'GREENBLATT')!;
      expect(greenblatt.scorecard.cumulativeReturnPct).toBe(-3);
      expect(greenblatt.lowSample).toBe(true); // 3 < 5

      const druck = cmp.styles.find((s) => s.style === 'DRUCKENMILLER')!;
      expect(druck.scorecard.sampleSize).toBe(0);
      expect(druck.equityCurve).toEqual([]);

      // 랭킹: LYNCH(12) > BUFFETT(6) > DRUCKENMILLER(0) > GREENBLATT(-3)
      expect(cmp.ranking.ranking).toEqual([
        'LYNCH',
        'BUFFETT',
        'DRUCKENMILLER',
        'GREENBLATT',
      ]);
      expect(cmp.ranking.bestStyle).toBe('LYNCH');
      expect(cmp.ranking.allLowSample).toBe(false);

      // 졸업지표는 스타일 포트폴리오별로 따로 산출
      expect(graduation.getMetrics).toHaveBeenCalledTimes(4);
      const lynch = cmp.styles.find((s) => s.style === 'LYNCH')!;
      expect(lynch.graduation.sharpe).toBe(2.1);
      expect(lynch.graduation.mddPct).toBe(-4.2);
      expect(lynch.graduation.benchmarkAlphaPct).toBe(3);
    });

    it('졸업지표 산출 실패는 빈 요약으로 graceful 처리(비교 자체는 유지)', async () => {
      const { service, graduation } = buildService();
      graduation.getMetrics.mockRejectedValueOnce(new Error('no data'));
      const cmp = await service.getStyleComparison();
      const buffett = cmp.styles.find((s) => s.style === 'BUFFETT')!;
      expect(buffett.graduation.sharpe).toBeNull();
      expect(buffett.graduation.hitRatePct).toBe(0);
      expect(cmp.styles).toHaveLength(4);
    });
  });

  describe('진입 분기(적합도 필터 + styleTag)', () => {
    function buildEntryService(eligibleCorp: string) {
      const created: unknown[] = [];
      const tagged: { id: string; data: unknown }[] = [];
      const prisma = {
        position: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]), // openCorpCodes
          create: jest.fn((args: { data: unknown }) => {
            created.push(args.data);
            return Promise.resolve({});
          }),
        },
        tradingSignal: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sigA', corpCode: 'A', stockCode: '000A', signal: 'WATCH', buyScore: 90 },
            { id: 'sigB', corpCode: 'B', stockCode: '000B', signal: 'WATCH', buyScore: 80 },
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
          update: jest.fn((args: { where: { id: string }; data: unknown }) => {
            tagged.push({ id: args.where.id, data: args.data });
            return Promise.resolve({});
          }),
        },
      };
      const philosophyFit = {
        getCompanyFit: jest.fn((corpCode: string) =>
          Promise.resolve({
            corpCode,
            fits: [
              {
                philosophyId: 'BUFFETT',
                computable: true,
                score: corpCode === eligibleCorp ? 80 : 30,
              },
            ],
          }),
        ),
      };
      const paperTrade = {
        placeOrder: jest.fn().mockResolvedValue({ id: 't1', filledShares: 400, filledPrice: 1000 }),
      };
      const service = new PhilosophyStyleSimulationService(
        prisma as never,
        paperTrade as never,
        philosophyFit as never,
        {} as never,
      );
      return { service, prisma, paperTrade, philosophyFit, created, tagged };
    }

    it('적합도 적격 종목만 진입하고 styleTag 로 태깅한다', async () => {
      const { service, paperTrade, created, tagged } = buildEntryService('A');
      const opened = await (service as never as {
        openStylePositions: (
          style: string,
          pf: { id: string; maxSinglePositionPct: number },
          tradeDate: string,
        ) => Promise<number>;
      }).openStylePositions('BUFFETT', { id: 'pf-BUFFETT', maxSinglePositionPct: 10 }, '20260606');

      expect(opened).toBe(1); // A 적격, B 부적격(score 30 < 50)
      expect(paperTrade.placeOrder).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect((created[0] as { corpCode: string; portfolioId: string }).corpCode).toBe('A');
      expect((created[0] as { portfolioId: string }).portfolioId).toBe('pf-BUFFETT');
      // styleTag 태깅
      expect(tagged).toEqual([{ id: 't1', data: { styleTag: 'BUFFETT' } }]);
    });

    it('적격 종목이 없으면 0건 진입(분기 격리)', async () => {
      const { service, paperTrade, created } = buildEntryService('NONE');
      const opened = await (service as never as {
        openStylePositions: (
          style: string,
          pf: { id: string; maxSinglePositionPct: number },
          tradeDate: string,
        ) => Promise<number>;
      }).openStylePositions('BUFFETT', { id: 'pf-BUFFETT', maxSinglePositionPct: 10 }, '20260606');
      expect(opened).toBe(0);
      expect(paperTrade.placeOrder).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    });
  });
});
