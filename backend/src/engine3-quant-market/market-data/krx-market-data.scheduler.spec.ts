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
    },
    marketIndex: { upsert: jest.fn().mockResolvedValue({}) },
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

  it('fetchIndexDaily KOSPI — idx/kospi_dd_trd 호출', async () => {
    const axiosGet = mockOutBlock1([
      { CLSPRC_IDX: '2,720.50', OPNPRC_IDX: '2,700.00', HGPRC_IDX: '2,750.00', LWPRC_IDX: '2,680.00', ACC_TRDVOL: '500,000,000', ACC_TRDVAL: '10,000,000,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSPI', '20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/idx/kospi_dd_trd'),
      expect.any(Object),
    );
    expect(rows[0].closeIndex).toBeCloseTo(2720.5, 1);
    expect(rows[0].volume).toBe(500_000_000);
  });

  it('fetchIndexDaily KOSDAQ — idx/kosdaq_dd_trd 호출', async () => {
    const axiosGet = mockOutBlock1([
      { CLSPRC_IDX: '850.25', OPNPRC_IDX: '840.00', HGPRC_IDX: '855.00', LWPRC_IDX: '838.00', ACC_TRDVOL: '1,000,000,000', ACC_TRDVAL: '5,000,000,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSDAQ', '20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/idx/kosdaq_dd_trd'),
      expect.any(Object),
    );
    expect(rows[0].closeIndex).toBeCloseTo(850.25, 2);
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
});
