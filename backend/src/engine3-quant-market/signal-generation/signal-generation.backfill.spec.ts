import { SignalGenerationService } from './signal-generation.service';
import { BuySignalService } from '../buy-signal/buy-signal.service';

/**
 * DAR-389: 과거 공시 point-in-time 신호 백필.
 *
 * 핵심 단언:
 *  - 대상은 isBackfill=true 공시(라이브 경로의 정반대 필터).
 *  - ★엄격 point-in-time(lookahead 0): 가격·기술지표·지수 조회가 공시일(rcpDt) 이후 데이터를
 *    절대 참조하지 않는다(tradeDate ≤ rcpDt as-of 상한).
 *  - 신호 발생 시점(rcpDt)이 연중 분포 → 월별 분포가 여러 달에 퍼진다.
 *  - 멱등(기존 신호 skip)·calibration 미적용(calibratedConfidence = buyScore)·통지 enqueue 0·AI 0.
 */
describe('SignalGenerationService.generateBackfillSignals (DAR-389)', () => {
  function makeEvent(rcpNo: string, rcpDt: string, over: Partial<any> = {}) {
    return {
      rcpNo,
      corpCode: over.corpCode ?? '00100000',
      eventType: over.eventType ?? 'SHARE_BUYBACK',
      polarity: over.polarity ?? 'POSITIVE',
      isAmendment: over.isAmendment ?? false,
      extractedData: over.extractedData ?? {},
      company: over.company ?? { stockCode: '000100', market: 'KOSPI' },
      disclosure: { rcpDt },
    };
  }

  function buildPrisma(opts: {
    pages: any[][]; // disclosureEvent.findMany 페이지(커서 순회)
    pricedStockCodes: string[];
    existingSignals?: { rcpNo: string; persona: string }[];
  }) {
    const upsertCalls: any[] = [];
    const priceWheres: any[] = [];
    const tiWheres: any[] = [];
    const marketWheres: any[] = [];
    const eventWheres: any[] = [];
    let pageIdx = 0;

    const prisma = {
      stockDailyPrice: {
        findMany: jest.fn(async () =>
          opts.pricedStockCodes.map((stockCode) => ({ stockCode })),
        ),
        findFirst: jest.fn(async ({ where }: any) => {
          priceWheres.push(where);
          return {
            stockCode: where.stockCode,
            closePrice: 10000,
            volume: BigInt(500000),
            tradingValue: BigInt(5_000_000_000),
            tradeDate: '20250101',
          };
        }),
      },
      technicalIndicator: {
        findFirst: jest.fn(async ({ where }: any) => {
          tiWheres.push(where);
          return null;
        }),
      },
      stockStatus: {
        findUnique: jest.fn(async () => null),
      },
      marketIndex: {
        findMany: jest.fn(async ({ where }: any) => {
          marketWheres.push(where);
          return [];
        }),
      },
      eventStudyResult: { findMany: jest.fn(async () => []) },
      disclosureAnalysis: { findMany: jest.fn(async () => []) },
      companyFinancial: { findMany: jest.fn(async () => []) },
      insiderHoldingChange: { findMany: jest.fn(async () => []) },
      dartFiledFact: { findMany: jest.fn(async () => []) },
      disclosureEvent: {
        findMany: jest.fn(async ({ where }: any) => {
          eventWheres.push(where);
          const page = opts.pages[pageIdx] ?? [];
          pageIdx++;
          return page;
        }),
      },
      tradingSignal: {
        findMany: jest.fn(async () => opts.existingSignals ?? []),
        upsert: jest.fn(async (args: any) => {
          upsertCalls.push(args);
          return { id: `sig_${upsertCalls.length}` };
        }),
      },
    };
    return { prisma, upsertCalls, priceWheres, tiWheres, marketWheres, eventWheres };
  }

  function makeService(prisma: any, extra?: { notify?: any; accuracy?: any }) {
    return new SignalGenerationService(
      prisma,
      new BuySignalService(),
      extra?.notify,
      extra?.accuracy,
    );
  }

  it('isBackfill=true 공시만 대상으로 한다 (라이브 경로의 정반대 필터)', async () => {
    const { prisma, eventWheres } = buildPrisma({
      pages: [[makeEvent('20250815000001', '20250815')], []],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    await service.generateBackfillSignals();

    expect(eventWheres[0].disclosure.isBackfill).toBe(true);
  });

  it('★point-in-time: 가격·지표·지수를 공시일(rcpDt) 이후로 절대 조회하지 않는다(as-of 상한)', async () => {
    const { prisma, priceWheres, tiWheres, marketWheres } = buildPrisma({
      pages: [
        [
          makeEvent('20250815000001', '20250815'),
          makeEvent('20260120120000', '20260120120000'), // 14자리 시각 포함
        ],
        [],
      ],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    await service.generateBackfillSignals();

    // 가격 조회: 두 공시 각각의 rcpDt 앞8자리 상한으로만 절단.
    const priceCeils = priceWheres.map((w) => w.tradeDate?.lte).sort();
    expect(priceCeils).toEqual(['20250815', '20260120']);
    // 기술지표 동일.
    const tiCeils = tiWheres.map((w) => w.tradeDate?.lte).sort();
    expect(tiCeils).toEqual(['20250815', '20260120']);
    // 지수도 as-of 상한.
    const marketCeils = Array.from(
      new Set(marketWheres.map((w) => w.tradeDate?.lte)),
    ).sort();
    expect(marketCeils).toEqual(['20250815', '20260120']);
    // 어떤 조회도 상한 없는(미래 포함) 형태가 아니어야 한다.
    for (const w of [...priceWheres, ...tiWheres]) {
      expect(w.tradeDate?.lte).toBeDefined();
    }
  });

  it('신호 월별 분포가 연중으로 퍼진다 (rcpDt 기준)', async () => {
    const events = [
      makeEvent('A', '20250701', { corpCode: '001', company: { stockCode: '000100', market: 'KOSPI' } }),
      makeEvent('B', '20251015', { corpCode: '002', company: { stockCode: '000200', market: 'KOSPI' } }),
      makeEvent('C', '20260205', { corpCode: '003', company: { stockCode: '000300', market: 'KOSDAQ' } }),
    ];
    const { prisma } = buildPrisma({
      pages: [events, []],
      pricedStockCodes: ['000100', '000200', '000300'],
    });
    const service = makeService(prisma);

    const result = await service.generateBackfillSignals();

    // 3 공시 × 4 persona = 12 신호. 월별 키 3개로 분산.
    expect(result.created).toBe(12);
    expect(Object.keys(result.monthlyDist).sort()).toEqual([
      '202507',
      '202510',
      '202602',
    ]);
    expect(result.monthlyDist['202507']).toBe(4);
    expect(result.monthlyDist['202510']).toBe(4);
    expect(result.monthlyDist['202602']).toBe(4);
  });

  it('멱등: 이미 존재하는 (rcpNo, persona) 신호는 skip 한다', async () => {
    const { prisma, upsertCalls } = buildPrisma({
      pages: [[makeEvent('20250815000001', '20250815')], []],
      pricedStockCodes: ['000100'],
      existingSignals: [
        { rcpNo: '20250815000001', persona: 'GROWTH' },
        { rcpNo: '20250815000001', persona: 'VALUE' },
      ],
    });
    const service = makeService(prisma);

    const result = await service.generateBackfillSignals();

    expect(result.skipped).toBe(2); // GROWTH/VALUE 기존 → skip
    expect(result.created).toBe(2); // MOMENTUM/EVENT_DRIVEN 신규
    expect(upsertCalls).toHaveLength(2);
  });

  it('calibration 미적용(calibratedConfidence = buyScore)·통지 enqueue 0·AI 0', async () => {
    const notify = { enqueueSignal: jest.fn(async () => undefined) };
    const accuracy = { getCalibration: jest.fn(async () => ({ gradeConfidenceCalibrationsD20: [] })) };
    const { prisma, upsertCalls } = buildPrisma({
      pages: [[makeEvent('20250815000001', '20250815')], []],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma, { notify, accuracy });

    await service.generateBackfillSignals();

    // 통지 enqueue 0 — 과거 신호는 푸시 대상 아님.
    expect(notify.enqueueSignal).not.toHaveBeenCalled();
    // calibration 미조회 — 백필은 보정계수 미적용.
    expect(accuracy.getCalibration).not.toHaveBeenCalled();
    // calibratedConfidence = buyScore (보정 0).
    for (const call of upsertCalls) {
      expect(call.create.calibratedConfidence).toBe(call.create.buyScore);
    }
  });

  it('rcpDt 범위 옵션을 disclosure.rcpDt gte/lte(종일 ceil)로 적용한다', async () => {
    const { prisma, eventWheres } = buildPrisma({
      pages: [[], []],
      pricedStockCodes: ['000100'],
    });
    const service = makeService(prisma);

    await service.generateBackfillSignals({
      startRcpDt: '20250601',
      endRcpDt: '20260531',
    });

    expect(eventWheres[0].disclosure.rcpDt).toEqual({
      gte: '20250601',
      lte: '20260531999999',
    });
  });

  it('커서 페이지네이션으로 여러 배치를 순회한다', async () => {
    const { prisma, eventWheres } = buildPrisma({
      pages: [
        [makeEvent('A', '20250701', { corpCode: '001', company: { stockCode: '000100', market: 'KOSPI' } })],
        [makeEvent('B', '20250801', { corpCode: '002', company: { stockCode: '000200', market: 'KOSPI' } })],
        [],
      ],
      pricedStockCodes: ['000100', '000200'],
    });
    const service = makeService(prisma);

    const result = await service.generateBackfillSignals({ batchSize: 1 });

    // batchSize=1 → 풀페이지마다 다음 페이지 조회. 두 번째 호출은 cursor 사용.
    expect(eventWheres.length).toBeGreaterThanOrEqual(2);
    expect(result.batches).toBe(2);
    expect(result.created).toBe(8); // 2 공시 × 4 persona
  });
});
