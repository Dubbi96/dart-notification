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
      findFirst: jest.Mock;
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
        findFirst: jest.fn(),
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

    // ★DAR-129: 신호 피드는 백필(과거 분석 baseline) 공시 기반 신호를 절대 노출하지 않는다.
    it('백필 제외 relation 필터(disclosure.isBackfill=false)를 where에 적용한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);
      prisma.tradingSignal.count.mockResolvedValue(0);
      prisma.eventStudyResult.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            disclosure: { isBackfill: false },
          }),
        }),
      );
      expect(prisma.tradingSignal.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            disclosure: { isBackfill: false },
          }),
        }),
      );
    });
  });

  /**
   * DAR-159: 종목별 최신 신호 단건 조회(corpCode 필터) 계약.
   */
  describe('findLatestByCorpCode', () => {
    it('corpCode·백필제외 where + 최신순(createdAt desc)으로 단건 조회한다', async () => {
      prisma.tradingSignal.findFirst.mockResolvedValue(baseSignal);

      const result = await service.findLatestByCorpCode('00126380');

      expect(prisma.tradingSignal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { corpCode: '00126380', disclosure: { isBackfill: false } },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toMatchObject({
        corpCode: '00126380',
        grade: 'BUY',
        buyScore: 72,
        entryReady: true,
      });
    });

    it('해당 종목 신호가 없으면 null을 반환한다(빈상태 흡수)', async () => {
      prisma.tradingSignal.findFirst.mockResolvedValue(null);

      const result = await service.findLatestByCorpCode('99999999');

      expect(result).toBeNull();
    });

    it('진입준비 여부(entryReady)를 그대로 노출한다', async () => {
      prisma.tradingSignal.findFirst.mockResolvedValue({
        ...baseSignal,
        entryReady: false,
      });

      const result = await service.findLatestByCorpCode('00126380');

      expect(result?.entryReady).toBe(false);
    });
  });

  /**
   * DAR-208: 공시(rcpNo) → 신호 역조회 계약 — 공시 상세 진입 카드용.
   */
  describe('findByDisclosureRcpNo', () => {
    it('rcpNo·백필제외 where + 최신순(createdAt desc)으로 단건 조회한다', async () => {
      prisma.tradingSignal.findFirst.mockResolvedValue(baseSignal);

      const result = await service.findByDisclosureRcpNo('20240101000001');

      expect(prisma.tradingSignal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { rcpNo: '20240101000001', disclosure: { isBackfill: false } },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toMatchObject({
        id: 'sig_1',
        corpCode: '00126380',
        corpName: '삼성전자',
        grade: 'BUY',
        buyScore: 72,
        entryReady: true,
        relatedDisclosureRcpNo: '20240101000001',
      });
    });

    it('해당 공시로 생성된 신호가 없으면 null을 반환한다(카드 미표시)', async () => {
      prisma.tradingSignal.findFirst.mockResolvedValue(null);

      const result = await service.findByDisclosureRcpNo('99999999999999');

      expect(result).toBeNull();
    });

    it('신호 id를 노출해 신호 상세(/signals/:id) 이동을 가능케 한다', async () => {
      prisma.tradingSignal.findFirst.mockResolvedValue(baseSignal);

      const result = await service.findByDisclosureRcpNo('20240101000001');

      expect(result?.id).toBe('sig_1');
    });
  });

  /**
   * DAR-46: 등급무관 탐색을 위한 findAll 계약 — 전 등급 노출 + sort + eventType 필터.
   */
  describe('findAll — 등급무관 탐색 (DAR-46)', () => {
    beforeEach(() => {
      prisma.eventStudyResult.findMany.mockResolvedValue([]);
      prisma.tradingSignal.count.mockResolvedValue(0);
    });

    it('NEUTRAL/AVOID 등급을 WATCH로 합치지 않고 1:1로 노출한다', async () => {
      const neutral = { ...baseSignal, id: 'n1', signal: SignalGrade.NEUTRAL };
      const avoid = { ...baseSignal, id: 'a1', signal: SignalGrade.AVOID };
      prisma.tradingSignal.findMany.mockResolvedValue([neutral, avoid]);
      prisma.tradingSignal.count.mockResolvedValue(2);

      const { items } = await service.findAll({});

      expect(items[0].grade).toBe('NEUTRAL');
      expect(items[1].grade).toBe('AVOID');
    });

    it('모바일 등급값(AVOID)을 Prisma enum으로 역매핑해 where에 적용한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ grade: 'AVOID' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ signal: SignalGrade.AVOID }),
        }),
      );
    });

    it('raw enum 등급값(STRONG_BUY_CANDIDATE)도 하위호환으로 허용한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ grade: 'STRONG_BUY_CANDIDATE' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            signal: SignalGrade.STRONG_BUY_CANDIDATE,
          }),
        }),
      );
    });

    it('콤마 다중 등급(STRONG_BUY,BUY)을 signal.in 으로 적용한다 (DAR-193 홈 큐레이션)', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ grade: 'STRONG_BUY,BUY' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            signal: {
              in: [
                SignalGrade.STRONG_BUY_CANDIDATE,
                SignalGrade.BUY_CANDIDATE,
              ],
            },
          }),
        }),
      );
    });

    it('다중 등급 중 미인식 토큰은 무시하고 인식분만 적용한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ grade: 'STRONG_BUY, NONSENSE , BUY' });

      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      expect(call.where.signal).toEqual({
        in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE],
      });
    });

    it('미인식 등급값은 필터에서 무시한다(signal 조건 미생성)', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ grade: 'NONSENSE' });

      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('signal');
    });

    it('sort=score 시 점수 내림차순 + 최신순 tiebreak로 정렬한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ sort: 'score' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ buyScore: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('sort 미지정 시 최신순(createdAt desc)을 기본으로 한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }] }),
      );
    });

    it('eventType 필터를 where에 적용한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ eventType: 'SUPPLY_CONTRACT' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventType: 'SUPPLY_CONTRACT' }),
        }),
      );
    });

    it('persona 필터를 where에 적용한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ personaType: 'GROWTH' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ persona: 'GROWTH' }),
        }),
      );
    });
  });
});
