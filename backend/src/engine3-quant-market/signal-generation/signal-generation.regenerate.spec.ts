import { SignalGenerationService } from './signal-generation.service';
import { BuySignalService } from '../buy-signal/buy-signal.service';

/**
 * DAR-50: 신호 재생성·재채점(regenerate) — 기존 신호 upsert 갱신 + TI 백필 반영(entryReady 해금).
 */
describe('SignalGenerationService.regenerate (DAR-50)', () => {
  const event = {
    rcpNo: 'R1',
    corpCode: '00100000',
    eventType: 'SHARE_BUYBACK',
    polarity: 'POSITIVE',
    isAmendment: false,
    extractedData: {},
    company: { stockCode: '000100', market: 'KOSPI' },
  };

  /** bullishTI=true 면 종가>ma20·rsi 정상 → entryReady 해금 */
  function buildPrisma(bullishTI: boolean, existing: { rcpNo: string; persona: string }[]) {
    const updates: any[] = [];
    const creates: any[] = [];
    const prisma = {
      stockDailyPrice: {
        findMany: jest.fn(async () => [{ stockCode: '000100' }]),
        findFirst: jest.fn(async () => ({
          stockCode: '000100',
          closePrice: 12000,
          volume: BigInt(500000),
          tradingValue: BigInt(5_000_000_000),
          tradeDate: '20260160',
        })),
      },
      disclosureEvent: { findMany: jest.fn(async () => [event]) },
      tradingSignal: {
        findMany: jest.fn(async () => existing),
        // DAR-125: 신호 생성부는 자연키 upsert. 실제 upsert 의미를 모사 —
        //   where 키가 기존 신호면 update 페이로드, 아니면 create 페이로드로 기록.
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const k = where.corpCode_rcpNo_eventType_persona;
          const isExisting = existing.some(
            (e) => e.rcpNo === k.rcpNo && e.persona === k.persona,
          );
          if (isExisting) {
            updates.push(update);
            return { ...update, id: 'sig' };
          }
          creates.push(create);
          return { ...create, id: 'sig' };
        }),
      },
      technicalIndicator: {
        findFirst: jest.fn(async () =>
          bullishTI
            ? {
                ma5: 11800,
                ma20: 10000,
                ma60: 9000,
                rsi14: 55,
                macdLine: 50,
                macdSignal: 20,
                bollingerMid: 10500,
                volumeRatio20: 1.5,
                preDsclReturn: 2,
              }
            : null,
        ),
      },
      stockStatus: { findUnique: jest.fn(async () => null) },
      marketIndex: { findMany: jest.fn(async () => []) },
      eventStudyResult: { findMany: jest.fn(async () => []) },
      disclosureAnalysis: { findMany: jest.fn(async () => []) },
      companyFinancial: { findMany: jest.fn(async () => []) },
    };
    return { prisma, updates, creates };
  }

  const allPersonas = [
    { rcpNo: 'R1', persona: 'GROWTH' },
    { rcpNo: 'R1', persona: 'VALUE' },
    { rcpNo: 'R1', persona: 'MOMENTUM' },
    { rcpNo: 'R1', persona: 'EVENT_DRIVEN' },
  ];

  it('regenerate 는 기존 (rcpNo,persona) 신호를 update 로 재채점한다 (created 0, updated 4)', async () => {
    const { prisma, updates, creates } = buildPrisma(true, allPersonas);
    const service = new SignalGenerationService(prisma as any, new BuySignalService());

    const result = await service.regenerateSignals('MANUAL');

    expect(result.created).toBe(0);
    expect(result.updated).toBe(4);
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(4);
  });

  it('TI 백필(bullish) 후 재채점하면 entryReady=true 가 발생한다 (ABOVE_MA20 해금)', async () => {
    const { prisma, updates } = buildPrisma(true, allPersonas);
    const service = new SignalGenerationService(prisma as any, new BuySignalService());

    await service.regenerateSignals('MANUAL');

    // 종가 12000 > ma20 10000 → 필수 진입조건 충족
    expect(updates.some((u) => u.entryReady === true)).toBe(true);
  });

  it('TI 부재(지표 null)면 entryReady=false (백필 전 상태 — 모의매수 막힘 재현)', async () => {
    const { prisma, updates } = buildPrisma(false, allPersonas);
    const service = new SignalGenerationService(prisma as any, new BuySignalService());

    await service.regenerateSignals('MANUAL');

    expect(updates.every((u) => u.entryReady === false)).toBe(true);
  });

  it('누락 신호는 regenerate 시 신규 생성한다', async () => {
    // 기존 신호 없음 → 4건 신규 create
    const { prisma, updates, creates } = buildPrisma(true, []);
    const service = new SignalGenerationService(prisma as any, new BuySignalService());

    const result = await service.regenerateSignals('MANUAL');

    expect(result.created).toBe(4);
    expect(result.updated).toBe(0);
    expect(creates).toHaveLength(4);
    expect(updates).toHaveLength(0);
  });
});
