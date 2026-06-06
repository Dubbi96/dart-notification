import { CollectionStatusService } from './collection-status.service';

// read-only 집계 서비스 단위 검증 — Prisma 모델 델리게이트를 전부 목으로 대체.
// 외부호출·수집로직·AI 개입이 없음을 (해당 호출이 없다는 점으로) 보장.
describe('CollectionStatusService', () => {
  function makePrisma(overrides: Record<string, any> = {}) {
    return {
      disclosure: { count: jest.fn().mockResolvedValue(0) },
      disclosureCollectionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      companyFinancial: {
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      financialCollectionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      technicalIndicator: {
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      marketDataCollectionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      position: { count: jest.fn().mockResolvedValue(0) },
      paperTrade: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    } as any;
  }

  it('데이터 0건이면 모든 카드 maturity 가 WAITING 이다', async () => {
    const service = new CollectionStatusService(makePrisma());
    const result = await service.getStatus();

    expect(result.disclosure.maturity).toBe('WAITING');
    expect(result.financial.maturity).toBe('WAITING');
    expect(result.indicator.maturity).toBe('WAITING');
    expect(result.simulation.maturity).toBe('WAITING');
    expect(result.disclosure.totalCount).toBe(0);
    expect(result.financial.coveredCompanies).toBe(0);
    expect(result.indicator.coveredStocks).toBe(0);
    expect(result.simulation.openPositions).toBe(0);
    expect(typeof result.generatedAt).toBe('string');
  });

  it('임계치 이상이면 SUFFICIENT, 미만이면 COLLECTING 으로 배지가 분기된다', async () => {
    const prisma = makePrisma({
      disclosure: { count: jest.fn().mockResolvedValue(150) }, // ≥100 → SUFFICIENT
      companyFinancial: {
        groupBy: jest.fn().mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ corpCode: `c${i}` }))), // <50 → COLLECTING
        findFirst: jest.fn().mockResolvedValue({ bsnsYear: '2025', reprtCode: '11014' }),
      },
      technicalIndicator: {
        groupBy: jest.fn().mockResolvedValue(Array.from({ length: 80 }, (_, i) => ({ stockCode: `${i}` }))), // ≥50 → SUFFICIENT
        findFirst: jest.fn().mockResolvedValue({ tradeDate: '20260605' }),
      },
      position: { count: jest.fn().mockResolvedValue(2) }, // <5 → COLLECTING
      paperTrade: {
        count: jest.fn().mockResolvedValue(3),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const service = new CollectionStatusService(prisma);
    const result = await service.getStatus();

    expect(result.disclosure.maturity).toBe('SUFFICIENT');
    expect(result.financial.maturity).toBe('COLLECTING');
    expect(result.financial.coveredCompanies).toBe(10);
    expect(result.financial.latestPeriod).toBe('2025 / 11014');
    expect(result.indicator.maturity).toBe('SUFFICIENT');
    expect(result.indicator.coveredStocks).toBe(80);
    expect(result.indicator.latestTradeDate).toBe('20260605');
    expect(result.simulation.maturity).toBe('COLLECTING');
    expect(result.simulation.totalTrades).toBe(3);
  });

  it('수집 로그의 endedAt 을 우선 ISO 로, 없으면 startedAt 으로 대체한다', async () => {
    const ended = new Date('2026-06-06T02:10:00.000Z');
    const started = new Date('2026-06-06T02:00:00.000Z');
    const prisma = makePrisma({
      disclosureCollectionLog: {
        findFirst: jest.fn().mockResolvedValue({
          startedAt: started,
          endedAt: ended,
          newCount: 87,
          status: 'SUCCESS',
        }),
      },
      financialCollectionLog: {
        findFirst: jest.fn().mockResolvedValue({
          startedAt: started,
          endedAt: null, // 진행중 → startedAt 사용
          status: 'RUNNING',
        }),
      },
    });
    const service = new CollectionStatusService(prisma);
    const result = await service.getStatus();

    expect(result.disclosure.lastCollectedAt).toBe(ended.toISOString());
    expect(result.disclosure.lastNewCount).toBe(87);
    expect(result.disclosure.lastStatus).toBe('SUCCESS');
    expect(result.financial.lastCollectedAt).toBe(started.toISOString());
    expect(result.financial.lastStatus).toBe('RUNNING');
  });

  it('모의 체결 시각이 있으면 ISO 문자열로, 없으면 null 이다', async () => {
    const tradedAt = new Date('2026-06-05T06:30:00.000Z');
    const prisma = makePrisma({
      paperTrade: {
        count: jest.fn().mockResolvedValue(142),
        findFirst: jest.fn().mockResolvedValue({ createdAt: tradedAt }),
      },
      position: { count: jest.fn().mockResolvedValue(7) },
    });
    const service = new CollectionStatusService(prisma);
    const result = await service.getStatus();

    expect(result.simulation.lastTradeAt).toBe(tradedAt.toISOString());
    expect(result.simulation.totalTrades).toBe(142);
    expect(result.simulation.openPositions).toBe(7);
    expect(result.simulation.maturity).toBe('SUFFICIENT'); // ≥5
  });
});
