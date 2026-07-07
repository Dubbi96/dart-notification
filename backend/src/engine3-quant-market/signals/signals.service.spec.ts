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
      // 통계 표본수 조회는 (ALL, __ALL__) 코어스 버킷·READY 고정 단일 쿼리 —
      // @@unique([eventType, bucketKey, marketType]) 이므로 eventType당 1행(결정적).
      expect(prisma.eventStudyResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventType: { in: ['SUPPLY_CONTRACT'] },
            marketType: 'ALL',
            bucketKey: '__ALL__',
            status: 'READY',
          },
        }),
      );
    });

    it('sampleN이 있는 항목에 sampleScope("전체시장")를 함께 부여한다 — 모바일 괄호 병기 계약', async () => {
      prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
      prisma.eventStudyResult.findMany.mockResolvedValue([
        { eventType: 'SUPPLY_CONTRACT', sampleCount: 1871 },
      ]);

      const result = await service.findOne('sig_1');

      // 모바일이 `${EVENT_TYPE_LABEL}(${sampleScope})`로 그대로 병기 →
      // '대규모 공급계약(전체시장)' 표시를 위해 값은 리터럴 '전체시장'.
      expect(breakdownItem(result, 'historicalEvent')).toMatchObject({
        sampleN: 1871,
        sampleScope: '전체시장',
      });
    });

    it('sampleN이 없으면 sampleScope도 생략한다(키 자체 미존재 — 하위호환)', async () => {
      prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
      prisma.eventStudyResult.findMany.mockResolvedValue([]);

      const result = await service.findOne('sig_1');

      expect(breakdownItem(result, 'historicalEvent')).not.toHaveProperty(
        'sampleScope',
      );
    });

    it('비통계 항목에는 sampleScope를 부여하지 않는다', async () => {
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
        expect(breakdownItem(result, key)).not.toHaveProperty('sampleScope');
      }
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
            bucketKey: '__ALL__',
            marketType: 'ALL',
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

    // 결함 재현 가드(홈 카드 '표본' 오표시): 세분 버킷 행이 섞여 있어도 쿼리가
    // (__ALL__, ALL) 코어스 버킷만 선택 → 시장 불문(KOSPI 삼성전자·KOSDAQ 소룩스)
    // 같은 eventType이면 같은 코어스 표본수 + '전체시장' 스코프가 결정적으로 부여된다.
    it('세분 버킷이 존재해도 코어스 버킷(__ALL__) 표본만 결정적으로 채택하고 sampleScope를 병기한다', async () => {
      const kospiSignal = baseSignal; // 삼성전자(KOSPI)
      const kosdaqSignal = {
        ...baseSignal,
        id: 'sig_2',
        corpCode: '01234567',
        stockCode: '290690',
        company: { corpCode: '01234567', corpName: '소룩스', stockCode: '290690' },
      };
      prisma.tradingSignal.findMany.mockResolvedValue([
        kospiSignal,
        kosdaqSignal,
      ]);
      prisma.tradingSignal.count.mockResolvedValue(2);

      // 세분 버킷(시장별·규모별)까지 포함한 저장 상태를 모델링 —
      // where 조건(bucketKey/marketType)대로 필터해 반환하는 mock.
      const stored = [
        { eventType: 'SUPPLY_CONTRACT', bucketKey: '__ALL__', marketType: 'ALL', sampleCount: 1871 },
        { eventType: 'SUPPLY_CONTRACT', bucketKey: 'LARGE', marketType: 'KOSPI', sampleCount: 312 },
        { eventType: 'SUPPLY_CONTRACT', bucketKey: 'SMALL', marketType: 'KOSDAQ', sampleCount: 87 },
      ];
      prisma.eventStudyResult.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          stored
            .filter(
              (r) =>
                where.eventType.in.includes(r.eventType) &&
                (where.marketType == null || r.marketType === where.marketType) &&
                (where.bucketKey == null || r.bucketKey === where.bucketKey),
            )
            .map((r) => ({ eventType: r.eventType, sampleCount: r.sampleCount })),
        ),
      );

      const { items } = await service.findAll({});

      for (const item of items) {
        expect(
          item.scoreBreakdown.find((c) => c.key === 'historicalEvent'),
        ).toMatchObject({ sampleN: 1871, sampleScope: '전체시장' });
      }
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

    it('sort=score 시 점수 내림차순 + 최신순 tiebreak + 유니크 id tiebreak(DAR-289)로 정렬한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({ sort: 'score' });

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { buyScore: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
        }),
      );
    });

    it('sort 미지정 시 최신순(createdAt desc) + 유니크 id tiebreak(DAR-289)를 기본으로 한다', async () => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.tradingSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
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

  /**
   * 매수 신호 큐레이션 최신성 윈도우(sinceDays) — 점수순 정렬이 전체 이력 고득점(6월 신호)에
   * 영원히 고정돼 홈 '오늘의 투자판단'이 미갱신되던 정체의 해소 계약.
   */
  describe('findAll — 최신성 윈도우 sinceDays', () => {
    beforeEach(() => {
      prisma.tradingSignal.findMany.mockResolvedValue([]);
      prisma.tradingSignal.count.mockResolvedValue(0);
      prisma.eventStudyResult.findMany.mockResolvedValue([]);
    });

    /** findMany where 의 createdAt.gte 가 now−expectedDays일(±허용오차)인지 검증. */
    function expectWindowDays(expectedDays: number) {
      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      const gte = call.where.createdAt?.gte as Date;
      expect(gte).toBeInstanceOf(Date);
      const actualDays = (Date.now() - gte.getTime()) / 86_400_000;
      expect(actualDays).toBeGreaterThan(expectedDays - 0.01);
      expect(actualDays).toBeLessThan(expectedDays + 0.01);
    }

    it('sort=score + sinceDays 미지정 → 기본 14일 윈도우를 적용한다(구 APK 즉시 최신성)', async () => {
      await service.findAll({ sort: 'score' });

      expectWindowDays(14);
    });

    it('sinceDays=0 명시 → 윈도우 해제(sort=score 여도 createdAt 조건 미생성·전체 이력)', async () => {
      await service.findAll({ sort: 'score', sinceDays: 0 });

      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('createdAt');
    });

    it('sort=latest + sinceDays 미지정 → 무윈도우(기존 동작 유지)', async () => {
      await service.findAll({ sort: 'latest' });

      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('createdAt');
    });

    it('sort 미지정(기본 latest) → 무윈도우(기존 동작 유지)', async () => {
      await service.findAll({});

      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('createdAt');
    });

    it('sinceDays=7 명시 → sort=latest 에도 7일 윈도우를 적용한다(명시 지정 우선)', async () => {
      await service.findAll({ sort: 'latest', sinceDays: 7 });

      expectWindowDays(7);
    });

    it('count 쿼리에도 동일 윈도우 where 를 적용한다(meta.total/totalPages 정합)', async () => {
      await service.findAll({ sort: 'score' });

      const findCall = prisma.tradingSignal.findMany.mock.calls[0][0];
      const countCall = prisma.tradingSignal.count.mock.calls[0][0];
      expect(countCall.where.createdAt).toEqual(findCall.where.createdAt);
    });

    it('윈도우는 기존 필터(백필 제외·등급)와 AND 로 결합된다', async () => {
      await service.findAll({ sort: 'score', grade: 'STRONG_BUY,BUY', sinceDays: 14 });

      const call = prisma.tradingSignal.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        disclosure: { isBackfill: false },
        signal: {
          in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE],
        },
      });
      expect(call.where.createdAt?.gte).toBeInstanceOf(Date);
    });
  });
});

// ─── DAR-289: 페이지네이션 tie-break ───────────────────────────────────────────
// createdAt 이 같은 배치에서 동값이면(점수순은 buyScore+createdAt 동값까지) orderBy 가
// 행 순서를 미결정 → 페이지 경계 중복/누락. 유니크 id 를 최종 tie-break 로 추가해 결정화.
// fake findMany 로 그 불안정성을 모델링한다.
describe('SignalsService — 페이지네이션 tie-break (DAR-289)', () => {
  let service: SignalsService;
  let prisma: {
    tradingSignal: { findMany: jest.Mock; count: jest.Mock };
    eventStudyResult: { findMany: jest.Mock };
  };

  const sameTs = new Date('2026-06-15T00:00:00.000Z');
  const mkRow = (id: string) => ({
    id,
    rcpNo: id,
    corpCode: '00126380',
    stockCode: '005930',
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore: 72, // 동점 — score 정렬에서도 createdAt 동값과 합쳐 tie 발생
    signal: SignalGrade.BUY_CANDIDATE,
    scoreBreakdown: {},
    riskPenalty: 0,
    entryConditionMet: [],
    entryConditionUnmet: [],
    entryReady: true,
    riskFactors: [],
    signalSummary: '요약',
    blockedReason: null,
    validUntil: sameTs,
    isNotified: false,
    notifiedAt: null,
    createdAt: sameTs,
    updatedAt: sameTs,
    company: { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930' },
  });
  const rows = [mkRow('s1'), mkRow('s2'), mkRow('s3'), mkRow('s4')];

  let callSeq = 0;
  const cmpBy =
    (orderBy: Array<Record<string, 'asc' | 'desc'>>) =>
    (a: Record<string, unknown>, b: Record<string, unknown>): number => {
      for (const o of orderBy) {
        const field = Object.keys(o)[0];
        const dir = o[field];
        const av = a[field] as string | number | Date;
        const bv = b[field] as string | number | Date;
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    };
  const unstableFindMany = (orderBy: any, skip = 0, take?: number) => {
    const cmp = cmpBy(Array.isArray(orderBy) ? orderBy : [orderBy]);
    const sorted = [...rows].sort(cmp);
    const seq = callSeq++;
    const groups: Array<Array<Record<string, unknown>>> = [];
    for (const r of sorted) {
      const last = groups[groups.length - 1];
      if (last && cmp(last[0], r) === 0) last.push(r);
      else groups.push([r]);
    }
    return groups
      .flatMap((g) => {
        if (g.length <= 1) return g;
        const off = seq % g.length;
        return [...g.slice(off), ...g.slice(0, off)];
      })
      .slice(skip, take == null ? undefined : skip + take);
  };

  beforeEach(async () => {
    callSeq = 0;
    prisma = {
      tradingSignal: {
        findMany: jest.fn(({ orderBy, skip, take }: any) =>
          Promise.resolve(unstableFindMany(orderBy, skip, take)),
        ),
        count: jest.fn().mockResolvedValue(rows.length),
      },
      eventStudyResult: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<SignalsService>(SignalsService);
  });

  it('latest: 동값 createdAt 다건에서 2페이지 연속 조회 시 union=전체·교집합=0', async () => {
    const p1 = await service.findAll({ sort: 'latest', page: 1, limit: 2 });
    const p2 = await service.findAll({ sort: 'latest', page: 2, limit: 2 });
    const ids1 = p1.items.map((s: any) => s.id);
    const ids2 = p2.items.map((s: any) => s.id);
    expect(new Set([...ids1, ...ids2]).size).toBe(rows.length);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it('latest 분기 orderBy 끝에 유니크 id tie-break 전달', async () => {
    await service.findAll({ sort: 'latest', page: 1, limit: 2 });
    expect(prisma.tradingSignal.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('score 분기 orderBy 끝에 유니크 id tie-break 전달', async () => {
    await service.findAll({ sort: 'score', page: 1, limit: 2 });
    expect(prisma.tradingSignal.findMany.mock.calls[0][0].orderBy).toEqual([
      { buyScore: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('대조군: tie-break 없는 단일 키 정렬은 동일 fake 에서 중복/누락이 발생한다', () => {
    callSeq = 0;
    const single = [{ createdAt: 'desc' as const }];
    const page1 = unstableFindMany(single, 0, 2).map((s) => s.id as string);
    const page2 = unstableFindMany(single, 2, 2).map((s) => s.id as string);
    expect(new Set([...page1, ...page2]).size).toBeLessThan(rows.length);
    expect(page1.filter((id) => page2.includes(id)).length).toBeGreaterThan(0);
  });
});
