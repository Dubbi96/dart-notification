import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { KrxApiService, KrxApiUnavailableError, KrxStockDailyRow, KrxIndexDailyRow, KrxStockBaseInfo } from './krx-api.service';
import { DartStockStatusService, DerivedStockStatus } from './dart-stock-status.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeDart(
  statuses: Map<string, DerivedStockStatus> = new Map(),
): jest.Mocked<DartStockStatusService> {
  return {
    deriveStatus: jest.fn(),
    isManagementStock: jest.fn().mockResolvedValue(false),
    deriveAllStatuses: jest.fn().mockResolvedValue(statuses),
  } as unknown as jest.Mocked<DartStockStatusService>;
}

function makeKrxApi(overrides: Partial<KrxApiService> = {}): jest.Mocked<KrxApiService> {
  return {
    fetchStockDaily: jest.fn().mockResolvedValue([]),
    fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
    fetchIndexDaily: jest.fn().mockResolvedValue([]),
    fetchStockStatus: jest.fn().mockResolvedValue([]),
    fetchStkIsuBaseInfo: jest.fn().mockResolvedValue([]),
    fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
    fetchMarketClassificationFallback: jest.fn().mockResolvedValue([]),
    isWeekend: jest.fn().mockReturnValue(false),
    parseDate: jest.fn().mockReturnValue(new Date('2026-06-04')),
    formatDate: jest.fn().mockReturnValue('20260604'),
    ...overrides,
  } as unknown as jest.Mocked<KrxApiService>;
}

function makePrisma(): jest.Mocked<PrismaService> {
  return {
    company: {
      findMany: jest.fn().mockResolvedValue([
        { corpCode: 'A005930', stockCode: '005930' },
        { corpCode: 'A000660', stockCode: '000660' },
      ]),
      count: jest.fn().mockResolvedValue(2),
      update: jest.fn().mockResolvedValue({}),
    },
    stockDailyPrice: {
      upsert: jest.fn().mockResolvedValue({}),
      // DAR-234: EOD 일봉은 createMany 단일 적재로 통일. count = 신규 삽입 행수.
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown[] }) =>
          Promise.resolve({ count: data.length }),
        ),
      // DAR-331: 최신 가용 거래일 해석용. 기본 null(저장소 비어있음 → today 폴백).
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // DAR-367: 연속성 가드가 직전 거래일 종가를 findFirst 로 조회한다. 기본 null(전일 없음 → 가드 통과).
    marketIndex: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    stockStatus: { upsert: jest.fn().mockResolvedValue({}) },
    marketDataCollectionLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

// ─── collectDailyPricesForDate ───────────────────────────────────────────────

describe('KrxMarketDataScheduler.collectDailyPricesForDate', () => {
  const sampleRow: KrxStockDailyRow = {
    stockCode: '005930',
    isuAbbrv: '삼성전자',
    openPrice: 70_000,
    highPrice: 71_000,
    lowPrice: 69_500,
    closePrice: 70_500,
    volume: 15_000_000,
    tradingValue: 1_057_500_000_000,
  };

  it('정상 수집 — API 2회(KOSPI+KOSDAQ) 호출, 매칭 종목 createMany 단일 원자 적재', async () => {
    const sampleRow2: KrxStockDailyRow = { ...sampleRow, stockCode: '000660', isuAbbrv: 'SK하이닉스' };
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([sampleRow2]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectDailyPricesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(2);
    expect(krx.fetchStockDaily).toHaveBeenCalledTimes(1); // 전종목 1회
    expect(krx.fetchKosqdaqDaily).toHaveBeenCalledTimes(1);
    // DAR-234: 행당 순차 upsert(N회) → createMany 단일 호출(원자적, 부분커밋 없음)
    expect(prisma.stockDailyPrice.upsert).not.toHaveBeenCalled();
    expect(prisma.stockDailyPrice.createMany).toHaveBeenCalledTimes(1);
    const arg = (prisma.stockDailyPrice.createMany as jest.Mock).mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true); // 멱등 — 이미 적재된 (stockCode,tradeDate) 무시
    expect(arg.data).toHaveLength(2);
  });

  it('중단 후 재실행 멱등 — 이미 적재된 행은 skipDuplicates 로 무시(saved=신규삽입만, 무손상)', async () => {
    const sampleRow2: KrxStockDailyRow = { ...sampleRow, stockCode: '000660', isuAbbrv: 'SK하이닉스' };
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([sampleRow2]),
    });
    const prisma = makePrisma();
    // 1차 실행에서 2건 모두 이미 커밋된 상태를 재현 — createMany 가 중복 0건 삽입 반환.
    (prisma.stockDailyPrice.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectDailyPricesForDate('20260604', 'CRON');

    // 재실행해도 오류 없이 멱등 완료 — 신규 삽입 0건, 다운스트림 데이터 무손상.
    expect(result.message).toBeUndefined();
    expect(result.saved).toBe(0);
    expect(prisma.stockDailyPrice.createMany).toHaveBeenCalledTimes(1);
  });

  it('주말이면 수집 스킵하고 0 반환', async () => {
    const krx = makeKrxApi({ isWeekend: jest.fn().mockReturnValue(true) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectDailyPricesForDate('20260606', 'CRON');

    expect(result.message).toBe('주말 스킵');
    expect(prisma.stockDailyPrice.createMany).not.toHaveBeenCalled();
  });

  it('중복 실행 시 두 번째 호출은 즉시 반환', async () => {
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
    });
    const prisma = makePrisma();

    let resolveFirst!: () => void;
    const firstPromise = new Promise<{ count: number }>((r) => (resolveFirst = () => r({ count: 1 })));
    (prisma.stockDailyPrice.createMany as jest.Mock).mockImplementation(() => firstPromise);

    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    const first = scheduler.collectDailyPricesForDate('20260604', 'CRON');
    const second = await scheduler.collectDailyPricesForDate('20260604', 'CRON');

    expect(second.message).toBe('이전 작업 진행 중');
    resolveFirst();
    await first;
  });

  it('KRX API 키 미설정 — KrxApiUnavailableError graceful 처리', async () => {
    const unavailErr = new KrxApiUnavailableError('KRX_API_KEY 미설정');
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockRejectedValue(unavailErr),
      fetchKosqdaqDaily: jest.fn().mockRejectedValue(unavailErr),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectDailyPricesForDate('20260604', 'CRON');

    expect(result.message).toBe('KRX API 미설정');
    expect(result.saved).toBe(0);
  });

  it('closePrice=0 행은 스킵', async () => {
    const zeroRow: KrxStockDailyRow = { ...sampleRow, closePrice: 0 };
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([zeroRow]),
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectDailyPricesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ─── collectMarketIndicesForDate ─────────────────────────────────────────────

describe('KrxMarketDataScheduler.collectMarketIndicesForDate', () => {
  const sampleKospi: KrxIndexDailyRow = {
    indexCode: '0001',
    indexName: 'KOSPI',
    openIndex: 2700.0,
    highIndex: 2750.0,
    lowIndex: 2680.0,
    closeIndex: 2720.0,
    volume: 500_000_000,
    tradingValue: 10_000_000_000_000,
  };

  it('KOSPI·KOSDAQ 각각 upsert', async () => {
    const krx = makeKrxApi({
      fetchIndexDaily: jest.fn().mockResolvedValue([sampleKospi]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(2); // KOSPI 1 + KOSDAQ 1
    expect(prisma.marketIndex.upsert).toHaveBeenCalledTimes(2);
  });

  it('closeIndex=0 행은 스킵', async () => {
    const zeroRow: KrxIndexDailyRow = { ...sampleKospi, closeIndex: 0 };
    const krx = makeKrxApi({ fetchIndexDaily: jest.fn().mockResolvedValue([zeroRow]) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(0);
  });

  it('KRX API 미설정 — graceful 처리', async () => {
    const krx = makeKrxApi({
      fetchIndexDaily: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'CRON');

    expect(result.message).toBe('KRX API 미설정');
  });

  // DAR-367 연속성 sanity 가드: 직전 거래일 종가 대비 |Δ| 가 임계(±20%)를 초과하면 적재 거부.
  it('연속성 이상치(인접일 +60% 등) 행은 격리 — upsert 호출 안 함', async () => {
    // close 2720 vs prev 1700 → +60% → 임계(20%) 초과 → 격리.
    const krx = makeKrxApi({ fetchIndexDaily: jest.fn().mockResolvedValue([sampleKospi]) });
    const prisma = makePrisma();
    (prisma.marketIndex.findFirst as jest.Mock).mockResolvedValue({
      closeIndex: 1700,
      tradeDate: '20260603',
    });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(0);
    expect(result.quarantined).toBe(2); // KOSPI + KOSDAQ 양쪽 격리
    expect(prisma.marketIndex.upsert).not.toHaveBeenCalled();
  });

  it('정상 범위(인접일 ±2%)는 가드 통과 후 적재', async () => {
    // close 2720 vs prev 2700 → +0.74% → 통과.
    const krx = makeKrxApi({ fetchIndexDaily: jest.fn().mockResolvedValue([sampleKospi]) });
    const prisma = makePrisma();
    (prisma.marketIndex.findFirst as jest.Mock).mockResolvedValue({
      closeIndex: 2700,
      tradeDate: '20260603',
    });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(2);
    expect(result.quarantined).toBe(0);
    expect(prisma.marketIndex.upsert).toHaveBeenCalledTimes(2);
  });

  it('직전 거래일 데이터 없음(findFirst null) — 가드 통과(최초 적재 허용)', async () => {
    const krx = makeKrxApi({ fetchIndexDaily: jest.fn().mockResolvedValue([sampleKospi]) });
    const prisma = makePrisma(); // findFirst 기본 null
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(2);
    expect(prisma.marketIndex.upsert).toHaveBeenCalledTimes(2);
  });
});

// ─── backfillMarketIndexHistory (DAR-398) ───────────────────────────────────────
describe('KrxMarketDataScheduler.backfillMarketIndexHistory', () => {
  const sampleKospi: KrxIndexDailyRow = {
    indexCode: '0001',
    indexName: 'KOSPI',
    openIndex: 2700,
    highIndex: 2750,
    lowIndex: 2680,
    closeIndex: 2720,
    volume: 500_000_000,
    tradingValue: 10_000_000_000_000,
  };

  /** stock_daily_prices 거래일과 market_indices 보유일을 주입한 prisma 목 */
  function makePrismaWithCalendar(stockDates: string[], indexDates: string[]) {
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findMany as jest.Mock) = jest
      .fn()
      .mockResolvedValue(stockDates.map((d) => ({ tradeDate: d })));
    (prisma.marketIndex.findMany as jest.Mock) = jest
      .fn()
      .mockResolvedValue(indexDates.map((d) => ({ tradeDate: d })));
    return prisma;
  }

  it('stock 거래일 중 지수 결손분만 오래된 순으로 수집한다 (멱등 결손 메우기)', async () => {
    // 거래일 3일 중 지수는 마지막 1일만 보유 → 앞 2일 결손
    const prisma = makePrismaWithCalendar(
      ['20250701', '20250702', '20250703'],
      ['20250703'],
    );
    const fetchIndexDaily = jest.fn().mockResolvedValue([sampleKospi]);
    const krx = makeKrxApi({ fetchIndexDaily });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.backfillMarketIndexHistory({ triggeredBy: 'MANUAL' });

    expect(result.tradingDays).toBe(3);
    expect(result.missing).toBe(2);
    // 결손 2일 × (KOSPI+KOSDAQ) = 4 fetch, 4 upsert
    expect(fetchIndexDaily).toHaveBeenCalledTimes(4);
    expect(prisma.marketIndex.upsert).toHaveBeenCalledTimes(4);
    // 오래된 순으로 채움(연속성 가드 자연 성립)
    expect(fetchIndexDaily.mock.calls[0][1]).toBe('20250701');
    expect(result.filledDates).toEqual(['20250701', '20250702']);
    expect(result.totalSaved).toBe(4);
  });

  it('결손이 없으면 no-op (멱등)', async () => {
    const prisma = makePrismaWithCalendar(['20250701'], ['20250701']);
    const fetchIndexDaily = jest.fn().mockResolvedValue([sampleKospi]);
    const krx = makeKrxApi({ fetchIndexDaily });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.backfillMarketIndexHistory();

    expect(result.missing).toBe(0);
    expect(fetchIndexDaily).not.toHaveBeenCalled();
    expect(prisma.marketIndex.upsert).not.toHaveBeenCalled();
  });

  it('maxDays 상한으로 1회 수집량을 제한한다 (쿼터 보호)', async () => {
    const prisma = makePrismaWithCalendar(
      ['20250701', '20250702', '20250703'],
      [],
    );
    const fetchIndexDaily = jest.fn().mockResolvedValue([sampleKospi]);
    const krx = makeKrxApi({ fetchIndexDaily });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.backfillMarketIndexHistory({ maxDays: 1 });

    expect(result.missing).toBe(1); // 상한으로 1일만
    expect(fetchIndexDaily).toHaveBeenCalledTimes(2); // 1일 × KOSPI+KOSDAQ
  });
});

// ─── collectStockStatusesForDate ─────────────────────────────────────────────

describe('KrxMarketDataScheduler.collectStockStatusesForDate', () => {
  it('종목상태 수집 건수 반환 + DB upsert 호출', async () => {
    const krx = makeKrxApi({
      fetchStockStatus: jest.fn().mockResolvedValue([
        { stockCode: '005930', corpName: '삼성전자', isHalted: false, isManagement: false, isWarning: false, isSurge: false },
        { stockCode: '000040', corpName: '관리기업', isHalted: false, isManagement: true, isWarning: false, isSurge: false },
      ]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectStockStatusesForDate('20260604', 'CRON');

    expect(result.processed).toBe(2);
    expect(prisma.stockStatus.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.stockStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCode: '000040' },
        update: expect.objectContaining({ isManagement: true }),
      }),
    );
  });

  it('주말 스킵', async () => {
    const krx = makeKrxApi({ isWeekend: jest.fn().mockReturnValue(true) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectStockStatusesForDate('20260606', 'CRON');

    expect(result.message).toBe('주말 스킵');
  });

  it('KRX 미설정 — DART 공시 폴백으로 관리종목·거래정지 상태 적재 (DAR-69)', async () => {
    const krx = makeKrxApi({
      fetchStockStatus: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    // company.findMany는 corpCode→stockCode 매핑용
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930' },
      { corpCode: 'A000040', stockCode: '000040' },
    ]);
    const dart = makeDart(
      new Map<string, DerivedStockStatus>([
        [
          'A000040',
          {
            isManagement: true,
            isHalted: false,
            isDelistingRisk: true,
            statusNote: '관리종목 지정 (DART 공시 폴백)',
            sourceRcpNo: '20260601000001',
            sourceRcpDt: '20260601',
          },
        ],
      ]),
    );
    const scheduler = new KrxMarketDataScheduler(prisma, krx, dart);

    const result = await scheduler.collectStockStatusesForDate('20260604', 'CRON');

    expect(result.processed).toBe(1);
    expect(prisma.stockStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCode: '000040' },
        update: expect.objectContaining({ isManagement: true, isTradingSuspended: false }),
      }),
    );
  });

  it('KRX 미설정 + DART 상태 공시 없음 — 0건 처리', async () => {
    const krx = makeKrxApi({
      fetchStockStatus: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.collectStockStatusesForDate('20260604', 'CRON');

    expect(result.processed).toBe(0);
    expect(result.message).toBe('DART 상태 공시 없음');
    expect(prisma.stockStatus.upsert).not.toHaveBeenCalled();
  });

  it('KRX 성공 시 DART 관리종목 플래그를 OR 병합한다 (DAR-69)', async () => {
    // KRX는 isManagement=false(미매핑 하드코딩)지만 DART 폴백이 관리종목으로 판정
    const krx = makeKrxApi({
      fetchStockStatus: jest.fn().mockResolvedValue([
        { stockCode: '000040', corpName: '관리기업', isHalted: false, isManagement: false, isWarning: false, isSurge: false },
      ]),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A000040', stockCode: '000040' },
    ]);
    const dart = makeDart(
      new Map<string, DerivedStockStatus>([
        [
          'A000040',
          {
            isManagement: true,
            isHalted: true,
            isDelistingRisk: false,
            statusNote: '관리종목 지정·거래정지 (DART 공시 폴백)',
            sourceRcpNo: '20260601000002',
            sourceRcpDt: '20260601',
          },
        ],
      ]),
    );
    const scheduler = new KrxMarketDataScheduler(prisma, krx, dart);

    const result = await scheduler.collectStockStatusesForDate('20260604', 'CRON');

    expect(result.processed).toBe(1);
    expect(prisma.stockStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCode: '000040' },
        update: expect.objectContaining({ isManagement: true, isTradingSuspended: true }),
      }),
    );
  });
});

// ─── syncCompanyMarkets (DAR-328) ────────────────────────────────────────────

describe('KrxMarketDataScheduler.syncCompanyMarkets', () => {
  const stkBase: KrxStockBaseInfo[] = [
    { stockCode: '005930', stockName: '삼성전자', marketType: 'KOSPI' },
  ];
  const ksqBase: KrxStockBaseInfo[] = [
    { stockCode: '035720', stockName: '카카오게임즈', marketType: 'KOSDAQ' },
  ];

  it("'LISTED'·null 분류를 KRX 기준정보 기반 KOSPI/KOSDAQ 로 백필한다", async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue(stkBase),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue(ksqBase),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' },
      { corpCode: 'A035720', stockCode: '035720', market: null },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'MANUAL');

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.unmatched).toBe(0);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { corpCode: 'A005930' },
      data: { market: 'KOSPI' },
    });
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { corpCode: 'A035720' },
      data: { market: 'KOSDAQ' },
    });
  });

  it('이미 올바른 시장으로 분류된 회사는 update 를 스킵한다 (멱등)', async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue(stkBase),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'KOSPI' },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'MANUAL');

    expect(result.updated).toBe(0);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('KONEX·기준정보 미존재 종목은 갱신 대상에서 제외하고 기존 값을 보존한다', async () => {
    const krx = makeKrxApi({
      // 정상 KOSPI 1건(맵 비어있지 않게) + KONEX 1건(제외 대상)
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue([
        { stockCode: '005930', stockName: '삼성전자', marketType: 'KOSPI' },
        { stockCode: '900110', stockName: '코넥스사', marketType: 'KONEX' },
      ]),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' }, // 매칭 → KOSPI 갱신
      { corpCode: 'A900110', stockCode: '900110', market: 'LISTED' }, // KONEX → 미매칭
      { corpCode: 'A999999', stockCode: '999999', market: 'LISTED' }, // 기준정보 없음 → 미매칭
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'MANUAL');

    expect(result.scanned).toBe(3);
    expect(result.updated).toBe(1); // 005930만 갱신
    expect(result.unmatched).toBe(2); // KONEX + 기준정보 없음
    expect(prisma.company.update).toHaveBeenCalledTimes(1);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { corpCode: 'A005930' },
      data: { market: 'KOSPI' },
    });
  });

  it('주말 스킵', async () => {
    const krx = makeKrxApi({ isWeekend: jest.fn().mockReturnValue(true) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260606', 'CRON');

    expect(result.message).toBe('주말 스킵');
    expect(krx.fetchStkIsuBaseInfo).not.toHaveBeenCalled();
  });

  it('KRX 미설정 — graceful 0 갱신 (기존 분류 무손상)', async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'CRON');

    expect(result.updated).toBe(0);
    expect(result.message).toBe('KRX API 미설정');
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('기준정보 0행(휴장) — 갱신 없음', async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue([]),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'CRON');

    expect(result.message).toBe('기준정보 없음');
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  // DAR-329: 수동 컨트롤러(body {}) → basDd undefined 시 현재 거래일 기본값 사용·크래시 없음
  it('basDd 미전달(undefined) 시 현재 거래일(formatDate)로 기본값 — 크래시 없이 동작', async () => {
    const krx = makeKrxApi({
      formatDate: jest.fn().mockReturnValue('20260619'),
      parseDate: jest.fn().mockReturnValue(new Date('2026-06-19')), // 금요일(평일)
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue(stkBase),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue(ksqBase),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    // 컨트롤러가 basDd 없이 호출하는 시나리오
    const result = await scheduler.syncCompanyMarkets(undefined, 'MANUAL');

    expect(krx.formatDate).toHaveBeenCalled(); // 기본 거래일 산출
    expect(krx.parseDate).toHaveBeenCalledWith('20260619'); // 기본값을 가드 통과
    expect(krx.fetchStkIsuBaseInfo).toHaveBeenCalledWith('20260619');
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
  });

  // ─── DAR-330: isu_base_info 빈 응답 → 일별매매정보 폴백 ────────────────────
  it('base_info 정상 응답 시 폴백을 호출하지 않고 source=BASE_INFO 로 백필한다', async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue(stkBase),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue(ksqBase),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'MANUAL');

    expect(result.source).toBe('BASE_INFO');
    expect(result.updated).toBe(1);
    expect(krx.fetchMarketClassificationFallback).not.toHaveBeenCalled();
  });

  it('base_info 빈 응답이면 일별매매정보(stk/ksq_bydd_trd) 폴백으로 시장분류를 백필한다 (source=DAILY_FALLBACK)', async () => {
    const krx = makeKrxApi({
      // isu_base_info 는 (DAR-330 실측처럼) 빈 응답
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue([]),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
      // 일별매매정보 폴백은 정상 — KOSPI/KOSDAQ 분류 반환
      fetchMarketClassificationFallback: jest.fn().mockResolvedValue([
        { stockCode: '005930', stockName: '삼성전자', marketType: 'KOSPI' },
        { stockCode: '035720', stockName: '카카오게임즈', marketType: 'KOSDAQ' },
      ]),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' },
      { corpCode: 'A035720', stockCode: '035720', market: null },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'MANUAL');

    expect(krx.fetchMarketClassificationFallback).toHaveBeenCalledWith('20260604');
    expect(result.source).toBe('DAILY_FALLBACK');
    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(2); // 폴백 분류로 KOSPI/KOSDAQ 백필
    expect(result.unmatched).toBe(0);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { corpCode: 'A005930' },
      data: { market: 'KOSPI' },
    });
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { corpCode: 'A035720' },
      data: { market: 'KOSDAQ' },
    });
  });

  it('폴백 분류의 KONEX·빈코드는 제외하고 KOSPI/KOSDAQ 만 백필한다', async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue([]),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
      fetchMarketClassificationFallback: jest.fn().mockResolvedValue([
        { stockCode: '005930', stockName: '삼성전자', marketType: 'KOSPI' },
        { stockCode: '900110', stockName: '코넥스사', marketType: 'KONEX' },
        { stockCode: '', stockName: '빈코드', marketType: 'KOSPI' },
      ]),
    });
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' },
      { corpCode: 'A900110', stockCode: '900110', market: 'LISTED' },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'MANUAL');

    expect(result.source).toBe('DAILY_FALLBACK');
    expect(result.updated).toBe(1); // 005930만
    expect(result.unmatched).toBe(1); // KONEX(900110)
    expect(prisma.company.update).toHaveBeenCalledTimes(1);
  });

  it('base_info·일별매매정보 모두 0행이면 폴백 시도 후에도 갱신 없음(기준정보 없음)', async () => {
    const krx = makeKrxApi({
      fetchStkIsuBaseInfo: jest.fn().mockResolvedValue([]),
      fetchKsqIsuBaseInfo: jest.fn().mockResolvedValue([]),
      fetchMarketClassificationFallback: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets('20260604', 'CRON');

    expect(krx.fetchMarketClassificationFallback).toHaveBeenCalledWith('20260604');
    expect(result.message).toBe('기준정보 없음');
    expect(result.source).toBe('DAILY_FALLBACK'); // 폴백을 시도했음을 명시
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });
});

// ─── resolveLatestAvailableTradeDate (DAR-331) ───────────────────────────────

describe('KrxMarketDataScheduler.resolveLatestAvailableTradeDate', () => {
  it('명시 basDd 가 있으면 그대로 사용한다(우선순위 1) — DB 미조회', async () => {
    const krx = makeKrxApi();
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.resolveLatestAvailableTradeDate('20260610');

    expect(result).toBe('20260610');
    expect(prisma.stockDailyPrice.findFirst).not.toHaveBeenCalled();
  });

  it('명시 없으면 StockDailyPrice 최신 tradeDate 를 사용한다(우선순위 2, 시계 선행 보정)', async () => {
    // today(formatDate mock)=20260619 인데 저장소 최신일=20260605 → 최신 가용일 사용
    const krx = makeKrxApi({ formatDate: jest.fn().mockReturnValue('20260619') });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.resolveLatestAvailableTradeDate(undefined);

    expect(result).toBe('20260605');
    expect(prisma.stockDailyPrice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { tradeDate: 'desc' } }),
    );
  });

  it('저장소가 비어있으면 today 로 폴백한다(우선순위 3)', async () => {
    const krx = makeKrxApi({ formatDate: jest.fn().mockReturnValue('20260619') });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue(null);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.resolveLatestAvailableTradeDate();

    expect(result).toBe('20260619');
  });

  it('저장소 최신일이 today 보다 미래면(비정상) today 로 클램프한다', async () => {
    const krx = makeKrxApi({ formatDate: jest.fn().mockReturnValue('20260619') });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260625' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.resolveLatestAvailableTradeDate();

    expect(result).toBe('20260619');
  });

  it('today 가 주말이면 직전 평일(금)로 클램프한다 (저장소 빈 부트스트랩 경로)', async () => {
    // 실제 날짜 산술로 클램프 검증: today=20260620(토) → 20260619(금)
    const realFormat = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
        d.getDate(),
      ).padStart(2, '0')}`;
    const krx = makeKrxApi({
      isWeekend: jest.fn((d: Date) => d.getDay() === 0 || d.getDay() === 6),
      parseDate: jest.fn(
        (s: string) =>
          new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))),
      ),
      formatDate: jest
        .fn()
        .mockReturnValueOnce('20260620') // formatDate(new Date()) = 토요일
        .mockImplementation((d: Date) => realFormat(d)),
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue(null);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.resolveLatestAvailableTradeDate();

    expect(result).toBe('20260619');
  });

  it('syncCompanyMarkets(basDd 미전달) → 최신 가용 거래일로 base_info 조회', async () => {
    const krx = makeKrxApi({
      formatDate: jest.fn().mockReturnValue('20260619'),
      parseDate: jest.fn().mockReturnValue(new Date('2026-06-05')), // 평일
      fetchStkIsuBaseInfo: jest
        .fn()
        .mockResolvedValue([{ stockCode: '005930', stockName: '삼성전자', marketType: 'KOSPI' }]),
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { corpCode: 'A005930', stockCode: '005930', market: 'LISTED' },
    ]);
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.syncCompanyMarkets(undefined, 'CRON');

    expect(krx.fetchStkIsuBaseInfo).toHaveBeenCalledWith('20260605'); // today 아님
    expect(result.updated).toBe(1);
  });
});

// ─── resolveIntradayTradeDate (DAR-423) ──────────────────────────────────────
// 인트라데이(분봉/단타)는 일봉 발행과 무관 — 장중엔 today, 장외엔 직전 거래일(일봉 resolver 위임).
// now 주입은 UTC 'Z' → Intl 이 Asia/Seoul KST 로 환산(시스템 TZ 무관). 6/23=화(오늘).

describe('KrxMarketDataScheduler.resolveIntradayTradeDate (DAR-423)', () => {
  it('장중(화 12:00 KST) → 오늘(20260623), 일봉 resolver 미호출(직전거래일 폴백 안함)', async () => {
    const krx = makeKrxApi();
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    const latestSpy = jest.spyOn(scheduler, 'resolveLatestAvailableTradeDate');

    // KST 화 12:00 = UTC 03:00
    const result = await scheduler.resolveIntradayTradeDate(new Date('2026-06-23T03:00:00Z'));

    expect(result).toBe('20260623');
    expect(latestSpy).not.toHaveBeenCalled();
  });

  it('개장 경계(화 09:00 KST) → 오늘(20260623)', async () => {
    const scheduler = new KrxMarketDataScheduler(makePrisma(), makeKrxApi(), makeDart());
    // KST 화 09:00 = UTC 00:00
    expect(await scheduler.resolveIntradayTradeDate(new Date('2026-06-23T00:00:00Z'))).toBe(
      '20260623',
    );
  });

  it('장 마감 후(화 16:00 KST, 일봉 미게시 시각)도 같은 세션일 오늘(20260623)', async () => {
    const scheduler = new KrxMarketDataScheduler(makePrisma(), makeKrxApi(), makeDart());
    // KST 화 16:00 = UTC 07:00
    expect(await scheduler.resolveIntradayTradeDate(new Date('2026-06-23T07:00:00Z'))).toBe(
      '20260623',
    );
  });

  it('개장 전(화 08:00 KST·장외) → 직전 거래일(일봉 resolver 위임)', async () => {
    const krx = makeKrxApi();
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    jest.spyOn(scheduler, 'resolveLatestAvailableTradeDate').mockResolvedValue('20260622');

    // KST 화 08:00 = UTC 월 23:00
    const result = await scheduler.resolveIntradayTradeDate(new Date('2026-06-22T23:00:00Z'));

    expect(result).toBe('20260622');
    expect(scheduler.resolveLatestAvailableTradeDate).toHaveBeenCalled();
  });

  it('주말(토 12:00 KST·장외) → 직전 거래일(일봉 resolver 위임)', async () => {
    const scheduler = new KrxMarketDataScheduler(makePrisma(), makeKrxApi(), makeDart());
    jest.spyOn(scheduler, 'resolveLatestAvailableTradeDate').mockResolvedValue('20260619');

    // KST 토 12:00 = UTC 03:00 (6/20=토)
    const result = await scheduler.resolveIntradayTradeDate(new Date('2026-06-20T03:00:00Z'));

    expect(result).toBe('20260619');
    expect(scheduler.resolveLatestAvailableTradeDate).toHaveBeenCalled();
  });
});

// ─── DAR-375: 최신 가용일 프로브 + 갭 캐치업 ──────────────────────────────────

describe('KrxMarketDataScheduler — DAR-375 최신 가용일 프로브 / 갭 캐치업', () => {
  // 실제 날짜 산술 mock (parseDate/formatDate/isWeekend) — 백워드/포워드 순회 검증용.
  const realParse = (s: string) =>
    new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const realFormat = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const realIsWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  // KRX 가 6/5~6/18 의 평일 데이터를 보유(6/19 는 미게시) — 이슈 실측 시나리오.
  const AVAILABLE = new Set([
    '20260605',
    '20260608',
    '20260609',
    '20260610',
    '20260611',
    '20260612',
    '20260615',
    '20260616',
    '20260617',
    '20260618',
  ]);
  const sampleKospi: KrxIndexDailyRow = {
    indexCode: '0001',
    indexName: 'KOSPI',
    openIndex: 2700,
    highIndex: 2750,
    lowIndex: 2680,
    closeIndex: 2720,
    volume: 1,
    tradingValue: 1,
  };
  const sampleRow: KrxStockDailyRow = {
    stockCode: '005930',
    isuAbbrv: '삼성전자',
    openPrice: 70_000,
    highPrice: 71_000,
    lowPrice: 69_500,
    closePrice: 70_500,
    volume: 15_000_000,
    tradingValue: 1_057_500_000_000,
  };

  // today=20260620(토)로 고정 — formatDate(new Date()) 첫 호출만 '20260620', 이후 real.
  function makeRealDateKrx(overrides: Partial<KrxApiService> = {}): jest.Mocked<KrxApiService> {
    return makeKrxApi({
      parseDate: jest.fn(realParse),
      isWeekend: jest.fn(realIsWeekend),
      formatDate: jest.fn().mockReturnValueOnce('20260620').mockImplementation(realFormat),
      fetchIndexDaily: jest.fn((_t: 'KOSPI' | 'KOSDAQ', basDd: string) =>
        Promise.resolve(AVAILABLE.has(basDd) ? [sampleKospi] : []),
      ),
      ...overrides,
    });
  }

  it('프로브: today(20260620토→20260619금) 미게시 → 직전 가용일 20260618 채택 (DB 정체와 무관)', async () => {
    const krx = makeRealDateKrx();
    const prisma = makePrisma();
    // 저장소는 6/5 에 정체 — 과거 버그라면 6/5 를 반환했을 것.
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.resolveLatestAvailableTradeDate();

    expect(result).toBe('20260618'); // 6/5 정체를 넘어 실제 최신 가용일로 전진
    // 6/19(미게시) 프로브 → 6/18(가용)에서 채택
    expect(krx.fetchIndexDaily).toHaveBeenCalledWith('KOSPI', '20260619');
    expect(krx.fetchIndexDaily).toHaveBeenCalledWith('KOSPI', '20260618');
  });

  it('프로브 직접: 6/19 미게시 → 6/18 반환', async () => {
    const krx = makeKrxApi({
      parseDate: jest.fn(realParse),
      isWeekend: jest.fn(realIsWeekend),
      formatDate: jest.fn(realFormat),
      fetchIndexDaily: jest.fn((_t: 'KOSPI' | 'KOSDAQ', basDd: string) =>
        Promise.resolve(AVAILABLE.has(basDd) ? [sampleKospi] : []),
      ),
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    expect(await scheduler.probeLatestAvailableTradeDate('20260619')).toBe('20260618');
  });

  it('프로브: KRX 미설정(KrxApiUnavailableError) → null (호출자 DB 폴백)', async () => {
    const krx = makeKrxApi({
      parseDate: jest.fn(realParse),
      isWeekend: jest.fn(realIsWeekend),
      formatDate: jest.fn(realFormat),
      fetchIndexDaily: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    expect(await scheduler.probeLatestAvailableTradeDate('20260619')).toBeNull();
  });

  it('resolve: 프로브 실패(미설정) 시 DB 최신일로 폴백', async () => {
    const krx = makeRealDateKrx({
      fetchIndexDaily: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    expect(await scheduler.resolveLatestAvailableTradeDate()).toBe('20260605');
  });

  it('일봉 캐치업: 마지막 적재(6/5)~최신 가용(6/18) 누락 거래일 9일 멱등 백필 + 로그 기록', async () => {
    const krx = makeRealDateKrx({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.catchUpDailyPrices('CRON');

    expect(result.target).toBe('20260618');
    expect(result.lastLoaded).toBe('20260605');
    // 6/8·9·10·11·12·15·16·17·18 (주말 제외) = 9 거래일
    expect(result.filledDates).toEqual([
      '20260608',
      '20260609',
      '20260610',
      '20260611',
      '20260612',
      '20260615',
      '20260616',
      '20260617',
      '20260618',
    ]);
    expect(result.totalSaved).toBe(9); // 종목 1건/일 × 9일
    expect(prisma.stockDailyPrice.createMany).toHaveBeenCalledTimes(9);
    // 캐치업 실행이 MarketDataCollectionLog 에 기록됨(RUNNING→SUCCESS)
    expect(prisma.marketDataCollectionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.marketDataCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
    );
  });

  it('일봉 캐치업: 휴장일(rowsFetched=0)은 emptyDates 로 스킵(거래일 카운트 제외)', async () => {
    // 6/16 만 휴장(빈 응답) — 나머지는 정상
    const krx = makeRealDateKrx({
      fetchStockDaily: jest.fn((basDd: string) =>
        Promise.resolve(basDd === '20260616' ? [] : [sampleRow]),
      ),
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.catchUpDailyPrices('CRON');

    expect(result.emptyDates).toEqual(['20260616']);
    expect(result.filledDates).not.toContain('20260616');
    expect(result.filledDates).toHaveLength(8);
  });

  it('일봉 캐치업: 이미 최신(lastLoaded=6/18=target)이면 no-op(로그·수집 없음)', async () => {
    const krx = makeRealDateKrx();
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260618' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.catchUpDailyPrices('CRON');

    expect(result.target).toBe('20260618');
    expect(result.filledDates).toEqual([]);
    expect(prisma.stockDailyPrice.createMany).not.toHaveBeenCalled();
    expect(prisma.marketDataCollectionLog.create).not.toHaveBeenCalled();
  });

  it('일봉 캐치업: 저장소 비어있음(부트스트랩) → target 1일만 수집', async () => {
    const krx = makeRealDateKrx({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
    });
    const prisma = makePrisma(); // stockDailyPrice.findFirst 기본 null
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.catchUpDailyPrices('CRON');

    expect(result.lastLoaded).toBeNull();
    expect(result.filledDates).toEqual(['20260618']);
    expect(prisma.stockDailyPrice.createMany).toHaveBeenCalledTimes(1);
  });

  it('지수 캐치업: 마지막 적재 지수일(6/5)~최신 가용(6/18) 누락분 백필', async () => {
    const krx = makeRealDateKrx();
    const prisma = makePrisma();
    // marketIndex.findFirst: lastLoaded(6/5) + 연속성 가드 prev(close 2700, ±2%로 통과)
    (prisma.marketIndex.findFirst as jest.Mock).mockResolvedValue({
      tradeDate: '20260605',
      closeIndex: 2700,
    });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.catchUpMarketIndices('CRON');

    expect(result.target).toBe('20260618');
    expect(result.lastLoaded).toBe('20260605');
    expect(result.filledDates).toHaveLength(9); // 6/8~6/18 평일
    expect(result.totalSaved).toBe(18); // KOSPI+KOSDAQ × 9일
    expect(prisma.marketIndex.upsert).toHaveBeenCalledTimes(18);
  });

  it('지수 캐치업: 이미 최신이면 no-op', async () => {
    const krx = makeRealDateKrx();
    const prisma = makePrisma();
    (prisma.marketIndex.findFirst as jest.Mock).mockResolvedValue({
      tradeDate: '20260618',
      closeIndex: 2700,
    });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const result = await scheduler.catchUpMarketIndices('CRON');

    expect(result.filledDates).toEqual([]);
    expect(prisma.marketIndex.upsert).not.toHaveBeenCalled();
  });

  // ─── DAR-428: EOD 일봉 전진수집 cron 을 CronRunLog(market.daily-collect)에 기록 ───
  describe('collectDailyPrices — CronRunLog 헬스 기록 (DAR-428)', () => {
    function makeRecorder() {
      return {
        record: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
      } as unknown as import('../../cron-health/cron-run-recorder.service').CronRunRecorderService;
    }

    it('recorder 주입 시: market.daily-collect 키로 캐치업을 감싸 기록(적재건수=countOf) + 6/18 정체 전진', async () => {
      const krx = makeRealDateKrx({
        fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
        fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
      });
      const prisma = makePrisma();
      // 일봉 6/18 정체(이슈 실측). 캐치업이 6/18 너머로 전진하는지 확인.
      (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
      const recorder = makeRecorder();
      const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart(), recorder);

      const result = await scheduler.collectDailyPrices();

      // CronRunLog 래핑이 정확한 jobKey + countOf(totalSaved) 로 호출됨.
      expect(recorder.record).toHaveBeenCalledTimes(1);
      const [jobKey, , opts] = (recorder.record as jest.Mock).mock.calls[0];
      expect(jobKey).toBe('market.daily-collect');
      expect(opts.countOf(result)).toBe(result.totalSaved);
      // 락 조기반환만 SKIPPED — 정상 캐치업은 SUCCESS.
      expect(opts.isSkipped(result)).toBe(false);
      expect(opts.isSkipped({ message: '이전 작업 진행 중' })).toBe(true);
      // 일봉 6/5→6/18 갭 9 거래일 멱등 백필(정체 해소).
      expect(result.lastLoaded).toBe('20260605');
      expect(result.target).toBe('20260618');
      expect(result.filledDates).toHaveLength(9);
      expect(result.totalSaved).toBe(9);
    });

    it('recorder 미주입(테스트/배선 누락) 시: 기존 거동(직접 캐치업 호출) 보존', async () => {
      const krx = makeRealDateKrx({
        fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
        fetchKosqdaqDaily: jest.fn().mockResolvedValue([]),
      });
      const prisma = makePrisma();
      (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260617' });
      const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

      const result = await scheduler.collectDailyPrices();

      expect(result.filledDates).toEqual(['20260618']);
      expect(result.totalSaved).toBe(1);
    });
  });
});

// ─── KrxApiService 단위 ──────────────────────────────────────────────────────

describe('KrxApiService 유틸리티', () => {
  it('isWeekend: 토·일 true, 평일 false', () => {
    const { ConfigService } = require('@nestjs/config');
    const { KrxApiService: RealKrx } = require('./krx-api.service');
    const krx = new RealKrx(new ConfigService({}));
    expect(krx.isWeekend(new Date('2026-06-06'))).toBe(true); // 토
    expect(krx.isWeekend(new Date('2026-06-07'))).toBe(true); // 일
    expect(krx.isWeekend(new Date('2026-06-04'))).toBe(false); // 목
  });

  it('formatDate / parseDate 왕복 일치', () => {
    const { ConfigService } = require('@nestjs/config');
    const { KrxApiService: RealKrx } = require('./krx-api.service');
    const krx = new RealKrx(new ConfigService({}));
    const original = '20260604';
    expect(krx.formatDate(krx.parseDate(original))).toBe(original);
  });

  // DAR-329: parseDate(undefined) 가 `.slice` TypeError(500) 대신 명확한 에러로 거절
  it('parseDate: undefined/빈문자/형식불량 입력은 명확한 에러로 거절 (slice 크래시 방지)', () => {
    const { ConfigService } = require('@nestjs/config');
    const { KrxApiService: RealKrx } = require('./krx-api.service');
    const krx = new RealKrx(new ConfigService({}));
    expect(() => krx.parseDate(undefined as unknown as string)).toThrow(/8자리 YYYYMMDD/);
    expect(() => krx.parseDate('')).toThrow(/8자리 YYYYMMDD/);
    expect(() => krx.parseDate('2026-06-04')).toThrow(/8자리 YYYYMMDD/);
    expect(() => krx.parseDate('2026604')).toThrow(/8자리 YYYYMMDD/); // 7자리
    // 정상 8자리는 그대로 파싱
    const d = krx.parseDate('20260604');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-base 6월
    expect(d.getDate()).toBe(4);
  });

  it('KRX_API_KEY 미설정 시 fetchStockDaily → KrxApiUnavailableError', async () => {
    const { KrxApiService: RealKrx, KrxApiUnavailableError: Err } = require('./krx-api.service');
    // ConfigService를 명시적으로 mock — process.env 폴백 차단
    const mockConfig = { get: jest.fn().mockReturnValue(undefined) };
    const krx = new RealKrx(mockConfig);
    await expect(krx.fetchStockDaily('20260604')).rejects.toBeInstanceOf(Err);
  });
});

// ─── KrxApiService 엔드포인트 경로·파싱 검증 ────────────────────────────────

describe('KrxApiService 엔드포인트 경로·파싱', () => {
  const MOCK_KEY = 'test-api-key';

  function makeRealKrxWithAxiosMock(axiosGetImpl: jest.Mock) {
    const { KrxApiService: RealKrx } = require('./krx-api.service');
    const mockConfig = { get: jest.fn().mockReturnValue(MOCK_KEY) };
    const krx = new RealKrx(mockConfig);
    // axios 인스턴스의 get을 교체
    (krx as any).client = { get: axiosGetImpl };
    return krx;
  }

  function mockOutBlock1(rows: Record<string, string>[]) {
    return jest.fn().mockResolvedValue({ data: { 'OutBlock_1': rows } });
  }

  it('fetchStockDaily — sto/stk_bydd_trd 호출·파싱 (실제 필드명 ISU_CD/ISU_NM/ACC_TRDVOL/ACC_TRDVAL)', async () => {
    const axiosGet = mockOutBlock1([
      { ISU_CD: '005930', ISU_NM: '삼성전자', TDD_OPNPRC: '70,000', TDD_HGPRC: '71,000', TDD_LWPRC: '69,500', TDD_CLSPRC: '70,500', ACC_TRDVOL: '15,000,000', ACC_TRDVAL: '1,057,500,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchStockDaily('20260604', '005930');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/sto/stk_bydd_trd'),
      expect.any(Object),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stockCode).toBe('005930');
    expect(rows[0].closePrice).toBe(70500);
    expect(rows[0].volume).toBe(15_000_000);
    expect(rows[0].tradingValue).toBe(1_057_500_000_000);
  });

  it('fetchKosqdaqDaily — sto/ksq_bydd_trd 호출·파싱 (실제 필드명)', async () => {
    const axiosGet = mockOutBlock1([
      { ISU_CD: '035720', ISU_NM: '카카오', TDD_OPNPRC: '45,000', TDD_HGPRC: '46,000', TDD_LWPRC: '44,500', TDD_CLSPRC: '45,500', ACC_TRDVOL: '5,000,000', ACC_TRDVAL: '227,500,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchKosqdaqDaily('20260604', '035720');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/sto/ksq_bydd_trd'),
      expect.any(Object),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stockCode).toBe('035720');
    expect(rows[0].closePrice).toBe(45500);
    expect(rows[0].volume).toBe(5_000_000);
  });

  it('fetchKosqdaqDaily — ksq/ 경로 사용 안 함 (404 방지)', async () => {
    const axiosGet = mockOutBlock1([]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    await krx.fetchKosqdaqDaily('20260604');

    const calledUrl: string = axiosGet.mock.calls[0][0];
    expect(calledUrl).not.toContain('/ksq/');
    expect(calledUrl).toContain('/sto/ksq_bydd_trd');
  });

  // DAR-367: kospi_dd_trd 는 종합지수 외에 200·업종지수 등 여러 시리즈를 함께 반환한다.
  // 종합지수(IDX_NM='코스피') 행 1건만 선별하고, 업종지수 같은 다른 시리즈는 무시해야 한다.
  it('fetchIndexDaily KOSPI — 종합지수(IDX_NM=코스피) 행만 선별, 업종지수 무시', async () => {
    const axiosGet = mockOutBlock1([
      // 업종지수(고값) — 과거엔 마지막 행이 종합지수를 덮어써 8639 같은 오염값이 적재됐다.
      { IDX_NM: '운수창고업', CLSPRC_IDX: '8,639.41', OPNPRC_IDX: '8,600.00', HGPRC_IDX: '8,700.00', LWPRC_IDX: '8,500.00', ACC_TRDVOL: '1', ACC_TRDVAL: '1' },
      { IDX_NM: '코스피 200', CLSPRC_IDX: '360.10', OPNPRC_IDX: '358.00', HGPRC_IDX: '361.00', LWPRC_IDX: '357.00', ACC_TRDVOL: '1', ACC_TRDVAL: '1' },
      { IDX_NM: '코스피', CLSPRC_IDX: '2,720.50', OPNPRC_IDX: '2,700.00', HGPRC_IDX: '2,750.00', LWPRC_IDX: '2,680.00', ACC_TRDVOL: '500,000,000', ACC_TRDVAL: '10,000,000,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSPI', '20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/idx/kospi_dd_trd'),
      expect.any(Object),
    );
    expect(rows).toHaveLength(1); // 종합지수 1건만
    expect(rows[0].closeIndex).toBeCloseTo(2720.5, 1); // 8639.41(업종)이 아님
    expect(rows[0].volume).toBe(500_000_000);
  });

  it('fetchIndexDaily KOSDAQ — 종합지수(IDX_NM=코스닥) 행만 선별', async () => {
    const axiosGet = mockOutBlock1([
      { IDX_NM: '코스닥 150', CLSPRC_IDX: '1,400.00', OPNPRC_IDX: '1,390.00', HGPRC_IDX: '1,410.00', LWPRC_IDX: '1,385.00', ACC_TRDVOL: '1', ACC_TRDVAL: '1' },
      { IDX_NM: '코스닥', CLSPRC_IDX: '850.25', OPNPRC_IDX: '840.00', HGPRC_IDX: '855.00', LWPRC_IDX: '838.00', ACC_TRDVOL: '1,000,000,000', ACC_TRDVAL: '5,000,000,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSDAQ', '20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/idx/kosdaq_dd_trd'),
      expect.any(Object),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].closeIndex).toBeCloseTo(850.25, 2);
  });

  it('fetchIndexDaily — 종합지수 행 미발견 시 임의 행 적재 없이 빈 배열', async () => {
    const axiosGet = mockOutBlock1([
      { IDX_NM: '운수창고업', CLSPRC_IDX: '8,639.41', OPNPRC_IDX: '8,600.00', HGPRC_IDX: '8,700.00', LWPRC_IDX: '8,500.00', ACC_TRDVOL: '1', ACC_TRDVAL: '1' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSPI', '20260604');
    expect(rows).toEqual([]);
  });

  it('fetchStkIsuBaseInfo — sto/stk_isu_base_info 호출·파싱 (실제 필드명 ISU_SRT_CD/ISU_ABBRV)', async () => {
    const axiosGet = mockOutBlock1([
      { ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자보통주', ISU_ABBRV: '삼성전자' },
      { ISU_CD: 'KR7000660001', ISU_SRT_CD: '000660', ISU_NM: 'SK하이닉스보통주', ISU_ABBRV: 'SK하이닉스' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const result = await krx.fetchStkIsuBaseInfo('20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/sto/stk_isu_base_info'),
      expect.any(Object),
    );
    expect(result).toHaveLength(2);
    expect(result[0].stockCode).toBe('005930');
    expect(result[0].stockName).toBe('삼성전자');
    expect(result[0].marketType).toBe('KOSPI');
    expect(result[1].stockCode).toBe('000660');
  });

  it('fetchKsqIsuBaseInfo — sto/ksq_isu_base_info 호출·파싱 (실제 필드명)', async () => {
    const axiosGet = mockOutBlock1([
      { ISU_CD: 'KR7035720002', ISU_SRT_CD: '035720', ISU_NM: '카카오보통주', ISU_ABBRV: '카카오' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const result = await krx.fetchKsqIsuBaseInfo('20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/sto/ksq_isu_base_info'),
      expect.any(Object),
    );
    expect(result).toHaveLength(1);
    expect(result[0].stockCode).toBe('035720');
    expect(result[0].marketType).toBe('KOSDAQ');
  });

  it('fetchStockStatus — isu_mrktact_info 사용 안 함, stk/ksq_isu_base_info 사용', async () => {
    const axiosGet = jest.fn()
      .mockResolvedValueOnce({ data: { 'OutBlock_1': [{ ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자보통주', ISU_ABBRV: '삼성전자' }] } })
      .mockResolvedValueOnce({ data: { 'OutBlock_1': [{ ISU_CD: 'KR7035720002', ISU_SRT_CD: '035720', ISU_NM: '카카오보통주', ISU_ABBRV: '카카오' }] } });
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const statuses = await krx.fetchStockStatus('20260604');

    const calledUrls: string[] = axiosGet.mock.calls.map((c: any[]) => c[0] as string);
    expect(calledUrls.some((u) => u.includes('isu_mrktact_info'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('stk_isu_base_info'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('ksq_isu_base_info'))).toBe(true);
    expect(statuses).toHaveLength(2);
    expect(statuses[0].stockCode).toBe('005930');
    expect(statuses[1].stockCode).toBe('035720');
  });

  // DAR-330: isu_base_info 불가 시 일별매매정보(stk/ksq_bydd_trd)에서 시장분류 도출
  it('fetchMarketClassificationFallback — stk_bydd_trd→KOSPI, ksq_bydd_trd→KOSDAQ 로 분류', async () => {
    const axiosGet = jest
      .fn()
      // stk_bydd_trd (KOSPI)
      .mockResolvedValueOnce({
        data: {
          OutBlock_1: [
            { ISU_CD: '005930', ISU_NM: '삼성전자', TDD_CLSPRC: '70,500' },
            { ISU_CD: '000660', ISU_NM: 'SK하이닉스', TDD_CLSPRC: '180,000' },
          ],
        },
      })
      // ksq_bydd_trd (KOSDAQ)
      .mockResolvedValueOnce({
        data: { OutBlock_1: [{ ISU_CD: '035720', ISU_NM: '카카오', TDD_CLSPRC: '45,500' }] },
      });
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const result = await krx.fetchMarketClassificationFallback('20260604');

    const calledUrls: string[] = axiosGet.mock.calls.map((c: any[]) => c[0] as string);
    expect(calledUrls.some((u) => u.includes('/sto/stk_bydd_trd'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/sto/ksq_bydd_trd'))).toBe(true);
    // isu_base_info 엔드포인트는 사용하지 않음 — 빈 응답 회피가 목적
    expect(calledUrls.some((u) => u.includes('isu_base_info'))).toBe(false);

    expect(result).toHaveLength(3);
    const kospi = result.filter((r: KrxStockBaseInfo) => r.marketType === 'KOSPI');
    const kosdaq = result.filter((r: KrxStockBaseInfo) => r.marketType === 'KOSDAQ');
    expect(kospi.map((r: KrxStockBaseInfo) => r.stockCode).sort()).toEqual(['000660', '005930']);
    expect(kosdaq.map((r: KrxStockBaseInfo) => r.stockCode)).toEqual(['035720']);
  });
});

// ─── DAR-375: 최신 가용일 프로브 + 갭 캐치업 ────────────────────────────────────
// 근본 버그: resolveLatestAvailableTradeDate 가 '저장소 최신 적재일'을 반환해 크론이 6/5 에
// 영원히 정체(소스엔 6/8~6/18 존재). 교정: KRX 프로브로 실제 최신 가용일 산출 + 갭 멱등 백필.

// 실제 날짜 산술이 필요한 테스트용 KRX 목(makeKrxApi 의 parseDate/formatDate 는 상수 목이라
// 캐치업 walk 가 전진하지 못함). UTC 기준 결정론.
function realParseDate(ymd: string): Date {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
}
function realFormatDate(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}
function realIsWeekend(d: Date): boolean {
  const g = d.getUTCDay();
  return g === 0 || g === 6;
}
function makeRealDateKrx(overrides: Partial<KrxApiService> = {}): jest.Mocked<KrxApiService> {
  return makeKrxApi({
    parseDate: jest.fn(realParseDate) as unknown as KrxApiService['parseDate'],
    formatDate: jest.fn(realFormatDate) as unknown as KrxApiService['formatDate'],
    isWeekend: jest.fn(realIsWeekend) as unknown as KrxApiService['isWeekend'],
    ...overrides,
  });
}

const sampleDailyRow: KrxStockDailyRow = {
  stockCode: '005930',
  isuAbbrv: '삼성전자',
  openPrice: 70_000,
  highPrice: 71_000,
  lowPrice: 69_500,
  closePrice: 70_500,
  volume: 15_000_000,
  tradingValue: 1_057_500_000_000,
};
const sampleDailyRow2: KrxStockDailyRow = { ...sampleDailyRow, stockCode: '000660', isuAbbrv: 'SK하이닉스' };
const sampleIdx: KrxIndexDailyRow = {
  indexCode: '0001',
  indexName: 'KOSPI',
  openIndex: 2700,
  highIndex: 2750,
  lowIndex: 2680,
  closeIndex: 2720,
  volume: 500_000_000,
  tradingValue: 10_000_000_000_000,
};

describe('KrxMarketDataScheduler.probeLatestAvailableTradeDate (DAR-375)', () => {
  it('today(6/19)에 KRX 미게시면 직전 거래일(6/18)을 실제 최신 가용일로 채택', async () => {
    // 6/19 는 빈 응답(아직 미게시), 6/18 은 데이터 보유 → 6/18 채택.
    const fetchIndexDaily = jest.fn((_t: string, basDd: string) =>
      Promise.resolve(basDd === '20260618' ? [sampleIdx] : []),
    );
    const krx = makeRealDateKrx({
      fetchIndexDaily: fetchIndexDaily as unknown as KrxApiService['fetchIndexDaily'],
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    const probed = await scheduler.probeLatestAvailableTradeDate('20260619');

    expect(probed).toBe('20260618');
  });

  it('주말 시작일은 건너뛰고 직전 평일을 프로브한다 (6/20 토 → 6/19 금)', async () => {
    const fetchIndexDaily = jest.fn((_t: string, basDd: string) =>
      Promise.resolve(basDd === '20260619' ? [sampleIdx] : []),
    );
    const krx = makeRealDateKrx({
      fetchIndexDaily: fetchIndexDaily as unknown as KrxApiService['fetchIndexDaily'],
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    const probed = await scheduler.probeLatestAvailableTradeDate('20260620');

    expect(probed).toBe('20260619');
    // 토요일(6/20)은 KRX 호출 대상 아님(평일만 프로브).
    const probedDates: string[] = fetchIndexDaily.mock.calls.map((c) => c[1] as string);
    expect(probedDates).not.toContain('20260620');
  });

  it('KRX 미설정 — null 반환(호출자가 DB 최신일로 폴백)', async () => {
    const krx = makeRealDateKrx({
      fetchIndexDaily: jest
        .fn()
        .mockRejectedValue(new KrxApiUnavailableError('미설정')) as unknown as KrxApiService['fetchIndexDaily'],
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    expect(await scheduler.probeLatestAvailableTradeDate('20260619')).toBeNull();
  });

  it('maxProbeWeekdays 안에 데이터 없으면 null', async () => {
    const krx = makeRealDateKrx({
      fetchIndexDaily: jest.fn().mockResolvedValue([]) as unknown as KrxApiService['fetchIndexDaily'],
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    expect(await scheduler.probeLatestAvailableTradeDate('20260619', 5)).toBeNull();
  });
});

describe('KrxMarketDataScheduler.resolveLatestAvailableTradeDate — 프로브 우선 (DAR-375)', () => {
  it('명시 basDd 는 그대로 우선(프로브 안 함)', async () => {
    const fetchIndexDaily = jest.fn().mockResolvedValue([sampleIdx]);
    const krx = makeRealDateKrx({
      fetchIndexDaily: fetchIndexDaily as unknown as KrxApiService['fetchIndexDaily'],
    });
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());

    expect(await scheduler.resolveLatestAvailableTradeDate('20260601')).toBe('20260601');
    expect(fetchIndexDaily).not.toHaveBeenCalled();
  });

  it('★프로브가 저장소 정체(6/5)를 넘어 실제 최신일(6/18)로 전진', async () => {
    const krx = makeRealDateKrx();
    const scheduler = new KrxMarketDataScheduler(makePrisma(), krx, makeDart());
    // 저장소는 6/5 에 정체돼 있지만 프로브가 6/18 을 반환하도록 스텁 → resolver 는 6/18 채택.
    jest.spyOn(scheduler, 'probeLatestAvailableTradeDate').mockResolvedValue('20260618');
    const prismaFindFirst = jest.spyOn(scheduler['prisma'].stockDailyPrice, 'findFirst');

    const resolved = await scheduler.resolveLatestAvailableTradeDate();

    expect(resolved).toBe('20260618');
    // 프로브가 성공하면 DB 최신일 폴백 조회를 하지 않는다(전진이 저장소와 무관).
    expect(prismaFindFirst).not.toHaveBeenCalled();
  });

  it('프로브 불가(null) — DB 최신 적재일로 폴백', async () => {
    const krx = makeRealDateKrx();
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    jest.spyOn(scheduler, 'probeLatestAvailableTradeDate').mockResolvedValue(null);

    expect(await scheduler.resolveLatestAvailableTradeDate()).toBe('20260605');
  });
});

describe('KrxMarketDataScheduler computeCatchUpDates/weekdaysAfter (DAR-375)', () => {
  function sched() {
    return new KrxMarketDataScheduler(makePrisma(), makeRealDateKrx(), makeDart());
  }

  it('저장소 비어있음 → 부트스트랩 [target] 1일만', () => {
    expect((sched() as any).computeCatchUpDates(null, '20260618')).toEqual(['20260618']);
  });

  it('갭(6/5→6/18) → 그 사이 평일 전부(주말 제외, 6/5 미포함·6/18 포함)', () => {
    expect((sched() as any).computeCatchUpDates('20260605', '20260618')).toEqual([
      '20260608',
      '20260609',
      '20260610',
      '20260611',
      '20260612',
      '20260615',
      '20260616',
      '20260617',
      '20260618',
    ]);
  });

  it('이미 최신(lastLoaded ≥ target) → 빈 배열(멱등 no-op)', () => {
    expect((sched() as any).computeCatchUpDates('20260618', '20260618')).toEqual([]);
    expect((sched() as any).computeCatchUpDates('20260620', '20260618')).toEqual([]);
  });
});

describe('KrxMarketDataScheduler.catchUpDailyPrices (DAR-375)', () => {
  function makeScheduler(target: string, lastLoaded: string | null, krxOverrides: Partial<KrxApiService> = {}) {
    const krx = makeRealDateKrx({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleDailyRow]) as unknown as KrxApiService['fetchStockDaily'],
      fetchKosqdaqDaily: jest
        .fn()
        .mockResolvedValue([sampleDailyRow2]) as unknown as KrxApiService['fetchKosqdaqDaily'],
      ...krxOverrides,
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue(
      lastLoaded ? { tradeDate: lastLoaded } : null,
    );
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    jest.spyOn(scheduler, 'resolveLatestAvailableTradeDate').mockResolvedValue(target);
    return { scheduler, prisma, krx };
  }

  it('★갭(6/5→6/18) 누락 거래일 9일 전부 멱등 백필 + 6/5 이하 재수집 안 함', async () => {
    const { scheduler, prisma } = makeScheduler('20260618', '20260605');

    const res = await scheduler.catchUpDailyPrices('CRON');

    expect(res.filledDates).toEqual([
      '20260608',
      '20260609',
      '20260610',
      '20260611',
      '20260612',
      '20260615',
      '20260616',
      '20260617',
      '20260618',
    ]);
    expect(res.filledDates.every((d) => d > '20260605')).toBe(true);
    expect(res.totalSaved).toBe(18); // 9일 × 2종목
    // 캐치업 실행을 수집 로그에 기록(관측성).
    expect(prisma.marketDataCollectionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.marketDataCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
    );
  });

  it('휴장일(rowsFetched=0)은 emptyDates 로 분류하고 적재 안 함', async () => {
    const fetchStockDaily = jest.fn((basDd: string) =>
      Promise.resolve(basDd === '20260612' ? [] : [sampleDailyRow]),
    );
    const fetchKosqdaqDaily = jest.fn((basDd: string) =>
      Promise.resolve(basDd === '20260612' ? [] : [sampleDailyRow2]),
    );
    const { scheduler } = makeScheduler('20260618', '20260605', {
      fetchStockDaily: fetchStockDaily as unknown as KrxApiService['fetchStockDaily'],
      fetchKosqdaqDaily: fetchKosqdaqDaily as unknown as KrxApiService['fetchKosqdaqDaily'],
    });

    const res = await scheduler.catchUpDailyPrices('CRON');

    expect(res.emptyDates).toContain('20260612');
    expect(res.filledDates).not.toContain('20260612');
    expect(res.filledDates).toHaveLength(8);
  });

  it('이미 최신(target=lastLoaded) → 즉시 no-op(로그 생성 안 함)', async () => {
    const { scheduler, prisma } = makeScheduler('20260605', '20260605');

    const res = await scheduler.catchUpDailyPrices('CRON');

    expect(res.filledDates).toEqual([]);
    expect(prisma.marketDataCollectionLog.create).not.toHaveBeenCalled();
  });

  it('KRX 미설정 — graceful(로그 FAILED, message)', async () => {
    const { scheduler, prisma } = makeScheduler('20260618', '20260605', {
      fetchStockDaily: jest
        .fn()
        .mockRejectedValue(new KrxApiUnavailableError('미설정')) as unknown as KrxApiService['fetchStockDaily'],
    });

    const res = await scheduler.catchUpDailyPrices('CRON');

    expect(res.message).toBe('KRX API 미설정');
    expect(prisma.marketDataCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('중복 실행 가드 — 진행 중이면 즉시 반환', async () => {
    const { scheduler } = makeScheduler('20260618', '20260605');
    (scheduler as any).isDailyCollecting = true;

    const res = await scheduler.catchUpDailyPrices('CRON');

    expect(res.message).toBe('이전 작업 진행 중');
  });
});

describe('KrxMarketDataScheduler.catchUpMarketIndices (DAR-375)', () => {
  it('지수 갭(6/5→6/9) 누락일 백필 — 연속성 가드 통과분 적재', async () => {
    const krx = makeRealDateKrx({
      fetchIndexDaily: jest.fn().mockResolvedValue([sampleIdx]) as unknown as KrxApiService['fetchIndexDaily'],
    });
    const prisma = makePrisma();
    // marketIndex.findFirst: lastLoaded 조회 + 연속성 가드 prev 조회 양쪽에 사용.
    // closeIndex 2700 vs sampleIdx 2720 → +0.74% → 가드 통과.
    (prisma.marketIndex.findFirst as jest.Mock).mockResolvedValue({
      tradeDate: '20260605',
      closeIndex: 2700,
    });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    jest.spyOn(scheduler, 'resolveLatestAvailableTradeDate').mockResolvedValue('20260609');

    const res = await scheduler.catchUpMarketIndices('CRON');

    // 6/8·6/9 두 거래일, 각 KOSPI+KOSDAQ = 4건 적재.
    expect(res.filledDates).toEqual(['20260608', '20260609']);
    expect(res.totalSaved).toBe(4);
    expect(res.quarantined).toBe(0);
  });

  it('저장소 비어있음 → 부트스트랩 target 1일만', async () => {
    const krx = makeRealDateKrx({
      fetchIndexDaily: jest.fn().mockResolvedValue([sampleIdx]) as unknown as KrxApiService['fetchIndexDaily'],
    });
    const prisma = makePrisma(); // marketIndex.findFirst 기본 null
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());
    jest.spyOn(scheduler, 'resolveLatestAvailableTradeDate').mockResolvedValue('20260618');

    const res = await scheduler.catchUpMarketIndices('CRON');

    expect(res.filledDates).toEqual(['20260618']);
    expect(res.totalSaved).toBe(2);
  });
});

// ─── DAR-376: 과거 깊이 백필(재개) + 커버리지 리포트 + 품질 가드 ──────────────────
const validDaily: KrxStockDailyRow = {
  stockCode: '005930',
  isuAbbrv: '삼성전자',
  openPrice: 70_000,
  highPrice: 71_000,
  lowPrice: 69_500,
  closePrice: 70_500,
  volume: 15_000_000,
  tradingValue: 1_057_500_000_000,
};

describe('KrxMarketDataScheduler.backfillDailyHistoryDeep (DAR-376)', () => {
  it('가장 오래된 적재일(6/5) 직전부터 더 과거로 이어 수집 + 수집로그 기록', async () => {
    const krx = makeRealDateKrx({
      fetchStockDaily: jest.fn().mockResolvedValue([validDaily]) as unknown as KrxApiService['fetchStockDaily'],
      fetchKosqdaqDaily: jest
        .fn()
        .mockResolvedValue([{ ...validDaily, stockCode: '000660' }]) as unknown as KrxApiService['fetchKosqdaqDaily'],
    });
    const prisma = makePrisma();
    // earliest 적재일 = 6/5 → resumeFrom = 6/4.
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const res = await scheduler.backfillDailyHistoryDeep({ days: 2, delayMs: 0 });

    expect(res.earliestBefore).toBe('20260605');
    expect(res.resumedFrom).toBe('20260604'); // 6/5 - 1
    expect(res.collectedDays).toBe(2); // 6/4·6/3 (평일)
    expect(res.totalSaved).toBeGreaterThan(0);
    expect(prisma.marketDataCollectionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.marketDataCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
    );
  });

  it('저장소 비어있음 → today 부트스트랩(earliestBefore null)', async () => {
    const krx = makeRealDateKrx({
      fetchStockDaily: jest.fn().mockResolvedValue([validDaily]) as unknown as KrxApiService['fetchStockDaily'],
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([]) as unknown as KrxApiService['fetchKosqdaqDaily'],
    });
    const prisma = makePrisma(); // findFirst 기본 null
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const res = await scheduler.backfillDailyHistoryDeep({ days: 1, delayMs: 0 });

    expect(res.earliestBefore).toBeNull();
    expect(res.resumedFrom).toMatch(/^[0-9]{8}$/);
  });

  it('KRX 미설정 — graceful(로그 PARTIAL, message 전파)', async () => {
    const krx = makeRealDateKrx({
      fetchStockDaily: jest
        .fn()
        .mockRejectedValue(new KrxApiUnavailableError('미설정')) as unknown as KrxApiService['fetchStockDaily'],
    });
    const prisma = makePrisma();
    (prisma.stockDailyPrice.findFirst as jest.Mock).mockResolvedValue({ tradeDate: '20260605' });
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const res = await scheduler.backfillDailyHistoryDeep({ days: 5, delayMs: 0 });

    expect(res.message).toBe('KRX API 미설정');
    expect(prisma.marketDataCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL' }) }),
    );
  });
});

describe('KrxMarketDataScheduler.getDailyCoverageReport (DAR-376)', () => {
  it('유니버스 대비 누락 종목·거래일 범위·총 행수 리포트', async () => {
    const prisma = makePrisma();
    (prisma.company.findMany as jest.Mock).mockResolvedValue([
      { stockCode: '005930' },
      { stockCode: '000660' },
      { stockCode: '035720' }, // 일봉 전무 → missing
    ]);
    (prisma.stockDailyPrice as any).aggregate = jest
      .fn()
      .mockResolvedValue({ _min: { tradeDate: '20260101' }, _max: { tradeDate: '20260618' } });
    (prisma.stockDailyPrice as any).groupBy = jest.fn((arg: { by: string[] }) =>
      Promise.resolve(
        arg.by[0] === 'stockCode'
          ? [{ stockCode: '005930' }, { stockCode: '000660' }] // 2 종목만 데이터 보유
          : Array.from({ length: 100 }, (_, i) => ({ tradeDate: String(i) })), // 거래일 100일
      ),
    );
    (prisma.stockDailyPrice as any).count = jest.fn().mockResolvedValue(5_000);
    const scheduler = new KrxMarketDataScheduler(prisma, makeKrxApi(), makeDart());

    const rep = await scheduler.getDailyCoverageReport();

    expect(rep.universeSize).toBe(3);
    expect(rep.stocksWithData).toBe(2);
    expect(rep.missingStockCount).toBe(1);
    expect(rep.missingStockSample).toEqual(['035720']);
    expect(rep.tradeDateMin).toBe('20260101');
    expect(rep.tradeDateMax).toBe('20260618');
    expect(rep.tradingDayCount).toBe(100);
    expect(rep.totalRows).toBe(5_000);
  });
});

describe('KrxMarketDataScheduler.collectDailyPricesBulkForDate 품질 가드 (DAR-376)', () => {
  it('손상 행(고가<저가)은 적재 거부(skipped), 정상 행만 saved', async () => {
    const corrupt: KrxStockDailyRow = {
      stockCode: '000660',
      isuAbbrv: 'SK하이닉스',
      openPrice: 100,
      highPrice: 90, // 고가 < 저가 → 손상
      lowPrice: 110,
      closePrice: 100,
      volume: 1,
      tradingValue: 1,
    };
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([validDaily]) as unknown as KrxApiService['fetchStockDaily'],
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([corrupt]) as unknown as KrxApiService['fetchKosqdaqDaily'],
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const res = await scheduler.collectDailyPricesBulkForDate('20260604');

    expect(res.saved).toBe(1); // 정상 005930 만
    expect(res.skipped).toBe(1); // 손상 000660 거부
    const arg = (prisma.stockDailyPrice.createMany as jest.Mock).mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0].stockCode).toBe('005930');
  });

  it('음수·0 가격 행도 거부', async () => {
    const zero: KrxStockDailyRow = { ...validDaily, stockCode: '000660', closePrice: 0 };
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([validDaily]) as unknown as KrxApiService['fetchStockDaily'],
      fetchKosqdaqDaily: jest.fn().mockResolvedValue([zero]) as unknown as KrxApiService['fetchKosqdaqDaily'],
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx, makeDart());

    const res = await scheduler.collectDailyPricesBulkForDate('20260604');

    expect(res.saved).toBe(1);
    expect(res.skipped).toBe(1);
  });
});
