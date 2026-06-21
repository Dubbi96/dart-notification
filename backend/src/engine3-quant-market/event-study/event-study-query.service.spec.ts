/**
 * event-study-query.service.spec.ts — 버킷 관측치 드릴다운 조회 (DAR-166)
 *
 * 모킹 PrismaService 로 findObservations 의 페이지네이션·정합·기업명 조인·빈 버킷 흡수를 검증한다.
 */
import { EventStudyQueryService } from './event-study-query.service';

function makeObs(idx: number, bucketKey = 'SUPPLY_CONTRACT__ratio_5to20') {
  return {
    id: `obs-${idx}`,
    eventId: `evt-${idx}`,
    rcpNo: `rcp-${idx}`,
    corpCode: `corp-${idx}`,
    eventType: 'SUPPLY_CONTRACT',
    bucketKey,
    d0Date: `2025010${idx}`,
    dailyReturns: { d1: 5 },
    dailyAR: { d1: 5 },
    cumulativeAR: { d5: 5.2 + idx, d20: 7.1 + idx },
    volumeRatios: { d1: 3.2 },
    maxDrawdown: -2.3,
    isUpD5: true,
    isCrashD5: false,
  };
}

function makePrisma(obsRows: any[], companies: any[]) {
  let obsWhere: any = null;
  let obsArgs: any = null;
  return {
    eventStudyObservation: {
      count: jest.fn(async (arg: any) => {
        obsWhere = arg.where;
        return obsRows.length;
      }),
      findMany: jest.fn(async (arg: any) => {
        obsArgs = arg;
        const start = arg.skip ?? 0;
        return obsRows.slice(start, start + (arg.take ?? obsRows.length));
      }),
    },
    company: {
      findMany: jest.fn(async () => companies),
    },
    getObsWhere: () => obsWhere,
    getObsArgs: () => obsArgs,
  };
}

describe('EventStudyQueryService.findObservations()', () => {
  it('returns paginated observations with CAR summary and company name', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeObs(i + 1));
    const companies = rows.map(r => ({
      corpCode: r.corpCode,
      corpName: `회사-${r.corpCode}`,
      stockCode: '005930',
    }));
    const prisma = makePrisma(rows, companies);
    const svc = new EventStudyQueryService(prisma as any);

    const result = await svc.findObservations({
      bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
      limit: 20,
    });

    expect(result.bucketKey).toBe('SUPPLY_CONTRACT__ratio_5to20');
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(false);

    const first = result.items[0];
    expect(first.corpName).toBe('회사-corp-1');
    expect(first.stockCode).toBe('005930');
    expect(first.carD5).toBeCloseTo(6.2, 5); // cumulativeAR.d5 (idx=1)
    expect(first.carD20).toBeCloseTo(8.1, 5);
    expect(first.isUpD5).toBe(true);
    expect(first.bucketKey).toBe('SUPPLY_CONTRACT__ratio_5to20');

    // 조회는 bucketKey where + d0Date desc 정렬
    expect(prisma.getObsWhere()).toEqual({ bucketKey: 'SUPPLY_CONTRACT__ratio_5to20' });
    expect(prisma.getObsArgs().orderBy[0]).toEqual({ d0Date: 'desc' });
  });

  it('computes hasMore from total vs offset+page', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeObs(i + 1));
    const prisma = makePrisma(rows, []);
    const svc = new EventStudyQueryService(prisma as any);

    const page1 = await svc.findObservations({
      bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
      limit: 20,
      offset: 0,
    });
    expect(page1.total).toBe(50);
    expect(page1.items).toHaveLength(20);
    expect(page1.hasMore).toBe(true);
    expect(page1.items[0].corpName).toBeNull(); // 기업 미존재 → null 흡수
  });

  it('clamps limit to 1..100 (default 20) and floors offset', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeObs(i + 1));
    const prisma = makePrisma(rows, []);
    const svc = new EventStudyQueryService(prisma as any);

    const r1 = await svc.findObservations({ bucketKey: 'X', limit: 0 });
    expect(r1.limit).toBe(20); // 0 → 기본 20
    const r2 = await svc.findObservations({ bucketKey: 'X', limit: 999 });
    expect(r2.limit).toBe(100); // 상한 100
    const r3 = await svc.findObservations({ bucketKey: 'X', offset: -5 });
    expect(r3.offset).toBe(0); // 음수 → 0
  });

  it('absorbs empty bucket → items=[] (no company lookup)', async () => {
    const prisma = makePrisma([], []);
    const svc = new EventStudyQueryService(prisma as any);

    const result = await svc.findObservations({ bucketKey: 'EMPTY__bucket' });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it('applies optional eventType filter alongside bucketKey', async () => {
    const rows = [makeObs(1)];
    const prisma = makePrisma(rows, []);
    const svc = new EventStudyQueryService(prisma as any);

    await svc.findObservations({
      bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
      eventType: 'SUPPLY_CONTRACT',
    });

    expect(prisma.getObsWhere()).toEqual({
      bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
      eventType: 'SUPPLY_CONTRACT',
    });
  });
});

/**
 * findResultsByCorpCode() — 기업별 이벤트 스터디 통계 (DAR-190)
 *
 * 기업 보유 공시 유형 → 시장 전체 EventStudyResult 매핑. 공시 0건이면 빈 배열(에러 아님).
 */
function makeCorpPrisma(eventTypes: string[], results: any[]) {
  let resultWhere: any = null;
  return {
    disclosureEvent: {
      findMany: jest.fn(async () => eventTypes.map((eventType) => ({ eventType }))),
    },
    eventStudyResult: {
      findMany: jest.fn(async (arg: any) => {
        resultWhere = arg.where;
        return results;
      }),
    },
    getResultWhere: () => resultWhere,
  };
}

describe('EventStudyQueryService.findResultsByCorpCode()', () => {
  it('maps company disclosure event types to market-wide results (default ALL/READY)', async () => {
    const prisma = makeCorpPrisma(
      ['SUPPLY_CONTRACT', 'PAID_CAPITAL_INCREASE'],
      [{ id: 'r1', eventType: 'SUPPLY_CONTRACT' }],
    );
    const svc = new EventStudyQueryService(prisma as any);

    const out = await svc.findResultsByCorpCode({ corpCode: '00126380' });

    expect(out).toHaveLength(1);
    expect(prisma.disclosureEvent.findMany).toHaveBeenCalledWith({
      where: { corpCode: '00126380' },
      select: { eventType: true },
      distinct: ['eventType'],
    });
    expect(prisma.getResultWhere()).toEqual({
      eventType: { in: ['SUPPLY_CONTRACT', 'PAID_CAPITAL_INCREASE'] },
      marketType: 'ALL',
      status: 'READY',
    });
  });

  it('returns [] without querying results when the company has no disclosure events', async () => {
    const prisma = makeCorpPrisma([], []);
    const svc = new EventStudyQueryService(prisma as any);

    const out = await svc.findResultsByCorpCode({ corpCode: 'NEW_CORP' });

    expect(out).toEqual([]);
    expect(prisma.eventStudyResult.findMany).not.toHaveBeenCalled();
  });

  it('intersects eventType query with the company-owned types', async () => {
    const prisma = makeCorpPrisma(['SUPPLY_CONTRACT', 'BUYBACK'], [{ id: 'r1' }]);
    const svc = new EventStudyQueryService(prisma as any);

    await svc.findResultsByCorpCode({ corpCode: '00126380', eventType: 'BUYBACK' });

    expect(prisma.getResultWhere().eventType).toEqual({ in: ['BUYBACK'] });
  });

  it('returns [] when the requested eventType is not among the company-owned types', async () => {
    const prisma = makeCorpPrisma(['SUPPLY_CONTRACT'], [{ id: 'r1' }]);
    const svc = new EventStudyQueryService(prisma as any);

    const out = await svc.findResultsByCorpCode({ corpCode: '00126380', eventType: 'BUYBACK' });

    expect(out).toEqual([]);
    expect(prisma.eventStudyResult.findMany).not.toHaveBeenCalled();
  });

  it('honors marketType and includeInsufficient', async () => {
    const prisma = makeCorpPrisma(['SUPPLY_CONTRACT'], []);
    const svc = new EventStudyQueryService(prisma as any);

    await svc.findResultsByCorpCode({
      corpCode: '00126380',
      marketType: 'KOSPI',
      includeInsufficient: true,
    });

    expect(prisma.getResultWhere()).toEqual({
      eventType: { in: ['SUPPLY_CONTRACT'] },
      marketType: 'KOSPI',
      status: { in: ['READY', 'INSUFFICIENT'] },
    });
  });
});

// ─── DAR-402: D+N 초과수익 분포(median/p95) 산출 ───
describe('EventStudyQueryService.getDistribution()', () => {
  function makePrismaObs(rows: any[]) {
    return {
      eventStudyObservation: {
        findMany: jest.fn(async () => rows),
      },
    };
  }

  it('관측치 cumulativeAR 에서 D+5/D+20 분포(평균·중앙값·분위수) 산출', async () => {
    // d5: [-3,-3,-3,...(18개), 120, 140] → 산술평균 양수지만 중앙값 음수(오염 표면화)
    const rows = [
      ...Array.from({ length: 18 }, () => ({ cumulativeAR: { d5: -3, d20: -3 } })),
      { cumulativeAR: { d5: 120, d20: 120 } },
      { cumulativeAR: { d5: 140, d20: 140 } },
    ];
    const svc = new EventStudyQueryService(makePrismaObs(rows) as any);
    const dist = await svc.getDistribution({ bucketKey: 'SUPPLY_CONTRACT__ratio_5to20' });

    expect(dist.count).toBe(20);
    expect(dist.d5.count).toBe(20);
    expect(dist.d5.mean).toBeGreaterThan(0); // 이상치 지배
    expect(dist.d5.median).toBeLessThan(0); // 전형값 음수
    expect(dist.d5.median).toBeCloseTo(-3, 6);
    expect(dist.d5.p95).toBeGreaterThan(0); // 상위 분위는 이상치
    expect(dist.d20.median).toBeCloseTo(-3, 6);
  });

  it('빈 버킷은 count=0 + null 분포 (에러 아님)', async () => {
    const svc = new EventStudyQueryService(makePrismaObs([]) as any);
    const dist = await svc.getDistribution({ bucketKey: 'EMPTY__bucket' });
    expect(dist.count).toBe(0);
    expect(dist.d5.median).toBeNull();
    expect(dist.d5.p95).toBeNull();
    expect(dist.d20.mean).toBeNull();
  });

  it('cumulativeAR 결측 키는 분포에서 제외 (방어)', async () => {
    const rows = [
      { cumulativeAR: { d5: 1, d20: 2 } },
      { cumulativeAR: {} }, // d5/d20 결측
      { cumulativeAR: { d5: 3, d20: 4 } },
    ];
    const svc = new EventStudyQueryService(makePrismaObs(rows) as any);
    const dist = await svc.getDistribution({ bucketKey: 'X' });
    expect(dist.count).toBe(3); // 행 수
    expect(dist.d5.count).toBe(2); // 유효 d5 값만
    expect(dist.d5.median).toBeCloseTo(2, 6);
  });
});

describe('EventStudyQueryService.findRobustEdges() (DAR-408)', () => {
  function makeResultRow(over: Record<string, unknown>) {
    return {
      eventType: 'X',
      bucketKey: '__ALL__',
      winsorizedMeanArD20: null,
      medianArD20: null,
      avgArD20: 0,
      sampleCount: 30,
      status: 'READY',
      ...over,
    };
  }

  function makePrismaResults(rows: any[]) {
    let where: any = null;
    return {
      eventStudyResult: {
        findMany: jest.fn(async (arg: any) => {
          where = arg.where;
          return rows;
        }),
      },
      getWhere: () => where,
    };
  }

  it('eventType별 대표 버킷으로 robust D+20을 반환하고 marketType/status로 필터한다', async () => {
    const prisma = makePrismaResults([
      makeResultRow({ eventType: 'A', bucketKey: 'A__fine', winsorizedMeanArD20: 1.1, sampleCount: 40 }),
      makeResultRow({ eventType: 'B', bucketKey: 'B__fine', medianArD20: -2.0, sampleCount: 25 }),
    ]);
    const svc = new EventStudyQueryService(prisma as any);

    const edges = await svc.findRobustEdges('ALL');
    expect(edges).toHaveLength(2);
    expect(prisma.getWhere()).toEqual({ marketType: 'ALL', status: { in: ['READY', 'INSUFFICIENT'] } });
  });

  it('동일 eventType 에 coarse(__ALL__) 버킷이 있으면 대표로 우선한다', async () => {
    const prisma = makePrismaResults([
      makeResultRow({ eventType: 'A', bucketKey: 'A__fine', winsorizedMeanArD20: 9, sampleCount: 100 }),
      makeResultRow({ eventType: 'A', bucketKey: '__ALL__', winsorizedMeanArD20: 1, sampleCount: 30 }),
    ]);
    const svc = new EventStudyQueryService(prisma as any);

    const edges = await svc.findRobustEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].bucketKey).toBe('__ALL__'); // 표본 적어도 coarse 우선
    expect(edges[0].winsorizedMeanArD20).toBe(1);
  });

  it('coarse 가 없으면 표본 최다 fine 버킷을 대표로 쓴다', async () => {
    const prisma = makePrismaResults([
      makeResultRow({ eventType: 'A', bucketKey: 'A__small', winsorizedMeanArD20: 9, sampleCount: 10 }),
      makeResultRow({ eventType: 'A', bucketKey: 'A__large', winsorizedMeanArD20: 2, sampleCount: 80 }),
    ]);
    const svc = new EventStudyQueryService(prisma as any);

    const edges = await svc.findRobustEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].bucketKey).toBe('A__large');
  });
});
