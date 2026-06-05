import { Test, TestingModule } from '@nestjs/testing';
import { SignalGrade } from '@prisma/client';
import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DAR-34: scoreBreakdown 항목별 표본수(sampleN) emit 검증.
 * 통계 파생 항목(historicalEvent)에만 EventStudyResult.sampleCount가 연결되고,
 * 비통계 항목/집계 부재 시 sampleN이 생략(undefined)되는지 확인.
 */
describe('SignalsService — scoreBreakdown sampleN (DAR-34)', () => {
  let service: SignalsService;
  let prisma: {
    tradingSignal: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    eventStudyResult: { findMany: jest.Mock };
  };

  const baseSignal = {
    id: 'sig_1',
    rcpNo: '20240101000001',
    corpCode: '00126380',
    stockCode: '005930',
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore: 72,
    signal: SignalGrade.BUY_CANDIDATE,
    scoreBreakdown: {
      disclosureEvent: 20,
      keyMetric: 15,
      personaFit: 18,
      historicalEvent: 10,
      chart: 8,
      volumeLiquidity: 4,
      marketSector: 3,
    },
    riskPenalty: 0,
    entryConditionMet: ['거래량 충족'],
    entryConditionUnmet: [],
    entryReady: true,
    riskFactors: [],
    signalSummary: '요약',
    blockedReason: null,
    validUntil: new Date('2024-01-10T00:00:00.000Z'),
    isNotified: false,
    notifiedAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    company: { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930' },
  };

  beforeEach(async () => {
    prisma = {
      tradingSignal: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      eventStudyResult: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
  });

  function breakdownItem(result: any, key: string) {
    return result.scoreBreakdown.find((c: any) => c.key === key);
  }

  describe('findOne', () => {
    it('통계 파생 항목(historicalEvent)에 EventStudyResult.sampleCount를 sampleN으로 연결한다', async () => {
      prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
      prisma.eventStudyResult.findMany.mockResolvedValue([
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 42 },
      ]);

      const result = await service.findOne('sig_1');

      expect(breakdownItem(result, 'historicalEvent').sampleN).toBe(42);
      // 통계 표본수 조회는 ALL·READY 기준 단일 쿼리
      expect(prisma.eventStudyResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventType: { in: ['SUPPLY_CONTRACT'] },
            marketType: 'ALL',
            status: 'READY',
          },
        }),
      );
    });

    it('비통계 항목(chart/personaFit 등)에는 sampleN을 부여하지 않는다(undefined)', async () => {
      prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
      prisma.eventStudyResult.findMany.mockResolvedValue([
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 42 },
      ]);

      const result = await service.findOne('sig_1');

      for (const key of [
        'disclosureEvent',
        'keyMetric',
        'personaFit',
        'chart',
        'volumeLiquidity',
        'marketSector',
      ]) {
        expect(breakdownItem(result, key)).not.toHaveProperty('sampleN');
        expect(breakdownItem(result, key).sampleN).toBeUndefined();
      }
    });

    it('EventStudy 집계가 없으면 historicalEvent의 sampleN도 생략한다', async () => {
      prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
      prisma.eventStudyResult.findMany.mockResolvedValue([]);

      const result = await service.findOne('sig_1');

      expect(breakdownItem(result, 'historicalEvent')).not.toHaveProperty(
        'sampleN',
      );
      // 점수·라벨·max 등 기존 필드는 그대로(기존 응답 호환)
      expect(breakdownItem(result, 'historicalEvent')).toMatchObject({
        key: 'historicalEvent',
        label: '과거 이벤트',
        score: 10,
        max: 15,
      });
    });

    it('eventType별 최신(calculatedAt desc) 집계의 sampleCount만 채택한다', async () => {
      prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
      // 정렬은 prisma 쿼리(orderBy desc)가 보장 — 첫 항목이 최신
      prisma.eventStudyResult.findMany.mockResolvedValue([
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 99 }, // 최신
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 12 }, // 과거
      ]);

      const result = await service.findOne('sig_1');

      expect(breakdownItem(result, 'historicalEvent').sampleN).toBe(99);
    });
  });

  describe('findAll', () => {
    it('여러 신호의 표본수를 단일 쿼리로 일괄 매핑한다(N+1 회피)', async () => {
      const second = {
        ...baseSignal,
        id: 'sig_2',
        eventType: 'EQUITY_OFFERING',
        company: { corpCode: '00111', corpName: '엘지', stockCode: '003550' },
      };
      prisma.tradingSignal.findMany.mockResolvedValue([baseSignal, second]);
      prisma.tradingSignal.count.mockResolvedValue(2);
      prisma.eventStudyResult.findMany.mockResolvedValue([
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 42 },
        { eventType: 'EQUITY_OFFERING', sampleCount: 7 },
      ]);

      const { items } = await service.findAll({});

      expect(prisma.eventStudyResult.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.eventStudyResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: { in: ['SUPPLY_CONTRACT', 'EQUITY_OFFERING'] },
          }),
        }),
      );
      expect(
        items[0].scoreBreakdown.find((c) => c.key === 'historicalEvent')
          ?.sampleN,
      ).toBe(42);
      expect(
        items[1].scoreBreakdown.find((c) => c.key === 'historicalEvent')
          ?.sampleN,
      ).toBe(7);
    });

    it('집계가 일부만 존재하면 매칭되는 신호에만 sampleN을 부여한다', async () => {
      const second = {
        ...baseSignal,
        id: 'sig_2',
        eventType: 'EQUITY_OFFERING',
        company: { corpCode: '00111', corpName: '엘지', stockCode: '003550' },
      };
      prisma.tradingSignal.findMany.mockResolvedValue([baseSignal, second]);
      prisma.tradingSignal.count.mockResolvedValue(2);
      prisma.eventStudyResult.findMany.mockResolvedValue([
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 42 },
      ]);

      const { items } = await service.findAll({});

      expect(
        items[0].scoreBreakdown.find((c) => c.key === 'historicalEvent')
          ?.sampleN,
      ).toBe(42);
      expect(
        items[1].scoreBreakdown.find((c) => c.key === 'historicalEvent'),
      ).not.toHaveProperty('sampleN');
    });
  });
});
