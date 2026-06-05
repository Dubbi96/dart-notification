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
        findMany: jest.fn(async () => []),
      },
      disclosureAnalysis: {
        findMany: jest.fn(async () => []),
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
});
