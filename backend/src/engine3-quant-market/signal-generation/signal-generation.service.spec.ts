import { Prisma } from '@prisma/client';
import { SignalGenerationService } from './signal-generation.service';
import { BuySignalService } from '../buy-signal/buy-signal.service';

/**
 * DAR-41: 런타임 신호 생성 — BuyScore → TradingSignal persist.
 * 멱등성·대상 필터·grade 분포 합리성·FK 채움 검증.
 */
describe('SignalGenerationService (DAR-41)', () => {
  function makeEvent(over: Partial<any> = {}) {
    return {
      rcpNo: over.rcpNo ?? '20260101000001',
      corpCode: over.corpCode ?? '00100000',
      eventType: over.eventType ?? 'SHARE_BUYBACK',
      polarity: over.polarity ?? 'POSITIVE',
      isAmendment: over.isAmendment ?? false,
      extractedData: over.extractedData ?? {},
      company: over.company ?? { stockCode: '000100', market: 'KOSPI' },
    };
  }

  function buildPrisma(opts: {
    events: any[];
    pricedStockCodes: string[];
    existingSignals?: { rcpNo: string; persona: string }[];
    createImpl?: jest.Mock;
    esrRows?: any[];
    financials?: any[];
  }) {
    const created: any[] = [];
    const create =
      opts.createImpl ??
      jest.fn(async ({ data }: any) => {
        created.push(data);
        return data;
      });
    const prisma = {
      stockDailyPrice: {
        findMany: jest.fn(async () =>
          opts.pricedStockCodes.map((stockCode) => ({ stockCode })),
        ),
        findFirst: jest.fn(async ({ where }: any) => ({
          stockCode: where.stockCode,
          closePrice: 10000,
          volume: BigInt(500000),
          tradingValue: BigInt(5_000_000_000),
          tradeDate: '20260104',
        })),
      },
      disclosureEvent: {
        findMany: jest.fn(async () => opts.events),
      },
      tradingSignal: {
        findMany: jest.fn(async () => opts.existingSignals ?? []),
        create,
      },
      technicalIndicator: {
        findFirst: jest.fn(async () => null),
      },
      stockStatus: {
        findUnique: jest.fn(async () => null),
      },
      marketIndex: {
        findMany: jest.fn(async () => []),
      },
      eventStudyResult: {
        findMany: jest.fn(async () => opts.esrRows ?? []),
      },
      disclosureAnalysis: {
        findMany: jest.fn(async () => []),
      },
      companyFinancial: {
        findMany: jest.fn(async () => opts.financials ?? []),
      },
      // DAR-88: 내부자 동향 맵 로드용. 기본 빈 배열 → insider 결측(회귀 0).
      insiderHoldingChange: {
        findMany: jest.fn(async () => opts.insiderChanges ?? []),
      },
    };
    return { prisma, created, create };
  }

  function makeService(prisma: any) {
    return new SignalGenerationService(prisma, new BuySignalService());
  }

  it('이벤트+시세 있고 신호 없는 공시에 4 Persona 신호를 생성한다', async () => {
    const { prisma, created } = buildPrisma({
      events: [makeEvent()],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    expect(result.candidates).toBe(1);
    expect(result.created).toBe(4); // 4 Persona
    expect(created).toHaveLength(4);
    // FK 채움 — corpCode/stockCode 비어있지 않음
    for (const row of created) {
      expect(row.corpCode).toBe('00100000');
      expect(row.stockCode).toBe('000100');
      expect(row.rcpNo).toBe('20260101000001');
    }
    // persona 4종 모두
    expect(created.map((r) => r.persona).sort()).toEqual(
      ['EVENT_DRIVEN', 'GROWTH', 'MOMENTUM', 'VALUE'],
    );
  });

  // DAR-79: 취득금액 매출 대비 정규화 → persona-view 연결
  it('CompanyFinancial.revenue 로 buyback 정규화 비율을 반영한다 (상대비율 우선)', async () => {
    const evt = {
      rcpNo: 'BB',
      eventType: 'SHARE_BUYBACK',
      polarity: 'POSITIVE',
      extractedData: { buybackAmount: 1_000_000_000 }, // 10억
      company: { stockCode: '000100', market: 'KOSPI' },
    };

    // 시총 대비 비율 HIGH: 매출 5억 → 10억/5억 = 200% (유의) → VALUE POSITIVE 유지
    const high = buildPrisma({
      events: [makeEvent(evt)],
      pricedStockCodes: ['000100'],
      financials: [{ corpCode: '00100000', revenue: 500_000_000 }],
    });
    await makeService(high.prisma).generateMissingSignals('MANUAL');

    // 비율 LOW: 매출 1조 → 10억/1조 = 0.1% (미미) → VALUE WATCH 보정
    const low = buildPrisma({
      events: [makeEvent(evt)],
      pricedStockCodes: ['000100'],
      financials: [{ corpCode: '00100000', revenue: 1_000_000_000_000 }],
    });
    await makeService(low.prisma).generateMissingSignals('MANUAL');

    // CompanyFinancial 을 후보 corpCode 로 실제 조회했는지 (연결 증거)
    expect(high.prisma.companyFinancial.findMany).toHaveBeenCalledTimes(1);
    const whereArg = (high.prisma.companyFinancial.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.corpCode.in).toContain('00100000');

    const valueScore = (rows: any[]) =>
      rows.find((r) => r.persona === 'VALUE')?.buyScore as number;
    // 규모가 유의한 쪽(high)의 VALUE persona-fit 이 더 우호적 → buyScore 가 더 높다
    expect(valueScore(high.created)).toBeGreaterThan(valueScore(low.created));
  });

  it('시세 없는 종목·종목코드 없는 공시는 대상에서 제외', async () => {
    const { prisma, created } = buildPrisma({
      events: [
        makeEvent({ rcpNo: 'A', company: { stockCode: '999999', market: 'KOSPI' } }), // 시세 없음
        makeEvent({ rcpNo: 'B', company: { stockCode: null, market: null } }), // 종목코드 없음
        makeEvent({ rcpNo: 'C', company: { stockCode: '000100', market: 'KOSPI' } }), // 대상
      ],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    expect(result.candidates).toBe(1);
    expect(created.every((r) => r.rcpNo === 'C')).toBe(true);
  });

  it('멱등: 이미 (rcpNo, persona) 신호가 있으면 스킵한다', async () => {
    const { prisma, created } = buildPrisma({
      events: [makeEvent({ rcpNo: 'X' })],
      pricedStockCodes: ['000100'],
      existingSignals: [
        { rcpNo: 'X', persona: 'GROWTH' },
        { rcpNo: 'X', persona: 'VALUE' },
        { rcpNo: 'X', persona: 'MOMENTUM' },
        { rcpNo: 'X', persona: 'EVENT_DRIVEN' },
      ],
    });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(4);
    expect(created).toHaveLength(0);
  });

  it('멱등: 유니크 충돌(P2002)은 스킵으로 처리된다', async () => {
    const createImpl = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
    });
    const { prisma } = buildPrisma({
      events: [makeEvent()],
      pricedStockCodes: ['000100'],
      createImpl,
    });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(4);
  });

  it('grade 분포: 전부 BUY 쏠림이 아니라 NEUTRAL 위주(데이터 빈약 시)', async () => {
    // 시세 1스냅샷(지표 없음)·ESR 없음 → 대부분 NEUTRAL
    const events = [
      makeEvent({ rcpNo: '1', eventType: 'SHARE_BUYBACK', polarity: 'POSITIVE', company: { stockCode: '000100', market: 'KOSPI' } }),
      makeEvent({ rcpNo: '2', eventType: 'CB_ISSUANCE', polarity: 'NEGATIVE', company: { stockCode: '000100', market: 'KOSPI' } }),
      makeEvent({ rcpNo: '3', eventType: 'PAID_IN_CAPITAL_INCREASE', polarity: 'NEGATIVE', company: { stockCode: '000100', market: 'KOSPI' } }),
    ];
    const { prisma } = buildPrisma({ events, pricedStockCodes: ['000100'] });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    const total = Object.values(result.gradeDist).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.created);
    const buyish =
      (result.gradeDist['STRONG_BUY_CANDIDATE'] ?? 0) +
      (result.gradeDist['BUY_CANDIDATE'] ?? 0);
    // BUY 등급 쏠림 없어야 함 (절반 미만)
    expect(buyish).toBeLessThan(total / 2);
    // NEUTRAL 이 존재
    expect(result.gradeDist['NEUTRAL'] ?? 0).toBeGreaterThan(0);
  });

  it('동시 실행 가드: 이미 진행 중이면 빈 결과를 반환', async () => {
    const { prisma } = buildPrisma({
      events: [makeEvent()],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);
    // isRunning 강제 set
    (service as unknown as { isRunning: boolean }).isRunning = true;

    const result = await service.generateMissingSignals('MANUAL');
    expect(result.created).toBe(0);
    expect(result.message).toBeDefined();
  });

  // ── DAR-70: EventStudy bucketKey 신호 정밀화 ───────────────────────
  describe('EventStudy bucketKey 조회·폴백·통계신호 반영 (DAR-70)', () => {
    // SHARE_BUYBACK + extractedData {} → classifyBucket → 'SHARE_BUYBACK__ratio_lt1'
    const DERIVED_BUCKET = 'SHARE_BUYBACK__ratio_lt1';

    function esr(over: Partial<any> = {}) {
      return {
        eventType: over.eventType ?? 'SHARE_BUYBACK',
        marketType: over.marketType ?? 'KOSPI',
        bucketKey: over.bucketKey ?? DERIVED_BUCKET,
        avgArD5: over.avgArD5 ?? 5,
        isSignificant: over.isSignificant ?? true,
        upProbD5: over.upProbD5 ?? 0.5,
        crashProbD5: over.crashProbD5 ?? 0.0,
        sampleCount: over.sampleCount ?? 100,
      };
    }

    it('정밀 버킷 매칭: bucketKey 통계가 historicalEvent 점수에 반영된다', async () => {
      // base(avgArD5=5)=70, upProbD5=0.7→+15 = 85, 유의·표본충분 → trust 1
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
        esrRows: [esr({ avgArD5: 5, upProbD5: 0.7 })],
      });
      const result = await makeService(prisma).generateMissingSignals('MANUAL');

      expect(result.created).toBe(4);
      for (const row of created) {
        expect(row.scoreBreakdown.historicalEvent).toBe(85);
      }
    });

    it('급락확률·무의미 버킷은 감점/감쇠된다 (같은 avgArD5라도 갈림)', async () => {
      // base=70, crash 0.35→-30 =40, isSignificant false → trust 0.2 → 8
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
        esrRows: [
          esr({ avgArD5: 5, crashProbD5: 0.35, isSignificant: false, sampleCount: 100 }),
        ],
      });
      await makeService(prisma).generateMissingSignals('MANUAL');
      expect(created[0].scoreBreakdown.historicalEvent).toBe(8);
    });

    it('버킷 미스 → eventType::marketType 표본가중 평균으로 graceful 폴백', async () => {
      // 도출 버킷(__ratio_lt1)은 없고 다른 버킷 2개만 존재 → 가중평균 폴백
      // wAvgArD5=(10*90+0*10)/100=9→base70, up=(0.6*90+0.4*10)/100=0.58→+7=77,
      // crash=(0.1*90+0.5*10)/100=0.14→-5=72, isSignificant(some true)=true → 72
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
        esrRows: [
          esr({ bucketKey: 'SHARE_BUYBACK__ratio_gte3', avgArD5: 10, upProbD5: 0.6, crashProbD5: 0.1, sampleCount: 90, isSignificant: true }),
          esr({ bucketKey: 'SHARE_BUYBACK__ratio_1to3', avgArD5: 0, upProbD5: 0.4, crashProbD5: 0.5, sampleCount: 10, isSignificant: false }),
        ],
      });
      await makeService(prisma).generateMissingSignals('MANUAL');
      expect(created[0].scoreBreakdown.historicalEvent).toBe(72);
    });

    it('ALL 시장 버킷 폴백: 종목 시장 미스 시 marketType=ALL 버킷을 쓴다', async () => {
      // KOSPI 행 없음, ALL::도출버킷 존재 → base(avgArD5=2)=40
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
        esrRows: [esr({ marketType: 'ALL', avgArD5: 2, upProbD5: 0.5 })],
      });
      await makeService(prisma).generateMissingSignals('MANUAL');
      expect(created[0].scoreBreakdown.historicalEvent).toBe(40);
    });

    it('완전 미스(해당 eventType ESR 없음) → historicalEvent 0 (결측 처리)', async () => {
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
        esrRows: [esr({ eventType: 'CB_ISSUANCE' })], // 다른 이벤트타입만 존재
      });
      await makeService(prisma).generateMissingSignals('MANUAL');
      expect(created[0].scoreBreakdown.historicalEvent).toBe(0);
    });
  });
});
