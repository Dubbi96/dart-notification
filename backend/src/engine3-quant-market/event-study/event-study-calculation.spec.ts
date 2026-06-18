/**
 * event-study-calculation.spec.ts — Event Study 산출 오케스트레이터 테스트 (DAR-133)
 *
 * 실 DB 없이 in-memory 가격 어댑터 + 모킹 PrismaService 로 산출 파이프라인 전체를
 * 결정론적으로 재현한다:
 *   - buildObservation 순수 헬퍼(성숙 요건·D0 스냅·버킷키)
 *   - run() 종단: 적격 공시 → 관측치 → 버킷 집계 → upsert(영속)
 *   - 백필 포함(=isBackfill 미필터) 회귀 가드
 *   - 표본<30 → INSUFFICIENT 영속(데이터한계 표식)
 */
import { EventStudyService } from './event-study.service';
import {
  EventStudyCalculationService,
  EventStudyRawRow,
  buildObservation,
  shiftYmd,
} from './event-study-calculation.service';
import { InMemoryStockPriceAdapter } from './adapters/in-memory-stock-price.adapter';
import { InMemoryMarketIndexAdapter } from './adapters/in-memory-market-index.adapter';
import { IStockDailyPrice } from './ports/stock-price.port';
import { IMarketIndexPrice } from './ports/market-index.port';

// ─── 날짜·가격 픽스처 헬퍼 ────────────────────────────────────────

/** startYmd 로부터 i 달력일 뒤 YYYYMMDD */
function ymdPlus(startYmd: string, i: number): string {
  const y = parseInt(startYmd.slice(0, 4), 10);
  const m = parseInt(startYmd.slice(4, 6), 10) - 1;
  const d = parseInt(startYmd.slice(6, 8), 10);
  const dt = new Date(y, m, d + i);
  const yy = dt.getFullYear().toString();
  const mm = (dt.getMonth() + 1).toString().padStart(2, '0');
  const dd = dt.getDate().toString().padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

const SERIES_START = '20241201';
const SERIES_LEN = 90; // 20241201 ~ 약 20250228 (D0=20250102 충분 성숙)
const D0_INDEX = 32; // 20250102 의 시리즈 인덱스

/** 한 종목의 일별 가격: D0 직전까지 100, D+1(인덱스 D0_INDEX+1)부터 jump */
function makeStockSeries(stockCode: string, jumpPrice = 105): IStockDailyPrice[] {
  return Array.from({ length: SERIES_LEN }, (_, i) => ({
    stockCode,
    tradeDate: ymdPlus(SERIES_START, i),
    closePrice: i <= D0_INDEX ? 100 : jumpPrice,
    volume: 1000,
  }));
}

/** KOSPI 지수 시리즈: 항상 flat 1000 (시장수익률 0) */
function makeIndexSeries(indexCode = '0001'): IMarketIndexPrice[] {
  return Array.from({ length: SERIES_LEN }, (_, i) => ({
    indexCode,
    tradeDate: ymdPlus(SERIES_START, i),
    closeIndex: 1000,
  }));
}

/** SUPPLY_CONTRACT 이벤트 raw row (ratio 10% → __ratio_5to20 버킷) */
function makeRow(idx: number, market = 'KOSPI'): EventStudyRawRow {
  return {
    eventId: `evt-${idx}`,
    rcpNo: `rcp-${idx}`,
    corpCode: `corp-${idx}`,
    stockCode: `stock-${idx}`,
    market,
    eventType: 'SUPPLY_CONTRACT',
    isAmendment: false,
    extractedData: { contractAmount: 1_000_000_000, recentSalesAmount: 10_000_000_000 },
    rcpDt: '20250102090000', // calcD0 → 20250102 (목, ≤15:20)
  };
}

// ─── 1. 순수 헬퍼 ─────────────────────────────────────────────────

describe('shiftYmd()', () => {
  it('adds positive days across month boundary', () => {
    expect(shiftYmd('20250102', 45)).toBe('20250216');
  });
  it('subtracts days across month boundary', () => {
    expect(shiftYmd('20250102', -45)).toBe('20241118');
  });
  it('handles zero', () => {
    expect(shiftYmd('20250102', 0)).toBe('20250102');
  });
});

describe('buildObservation()', () => {
  const stockWin = makeStockSeries('stock-0');
  const indexWin = makeIndexSeries('0001');

  it('builds a valid matured observation with snapped D0 and canonical bucketKey', () => {
    const obs = buildObservation(makeRow(0), stockWin, indexWin);
    expect(obs).not.toBeNull();
    expect(obs!.d0Date).toBe('20250102');
    expect(obs!.bucketKey).toBe('SUPPLY_CONTRACT__ratio_5to20');
    expect(obs!.stockCode).toBe('stock-0');
    // D0=100, D+1=105 → cumulativeAR[d5] ≈ +5 (시장 flat)
  });

  it('returns null when no forward window (immature: <20 forward trading days)', () => {
    // D0 를 시리즈 끝쪽으로 → 전향 거래일 부족
    const shortWin = stockWin.slice(0, D0_INDEX + 5); // D0 이후 4일만
    const obs = buildObservation(makeRow(0), shortWin, indexWin);
    expect(obs).toBeNull();
  });

  it('returns null when D0 target is beyond the window (no aligned date)', () => {
    const pastWin = stockWin.slice(0, 10); // 20241210 까지만 → D0(20250102) 없음
    const obs = buildObservation(makeRow(0), pastWin, indexWin);
    expect(obs).toBeNull();
  });

  it('returns null for empty windows', () => {
    expect(buildObservation(makeRow(0), [], indexWin)).toBeNull();
    expect(buildObservation(makeRow(0), stockWin, [])).toBeNull();
  });

  it('snaps D0 forward to first common trading day when exact D0 is missing', () => {
    // 20250102 행 제거 → 다음 공통일 20250103 으로 스냅
    const gapWin = stockWin.filter(p => p.tradeDate !== '20250102');
    const obs = buildObservation(makeRow(0), gapWin, indexWin);
    expect(obs).not.toBeNull();
    expect(obs!.d0Date).toBe('20250103');
  });
});

// ─── 2. run() 종단 오케스트레이션 ────────────────────────────────

interface UpsertCall {
  where: any;
  create: any;
  update: any;
}

function makePrismaMock(rows: any[]) {
  const upserts: UpsertCall[] = [];
  const obsCreates: any[] = [];
  const obsDeletes: any[] = [];
  let findManyArg: any = null;
  const prisma = {
    disclosureEvent: {
      findMany: jest.fn(async (arg: any) => {
        findManyArg = arg;
        return rows;
      }),
    },
    eventStudyResult: {
      upsert: jest.fn(async (call: UpsertCall) => {
        upserts.push(call);
        return call.create;
      }),
    },
    // DAR-166: 개별 관측치 영속 — delete(멱등) + createMany 캡처
    eventStudyObservation: {
      deleteMany: jest.fn(async (arg: any) => {
        obsDeletes.push(arg);
        return { count: 0 };
      }),
      createMany: jest.fn(async (arg: any) => {
        obsCreates.push(...arg.data);
        return { count: arg.data.length };
      }),
    },
  };
  return {
    prisma,
    upserts,
    getFindManyArg: () => findManyArg,
    getObsCreates: () => obsCreates,
    getObsDeletes: () => obsDeletes,
  };
}

/** prisma findMany select 형태에 맞춘 row (company/disclosure 조인 포함) */
function makeDbEvent(idx: number, market = 'KOSPI', isBackfill = false) {
  return {
    id: `evt-${idx}`,
    rcpNo: `rcp-${idx}`,
    corpCode: `corp-${idx}`,
    eventType: 'SUPPLY_CONTRACT',
    isAmendment: false,
    extractedData: { contractAmount: 1_000_000_000, recentSalesAmount: 10_000_000_000 },
    company: { stockCode: `stock-${idx}`, market },
    disclosure: { rcpDt: '20250102090000' },
    _isBackfill: isBackfill, // 픽스처 표식(실제 쿼리엔 없음)
  };
}

function buildService(dbEvents: any[]) {
  const { prisma, upserts, getFindManyArg, getObsCreates, getObsDeletes } =
    makePrismaMock(dbEvents);
  // 모든 종목 + KOSPI/KOSDAQ 지수 가격을 in-memory 어댑터에 적재
  const stockData: IStockDailyPrice[] = dbEvents.flatMap(e =>
    makeStockSeries(e.company.stockCode),
  );
  const indexData: IMarketIndexPrice[] = [
    ...makeIndexSeries('0001'),
    ...makeIndexSeries('1001'),
  ];
  const service = new EventStudyCalculationService(
    prisma as any,
    new EventStudyService(),
    new InMemoryStockPriceAdapter(stockData),
    new InMemoryMarketIndexAdapter(indexData),
  );
  return { service, upserts, getFindManyArg, getObsCreates, getObsDeletes };
}

describe('EventStudyCalculationService.run()', () => {
  it('aggregates 35 matured KOSPI events → READY, persists KOSPI + ALL buckets', async () => {
    const events = Array.from({ length: 35 }, (_, i) => makeDbEvent(i));
    const { service, upserts } = buildService(events);

    const summary = await service.run();

    expect(summary.eventsScanned).toBe(35);
    expect(summary.observationsBuilt).toBe(35);
    // KOSPI 버킷 + ALL 버킷 = 2 그룹, 둘 다 READY
    expect(summary.groupsAggregated).toBe(2);
    expect(summary.readyCount).toBe(2);
    expect(summary.insufficientCount).toBe(0);

    expect(upserts).toHaveLength(2);
    const markets = upserts.map(u => u.create.marketType).sort();
    expect(markets).toEqual(['ALL', 'KOSPI']);

    // READY 버킷의 핵심 통계: avgArD5 ≈ +5, status READY, 표본 35
    const kospi = upserts.find(u => u.create.marketType === 'KOSPI')!;
    expect(kospi.create.status).toBe('READY');
    expect(kospi.create.sampleCount).toBe(35);
    expect(kospi.create.avgArD5).toBeCloseTo(5, 2);
    expect(kospi.create.eventType).toBe('SUPPLY_CONTRACT');
    expect(kospi.create.bucketKey).toBe('SUPPLY_CONTRACT__ratio_5to20');
    // 자연키 upsert
    expect(kospi.where.eventType_bucketKey_marketType).toEqual({
      eventType: 'SUPPLY_CONTRACT',
      bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
      marketType: 'KOSPI',
    });
  });

  it('persists individual observations once per event (DAR-166 drilldown sample)', async () => {
    const events = Array.from({ length: 35 }, (_, i) => makeDbEvent(i));
    const { service, getObsCreates, getObsDeletes } = buildService(events);

    const summary = await service.run();

    // 시장 그룹(KOSPI+ALL)은 2이지만 관측치는 이벤트당 1건만 영속(중복 없음)
    expect(summary.observationsPersisted).toBe(35);
    const creates = getObsCreates();
    expect(creates).toHaveLength(35);

    // 멱등: 영속 전 동일 eventId 선삭제
    const deletes = getObsDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0].where.eventId.in).toHaveLength(35);

    // 각 관측치는 버킷키·CAR(JSON)·플래그를 보존(표본 투명성)
    const sample = creates[0];
    expect(sample.bucketKey).toBe('SUPPLY_CONTRACT__ratio_5to20');
    expect(sample.eventType).toBe('SUPPLY_CONTRACT');
    expect(sample.d0Date).toBe('20250102');
    expect(typeof sample.cumulativeAR).toBe('object');
    expect(sample.cumulativeAR.d5).toBeCloseTo(5, 1); // D0=100→D+1=105, 시장 flat
    expect(sample.isUpD5).toBe(true);
    expect(typeof sample.maxDrawdown).toBe('number');
    // eventId 는 입력 이벤트와 1:1
    expect(new Set(creates.map((c: any) => c.eventId)).size).toBe(35);
  });

  it('persists no observations and skips delete when no matured events', async () => {
    const { service, getObsCreates, getObsDeletes } = buildService([]);
    const summary = await service.run();
    expect(summary.observationsPersisted).toBe(0);
    expect(getObsCreates()).toHaveLength(0);
    expect(getObsDeletes()).toHaveLength(0); // 빈 입력은 delete 도 생략
  });

  it('persists INSUFFICIENT (표본<30 데이터한계) for small samples', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeDbEvent(i));
    const { service, upserts } = buildService(events);

    const summary = await service.run();

    expect(summary.observationsBuilt).toBe(5);
    expect(summary.readyCount).toBe(0);
    expect(summary.insufficientCount).toBe(2); // KOSPI + ALL
    expect(upserts).toHaveLength(2);
    upserts.forEach(u => {
      expect(u.create.status).toBe('INSUFFICIENT');
      expect(u.create.isSignificant).toBe(false);
      expect(u.create.sampleCount).toBe(5);
    });
  });

  it('includes backfill events in the statistical sample (no isBackfill filter)', async () => {
    // 절반은 백필. 전부 표본에 포함되어야 35표본 READY 달성.
    const events = Array.from({ length: 35 }, (_, i) =>
      makeDbEvent(i, 'KOSPI', i % 2 === 0),
    );
    const { service, upserts, getFindManyArg } = buildService(events);

    const summary = await service.run();

    // baseline 전체 사용 → 35 전부 집계
    expect(summary.observationsBuilt).toBe(35);
    expect(summary.readyCount).toBe(2);

    // 회귀 가드: 쿼리 where 에 isBackfill 필터가 없어야 한다(라이브 격리는 신호측 책임)
    const where = getFindManyArg().where;
    expect(where).not.toHaveProperty('isBackfill');
    expect(where.extractionStatus).toBe('SUCCESS');

    const kospi = upserts.find(u => u.create.marketType === 'KOSPI')!;
    expect(kospi.create.sampleCount).toBe(35);
  });

  it('pools KOSPI + KOSDAQ into ALL but keeps market-specific buckets separate', async () => {
    const events = [
      ...Array.from({ length: 18 }, (_, i) => makeDbEvent(i, 'KOSPI')),
      ...Array.from({ length: 17 }, (_, i) => makeDbEvent(100 + i, 'KOSDAQ')),
    ];
    const { service, upserts } = buildService(events);

    const summary = await service.run();

    expect(summary.observationsBuilt).toBe(35);
    // 그룹: KOSPI(18), KOSDAQ(17), ALL(35)
    expect(summary.groupsAggregated).toBe(3);
    const byMarket = new Map(upserts.map(u => [u.create.marketType, u.create]));
    expect(byMarket.get('KOSPI')!.sampleCount).toBe(18);
    // DAR-324: 10 ≤ 18 < 30 → PRELIMINARY(점진 반영). 통계는 실제 계산되어 영속.
    expect(byMarket.get('KOSPI')!.status).toBe('PRELIMINARY');
    expect(byMarket.get('KOSDAQ')!.sampleCount).toBe(17);
    expect(byMarket.get('KOSDAQ')!.status).toBe('PRELIMINARY'); // 10 ≤ 17 < 30
    expect(byMarket.get('ALL')!.sampleCount).toBe(35);
    expect(byMarket.get('ALL')!.status).toBe('READY'); // 35 ≥ 30
  });

  // ── DAR-325: 부모(coarse) 버킷 풀링 ──────────────────────────────
  it('fine 버킷 2종이 각자 소표본이면 부모(coarse)가 원시 풀링으로 READY 도달', async () => {
    // 같은 (SUPPLY_CONTRACT, KOSPI) 안에서 fine 버킷 2종으로 분산:
    //   ratio_5to20 15건(PRELIMINARY) + ratio_gte20 20건(PRELIMINARY) = 부모 35건(READY)
    const fine5to20 = Array.from({ length: 15 }, (_, i) => makeDbEvent(i));
    const fineGte20 = Array.from({ length: 20 }, (_, i) => ({
      ...makeDbEvent(200 + i),
      // contractAmount/recentSales = 0.3 ≥ 0.20 → SUPPLY_CONTRACT__ratio_gte20
      extractedData: { contractAmount: 3_000_000_000, recentSalesAmount: 10_000_000_000 },
    }));
    const { service, upserts } = buildService([...fine5to20, ...fineGte20]);

    const summary = await service.run();

    expect(summary.observationsBuilt).toBe(35);
    // 부모 그룹: KOSPI::__ALL__, ALL::__ALL__ = 2 (단일 시장이지만 ALL 폴백도 부모 생성)
    expect(summary.coarseGroupsAggregated).toBe(2);

    const byKey = new Map(
      upserts.map(u => [`${u.create.marketType}::${u.create.bucketKey}`, u.create]),
    );
    // fine 버킷은 각자 소표본 → PRELIMINARY (덮어쓰기 없음)
    expect(byKey.get('KOSPI::SUPPLY_CONTRACT__ratio_5to20')!.sampleCount).toBe(15);
    expect(byKey.get('KOSPI::SUPPLY_CONTRACT__ratio_5to20')!.status).toBe('PRELIMINARY');
    expect(byKey.get('KOSPI::SUPPLY_CONTRACT__ratio_gte20')!.sampleCount).toBe(20);
    expect(byKey.get('KOSPI::SUPPLY_CONTRACT__ratio_gte20')!.status).toBe('PRELIMINARY');

    // 부모(coarse): suffix 무시 원시 풀링 35건 → READY·t검정 산출
    const coarseKospi = byKey.get('KOSPI::__ALL__')!;
    expect(coarseKospi.sampleCount).toBe(35);
    expect(coarseKospi.status).toBe('READY');
    expect(coarseKospi.eventType).toBe('SUPPLY_CONTRACT');
    expect(coarseKospi.tStatistic).not.toBeNull(); // 통계 실제 계산
    const coarseAll = byKey.get('ALL::__ALL__')!;
    expect(coarseAll.sampleCount).toBe(35);
    expect(coarseAll.status).toBe('READY');
    // 자연키 upsert 가 부모 bucketKey 를 쓴다
    expect(coarseKospi.eventType).toBe('SUPPLY_CONTRACT');
  });

  it('단일 fine 버킷이면 부모(coarse)를 생성하지 않는다 (중복 증거 방지·DAR-325)', async () => {
    // 전부 같은 fine 버킷(ratio_5to20) → 부모=fine 으로 동일 표본 중복일 뿐이라 생략
    const events = Array.from({ length: 35 }, (_, i) => makeDbEvent(i));
    const { service, upserts } = buildService(events);

    const summary = await service.run();

    expect(summary.coarseGroupsAggregated).toBe(0);
    expect(upserts.every(u => u.create.bucketKey !== '__ALL__')).toBe(true);
  });

  it('skips events with no stockCode/market (unlisted) and missing price data', async () => {
    const events = [
      ...Array.from({ length: 3 }, (_, i) => makeDbEvent(i)),
      // 비상장: market 없음 — loadEvents 의 where 가 거르므로 여기선 가격없음 경로 검증용
    ];
    // 한 종목의 가격을 어댑터에서 제외 → noPrices 경로
    const { prisma, upserts } = makePrismaMock(events);
    const stockData = events
      .slice(1) // stock-0 가격 누락
      .flatMap(e => makeStockSeries(e.company.stockCode));
    const service = new EventStudyCalculationService(
      prisma as any,
      new EventStudyService(),
      new InMemoryStockPriceAdapter(stockData),
      new InMemoryMarketIndexAdapter(makeIndexSeries('0001')),
    );

    const summary = await service.run();
    expect(summary.skipped.noPrices).toBe(1);
    expect(summary.observationsBuilt).toBe(2);
    // 표본 2 → INSUFFICIENT 2그룹
    expect(upserts.every(u => u.create.status === 'INSUFFICIENT')).toBe(true);
  });

  // DAR-328: company.market 이 지수코드(0001/1001)에 매핑되는 KOSPI/KOSDAQ 여야
  // 관측이 만들어진다. 'LISTED' 같은 일반값은 INDEX_CODE_BY_MARKET 매핑이 없어
  // noStockOrMarket 으로 스킵된다 — 시장분류 백필이 관측 0건 차단을 해소함을 증명.
  it("'LISTED' 시장값은 noStockOrMarket 으로 스킵되지만, KOSPI/KOSDAQ 로 분류된 회사는 관측을 만든다 (DAR-328)", async () => {
    // 동일 종목/이벤트를 'LISTED' 로 두면 관측 0건(현 장애 재현)
    const listed = Array.from({ length: 35 }, (_, i) => makeDbEvent(i, 'LISTED'));
    const { service: svcListed } = buildService(listed);
    const listedSummary = await svcListed.run();
    expect(listedSummary.eventsScanned).toBe(35);
    expect(listedSummary.skipped.noStockOrMarket).toBe(35);
    expect(listedSummary.observationsBuilt).toBe(0);

    // 같은 데이터를 KOSPI 로 분류하면 관측이 만들어지고 READY/INSUFFICIENT 결과가 생성된다
    const classified = Array.from({ length: 35 }, (_, i) => makeDbEvent(i, 'KOSPI'));
    const { service: svcKospi, upserts } = buildService(classified);
    const kospiSummary = await svcKospi.run();
    expect(kospiSummary.skipped.noStockOrMarket).toBe(0);
    expect(kospiSummary.observationsBuilt).toBe(35);
    expect(upserts.length).toBeGreaterThan(0);
    expect(upserts.some(u => u.create.marketType === 'KOSPI')).toBe(true);
  });

  it('KOSDAQ 로 분류된 회사도 KOSDAQ 지수(1001)에 매핑되어 관측을 만든다 (DAR-328)', async () => {
    const events = Array.from({ length: 35 }, (_, i) => makeDbEvent(i, 'KOSDAQ'));
    const { service, upserts } = buildService(events);

    const summary = await service.run();

    expect(summary.skipped.noStockOrMarket).toBe(0);
    expect(summary.observationsBuilt).toBe(35);
    expect(upserts.some(u => u.create.marketType === 'KOSDAQ')).toBe(true);
  });
});
