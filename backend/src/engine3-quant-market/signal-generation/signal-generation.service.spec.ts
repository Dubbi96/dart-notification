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
    upsertImpl?: jest.Mock;
    esrRows?: any[];
    financials?: any[];
    insiderChanges?: any[];
    filedFacts?: any[];
  }) {
    const created: any[] = [];
    const upsertCalls: any[] = [];
    const create =
      opts.createImpl ??
      jest.fn(async ({ data }: any) => {
        created.push(data);
        return data;
      });
    // DAR-125: 신호 생성부는 자연키 upsert. create 경로(신규)는 `create` payload 를
    //   created 배열에 기록해 기존 단언(생성 수·FK·persona)을 그대로 유지한다.
    const upsert =
      opts.upsertImpl ??
      jest.fn(async (args: any) => {
        upsertCalls.push(args);
        created.push(args.create);
        return { id: `sig_${created.length}` };
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
        upsert,
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
      // DAR-100: 본문 정량값 맵 로드용. 기본 빈 배열 → fundamental 정량값 결측(회귀 0).
      dartFiledFact: {
        findMany: jest.fn(async () => opts.filedFacts ?? []),
      },
    };
    return { prisma, created, create, upsert, upsertCalls };
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

  // ★DAR-129: 라이브 신호 생성은 백필(과거 분석 baseline) 공시를 절대 후보로 삼지 않는다.
  it('후보 이벤트 조회에 백필 제외 relation 필터(disclosure.isBackfill=false)를 적용한다', async () => {
    const { prisma } = buildPrisma({
      events: [makeEvent()],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    await service.generateMissingSignals('MANUAL');

    expect(prisma.disclosureEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { disclosure: { isBackfill: false } },
      }),
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
    // DAR-100: loadRevenueMap(매출) + loadGrowthMap(성장률) 두 조회 → 2회.
    expect(high.prisma.companyFinancial.findMany).toHaveBeenCalledTimes(2);
    const whereArg = (high.prisma.companyFinancial.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.corpCode.in).toContain('00100000');

    const valueScore = (rows: any[]) =>
      rows.find((r) => r.persona === 'VALUE')?.buyScore as number;
    // 규모가 유의한 쪽(high)의 VALUE persona-fit 이 더 우호적 → buyScore 가 더 높다
    expect(valueScore(high.created)).toBeGreaterThan(valueScore(low.created));
  });

  // DAR-100: 재무 성장률(DAR-93)·본문 정량값(DAR-95) → fundamental 버킷 활성화
  it('재무 성장률·본문 정량값을 fundamental 버킷 입력으로 종단 연결한다 (사장 자산 활성화)', async () => {
    const evt = makeEvent({
      rcpNo: 'F1',
      eventType: 'SUPPLY_CONTRACT',
      polarity: 'POSITIVE',
      extractedData: { salesRatio: 25 },
      company: { stockCode: '000100', market: 'KOSPI' },
    });
    const { prisma, created } = buildPrisma({
      events: [evt],
      pricedStockCodes: ['000100'],
      financials: [
        {
          corpCode: '00100000',
          revenue: 500_000_000,
          revenueGrowthYoY: 40,
          operatingProfitGrowthYoY: 35,
          epsGrowthYoY: 20,
        },
      ],
      filedFacts: [
        { rcpNo: 'F1', factKey: 'CONTRACT_TO_SALES_RATIO', numericValue: 40 },
      ],
    });
    await makeService(prisma).generateMissingSignals('MANUAL');

    // 성장률 맵(loadGrowthMap)·본문 정량값 맵(loadFiledFactMap)을 실제 조회 (연결 증거)
    expect(prisma.dartFiledFact.findMany).toHaveBeenCalledTimes(1);
    const factWhere = (prisma.dartFiledFact.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(factWhere.rcpNo.in).toContain('F1');
    expect(factWhere.factKey.in).toEqual(
      expect.arrayContaining(['CONTRACT_TO_SALES_RATIO', 'DILUTION_RATE']),
    );

    // fundamental 버킷이 양(+)으로 채점되어 활성화됨 (성장률·계약규모 → 신호 반영)
    expect(created.length).toBe(4);
    for (const row of created) {
      expect(row.scoreBreakdown.fundamental).toBeGreaterThan(0);
    }
  });

  // DAR-100 회귀 0: 성장률·정량값 결측 종목은 fundamental 결측 → 재정규화 제외(점수 불변)
  it('재무 성장률·본문 정량값 결측 시 fundamental 결측 처리(scoreBreakdown.fundamental=0)', async () => {
    const { prisma, created } = buildPrisma({
      events: [makeEvent({ rcpNo: 'NF1' })],
      pricedStockCodes: ['000100'],
      // financials·filedFacts 미주입 → fundamental 결측
    });
    await makeService(prisma).generateMissingSignals('MANUAL');

    expect(created.length).toBe(4);
    for (const row of created) {
      expect(row.scoreBreakdown.fundamental).toBe(0);
    }
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

  it('멱등: upsert 동시 insert 레이스 유니크 충돌(P2002)은 스킵으로 처리된다', async () => {
    const upsertImpl = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
    });
    const { prisma } = buildPrisma({
      events: [makeEvent()],
      pricedStockCodes: ['000100'],
      upsertImpl,
    });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(4);
  });

  // DAR-125: 원천 멱등화 — 신호 생성부는 자연키 (corpCode, rcpNo, eventType, persona)
  //   upsert 로 영속한다. create+P2002캐치가 아니라 upsert 단일 진입을 검증.
  it('DAR-125: 신규 신호는 자연키 (corpCode, rcpNo, eventType, persona) upsert 로 생성한다', async () => {
    const { prisma, upsertCalls } = buildPrisma({
      events: [
        makeEvent({
          rcpNo: 'Z1',
          corpCode: '00100000',
          eventType: 'SHARE_BUYBACK',
          company: { stockCode: '000100', market: 'KOSPI' },
        }),
      ],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    const result = await service.generateMissingSignals('MANUAL');

    // create() 는 호출되지 않고 upsert() 로만 영속 (4 Persona)
    expect((prisma.tradingSignal.create as jest.Mock)).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(4);
    expect(result.created).toBe(4);
    // where 키가 자연키 전체 그레인인지
    const personas = upsertCalls
      .map((c) => c.where.corpCode_rcpNo_eventType_persona)
      .sort((a, b) => a.persona.localeCompare(b.persona));
    expect(personas).toEqual([
      { corpCode: '00100000', rcpNo: 'Z1', eventType: 'SHARE_BUYBACK', persona: 'EVENT_DRIVEN' },
      { corpCode: '00100000', rcpNo: 'Z1', eventType: 'SHARE_BUYBACK', persona: 'GROWTH' },
      { corpCode: '00100000', rcpNo: 'Z1', eventType: 'SHARE_BUYBACK', persona: 'MOMENTUM' },
      { corpCode: '00100000', rcpNo: 'Z1', eventType: 'SHARE_BUYBACK', persona: 'VALUE' },
    ]);
  });

  // DAR-125: 재생성(overwrite) 은 기존 행을 upsert 로 갱신 — 신규 생성/중복 0.
  it('DAR-125: 재생성 시 기존 신호를 upsert 갱신하고 신규 생성은 0 (멱등)', async () => {
    const { prisma, upsertCalls } = buildPrisma({
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

    const result = await service.regenerateSignals('MANUAL');

    // 4건 모두 기존 → 갱신(updated), 신규 0. upsert 는 4회 호출(재채점).
    expect(result.created).toBe(0);
    expect(result.updated).toBe(4);
    expect(upsertCalls).toHaveLength(4);
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
        // DAR-324/325: tier 인식 래더가 status 로 fine/coarse READY·PRELIM 을 가른다.
        status: over.status ?? 'READY',
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

  // ── DAR-325: 부모(coarse) 버킷 tier 인식 래더 ──────────────────────
  describe('resolveEventStudy tier 래더 (DAR-325)', () => {
    const ET = 'SHARE_BUYBACK';
    const MKT = 'KOSPI';
    // SHARE_BUYBACK + extractedData {} → 'SHARE_BUYBACK__ratio_lt1'
    const FINE = 'SHARE_BUYBACK__ratio_lt1';
    const COARSE = '__ALL__';

    function stat(over: Partial<any> = {}) {
      return {
        avgArD5: over.avgArD5 ?? 5,
        isSignificant: over.isSignificant ?? true,
        upProbD5: over.upProbD5 ?? 0.5,
        crashProbD5: over.crashProbD5 ?? 0,
        sampleCount: over.sampleCount ?? 40,
        status: over.status ?? 'READY',
      };
    }

    function resolve(
      bucketEntries: [string, any][],
      aggEntries: [string, any][] = [],
    ) {
      const { prisma } = buildPrisma({ events: [], pricedStockCodes: [] });
      const service: any = makeService(prisma);
      const maps = { bucket: new Map(bucketEntries), agg: new Map(aggEntries) };
      return service.resolveEventStudy(
        maps,
        { eventType: ET, isAmendment: false, extractedData: {} },
        MKT,
      );
    }

    it('(a) fine 소표본·coarse 충분 → coarse READY 선택', () => {
      const r = resolve([
        [`${ET}::${MKT}::${FINE}`, stat({ status: 'PRELIMINARY', sampleCount: 12 })],
        [`${ET}::${MKT}::${COARSE}`, stat({ status: 'READY', sampleCount: 45 })],
      ]);
      expect(r.esrTier).toBe('COARSE_READY');
      expect(r.sampleCount).toBe(45);
    });

    it('(b) fine READY 존재 → fine 우선(coarse 로 덮어쓰지 않음)', () => {
      const r = resolve([
        [`${ET}::${MKT}::${FINE}`, stat({ status: 'READY', sampleCount: 35, avgArD5: 7 })],
        [`${ET}::${MKT}::${COARSE}`, stat({ status: 'READY', sampleCount: 90, avgArD5: 2 })],
      ]);
      expect(r.esrTier).toBe('FINE_READY');
      expect(r.avgArD5).toBe(7); // fine 통계가 쓰인다
    });

    it('coarse READY 없으면 fine PRELIM > coarse PRELIM', () => {
      const r = resolve([
        [`${ET}::${MKT}::${FINE}`, stat({ status: 'PRELIMINARY', sampleCount: 20 })],
        [`${ET}::${MKT}::${COARSE}`, stat({ status: 'PRELIMINARY', sampleCount: 25 })],
      ]);
      expect(r.esrTier).toBe('FINE_PRELIM');
    });

    it('fine 없고 coarse PRELIM 만 → coarse PRELIM', () => {
      const r = resolve([
        [`${ET}::${MKT}::${COARSE}`, stat({ status: 'PRELIMINARY', sampleCount: 18 })],
      ]);
      expect(r.esrTier).toBe('COARSE_PRELIM');
    });

    it('(c) fine·coarse 모두 미달 → 기존 agg 폴백 유지', () => {
      const r = resolve([], [[`${ET}::${MKT}`, stat({ sampleCount: 60 })]]);
      expect(r.esrTier).toBe('AGG');
    });

    it('within-market 전무 → ALL 폴백(fine→coarse→agg 순)', () => {
      expect(resolve([[`${ET}::ALL::${FINE}`, stat()]]).esrTier).toBe('ALL_FINE');
      expect(resolve([[`${ET}::ALL::${COARSE}`, stat()]]).esrTier).toBe('ALL_COARSE');
      expect(resolve([], [[`${ET}::ALL`, stat()]]).esrTier).toBe('ALL_AGG');
    });

    it('완전 미스 → null (결측 처리)', () => {
      expect(resolve([])).toBeNull();
    });

    it('맵 캐시 값 불변 — esrTier 는 반환 사본에만 부여', () => {
      const cached = stat({ status: 'READY' });
      const r = resolve([[`${ET}::${MKT}::${FINE}`, cached]]);
      expect(r.esrTier).toBe('FINE_READY');
      expect((cached as any).esrTier).toBeUndefined();
    });
  });

  // ── DAR-325 게이트 (d): 부모 풀링 단독으로 BUY 격상 금지 ──────────
  describe('부모(coarse) 풀링은 단독으로 미분류 신호를 BUY 로 격상시키지 않는다 (DAR-325)', () => {
    // CB_ISSUANCE(base -40)·NEUTRAL: 공시이벤트/persona 가 낮아 baseline 은 BUY 미만.
    //   coarse READY 의 강한 양(+) historicalEvent(가중 ~9%)만으로는 임계(60)를 못 넘는다.
    const cbEvent = () =>
      makeEvent({
        rcpNo: '20260101000099',
        eventType: 'CB_ISSUANCE',
        polarity: 'NEUTRAL',
        extractedData: {},
      });

    function buyTier(dist: Record<string, number>) {
      return (dist.BUY_CANDIDATE ?? 0) + (dist.STRONG_BUY_CANDIDATE ?? 0);
    }

    it('coarse 단독(fine 결측)으로는 BUY-tier 가 baseline 대비 늘지 않는다', async () => {
      // baseline: ESR 전무
      const base = await makeService(
        buildPrisma({ events: [cbEvent()], pricedStockCodes: ['000100'] }).prisma,
      ).generateMissingSignals('MANUAL');

      // coarse 단독 READY 양(+) ESR 주입 (fine 버킷은 없음)
      const withCoarse = await makeService(
        buildPrisma({
          events: [cbEvent()],
          pricedStockCodes: ['000100'],
          esrRows: [
            {
              eventType: 'CB_ISSUANCE',
              marketType: 'KOSPI',
              bucketKey: '__ALL__',
              avgArD5: 8,
              isSignificant: true,
              upProbD5: 0.7,
              crashProbD5: 0,
              sampleCount: 45,
              status: 'READY',
            },
          ],
        }).prisma,
      ).generateMissingSignals('MANUAL');

      // 부모 풀링이 단독으로 어떤 persona 도 BUY 로 격상시키지 않는다
      expect(buyTier(base.gradeDist)).toBe(0);
      expect(buyTier(withCoarse.gradeDist)).toBe(0);
      expect(withCoarse.gradeDist.STRONG_BUY_CANDIDATE ?? 0).toBe(0);
    });
  });

  // ── DAR-91: calibration 등급 보정계수 → calibratedConfidence 환류 ──────
  describe('calibration 등급 보정계수 환류 (DAR-91)', () => {
    /** 모든 등급에 동일 계수를 부여한 가짜 calibration(서비스는 result.signal 로 조회) */
    function fakeAccuracy(coefficient: number, throws = false) {
      const grades = [
        'STRONG_BUY_CANDIDATE',
        'BUY_CANDIDATE',
        'WATCH',
        'NEUTRAL',
        'AVOID',
        'BLOCKED',
      ];
      const getCalibration = jest.fn(async () => {
        if (throws) throw new Error('calibration boom');
        return {
          gradeConfidenceCalibrationsD20: grades.map((grade) => ({
            grade,
            coefficient,
          })),
        };
      });
      return { getCalibration } as any;
    }

    function makeServiceWithAccuracy(prisma: any, accuracy: any) {
      // 3번째 인자(notifyProducer)는 undefined, 4번째에 accuracy 주입
      return new SignalGenerationService(prisma, new BuySignalService(), undefined, accuracy);
    }

    it('보정계수<1 적용: calibratedConfidence = round(buyScore × 계수), 원본 buyScore 보존', async () => {
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
      });
      const accuracy = fakeAccuracy(0.5);
      const result = await makeServiceWithAccuracy(prisma, accuracy).generateMissingSignals('MANUAL');

      expect(result.created).toBe(4);
      // getCalibration 이 실제로 1회 호출되어 환류 배선됨(연결 증거)
      expect(accuracy.getCalibration).toHaveBeenCalledTimes(1);
      for (const row of created) {
        // 원본 buyScore 는 그대로, calibratedConfidence 는 디스카운트된 별도 값
        expect(row.calibratedConfidence).toBe(Math.round(row.buyScore * 0.5));
        expect(typeof row.buyScore).toBe('number');
      }
    });

    it('보정계수 1.0(무보정·정렬): calibratedConfidence = buyScore', async () => {
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
      });
      await makeServiceWithAccuracy(prisma, fakeAccuracy(1.0)).generateMissingSignals('MANUAL');
      for (const row of created) {
        expect(row.calibratedConfidence).toBe(row.buyScore);
      }
    });

    it('accuracy 미주입 → 무보정(계수 1.0): calibratedConfidence = buyScore', async () => {
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
      });
      // makeService 는 accuracy 미주입
      await makeService(prisma).generateMissingSignals('MANUAL');
      for (const row of created) {
        expect(row.calibratedConfidence).toBe(row.buyScore);
      }
    });

    it('calibration 조회 실패 → graceful 무보정(계수 1.0), 신호 생성은 지속', async () => {
      const { prisma, created } = buildPrisma({
        events: [makeEvent()],
        pricedStockCodes: ['000100'],
      });
      const result = await makeServiceWithAccuracy(
        prisma,
        fakeAccuracy(0.5, true),
      ).generateMissingSignals('MANUAL');
      expect(result.created).toBe(4);
      for (const row of created) {
        expect(row.calibratedConfidence).toBe(row.buyScore);
      }
    });
  });
});
