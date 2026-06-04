import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { KrxApiService, KrxApiUnavailableError, KrxStockDailyRow, KrxIndexDailyRow, KrxStockBaseInfo } from './krx-api.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

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
    },
    stockDailyPrice: { upsert: jest.fn().mockResolvedValue({}) },
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

  it('정상 수집 — 회사 수만큼 upsert 호출', async () => {
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectDailyPricesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(2); // 2개 회사 각각 1건
    expect(prisma.stockDailyPrice.upsert).toHaveBeenCalledTimes(2);
  });

  it('주말이면 수집 스킵하고 0 반환', async () => {
    const krx = makeKrxApi({ isWeekend: jest.fn().mockReturnValue(true) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectDailyPricesForDate('20260606', 'CRON');

    expect(result.message).toBe('주말 스킵');
    expect(prisma.stockDailyPrice.upsert).not.toHaveBeenCalled();
  });

  it('중복 실행 시 두 번째 호출은 즉시 반환', async () => {
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockResolvedValue([sampleRow]),
    });
    const prisma = makePrisma();

    let resolveFirst!: () => void;
    const firstPromise = new Promise<void>((r) => (resolveFirst = r));
    (prisma.stockDailyPrice.upsert as jest.Mock).mockImplementation(() => firstPromise);

    const scheduler = new KrxMarketDataScheduler(prisma, krx);
    const first = scheduler.collectDailyPricesForDate('20260604', 'CRON');
    const second = await scheduler.collectDailyPricesForDate('20260604', 'CRON');

    expect(second.message).toBe('이전 작업 진행 중');
    resolveFirst();
    await first;
  });

  it('KRX API 키 미설정 — KrxApiUnavailableError graceful 처리', async () => {
    const krx = makeKrxApi({
      fetchStockDaily: jest.fn().mockRejectedValue(
        new KrxApiUnavailableError('KRX_API_KEY 미설정'),
      ),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectDailyPricesForDate('20260604', 'CRON');

    expect(result.message).toBe('KRX API 미설정');
    expect(result.saved).toBe(0);
  });

  it('closePrice=0 행은 스킵', async () => {
    const zeroRow: KrxStockDailyRow = { ...sampleRow, closePrice: 0 };
    const krx = makeKrxApi({ fetchStockDaily: jest.fn().mockResolvedValue([zeroRow]) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectDailyPricesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(2);
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
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(2); // KOSPI 1 + KOSDAQ 1
    expect(prisma.marketIndex.upsert).toHaveBeenCalledTimes(2);
  });

  it('closeIndex=0 행은 스킵', async () => {
    const zeroRow: KrxIndexDailyRow = { ...sampleKospi, closeIndex: 0 };
    const krx = makeKrxApi({ fetchIndexDaily: jest.fn().mockResolvedValue([zeroRow]) });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectMarketIndicesForDate('20260604', 'MANUAL');

    expect(result.saved).toBe(0);
  });

  it('KRX API 미설정 — graceful 처리', async () => {
    const krx = makeKrxApi({
      fetchIndexDaily: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

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
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

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
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectStockStatusesForDate('20260606', 'CRON');

    expect(result.message).toBe('주말 스킵');
  });

  it('KRX API 미설정 — graceful 처리', async () => {
    const krx = makeKrxApi({
      fetchStockStatus: jest.fn().mockRejectedValue(new KrxApiUnavailableError('미설정')),
    });
    const prisma = makePrisma();
    const scheduler = new KrxMarketDataScheduler(prisma, krx);

    const result = await scheduler.collectStockStatusesForDate('20260604', 'CRON');

    expect(result.message).toBe('KRX API 미설정');
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
    return jest.fn().mockResolvedValue({ data: { OutBlock1: rows } });
  }

  it('fetchStockDaily — sto/stk_bydd_trd 호출·파싱', async () => {
    const axiosGet = mockOutBlock1([
      { MKSC_SHRN_ISCD: '005930', ISU_ABBRV: '삼성전자', TDD_OPNPRC: '70,000', TDD_HGPRC: '71,000', TDD_LWPRC: '69,500', TDD_CLSPRC: '70,500', ACML_VOL: '15,000,000', ACML_TRAD_PBMN: '1,057,500,000,000' },
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
  });

  it('fetchKosqdaqDaily — sto/ksq_bydd_trd 호출·파싱', async () => {
    const axiosGet = mockOutBlock1([
      { MKSC_SHRN_ISCD: '035720', ISU_ABBRV: '카카오', TDD_OPNPRC: '45,000', TDD_HGPRC: '46,000', TDD_LWPRC: '44,500', TDD_CLSPRC: '45,500', ACML_VOL: '5,000,000', ACML_TRAD_PBMN: '227,500,000,000' },
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
      { CLSPRC_IDX: '2,720.50', OPNPRC_IDX: '2,700.00', HGPRC_IDX: '2,750.00', LWPRC_IDX: '2,680.00', ACML_VOL: '500,000,000', ACML_TRAD_PBMN: '10,000,000,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSPI', '20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/idx/kospi_dd_trd'),
      expect.any(Object),
    );
    expect(rows[0].closeIndex).toBeCloseTo(2720.5, 1);
  });

  it('fetchIndexDaily KOSDAQ — idx/kosdaq_dd_trd 호출', async () => {
    const axiosGet = mockOutBlock1([
      { CLSPRC_IDX: '850.25', OPNPRC_IDX: '840.00', HGPRC_IDX: '855.00', LWPRC_IDX: '838.00', ACML_VOL: '1,000,000,000', ACML_TRAD_PBMN: '5,000,000,000,000' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const rows = await krx.fetchIndexDaily('KOSDAQ', '20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/idx/kosdaq_dd_trd'),
      expect.any(Object),
    );
    expect(rows[0].closeIndex).toBeCloseTo(850.25, 2);
  });

  it('fetchStkIsuBaseInfo — sto/stk_isu_base_info 호출·파싱', async () => {
    const axiosGet = mockOutBlock1([
      { MKSC_SHRN_ISCD: '005930', ISU_ABBRV: '삼성전자' },
      { MKSC_SHRN_ISCD: '000660', ISU_ABBRV: 'SK하이닉스' },
    ]);
    const krx = makeRealKrxWithAxiosMock(axiosGet);

    const result = await krx.fetchStkIsuBaseInfo('20260604');

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/sto/stk_isu_base_info'),
      expect.any(Object),
    );
    expect(result).toHaveLength(2);
    expect(result[0].stockCode).toBe('005930');
    expect(result[0].marketType).toBe('KOSPI');
    expect(result[1].stockCode).toBe('000660');
  });

  it('fetchKsqIsuBaseInfo — sto/ksq_isu_base_info 호출·파싱', async () => {
    const axiosGet = mockOutBlock1([
      { MKSC_SHRN_ISCD: '035720', ISU_ABBRV: '카카오' },
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
      .mockResolvedValueOnce({ data: { OutBlock1: [{ MKSC_SHRN_ISCD: '005930', ISU_ABBRV: '삼성전자' }] } })
      .mockResolvedValueOnce({ data: { OutBlock1: [{ MKSC_SHRN_ISCD: '035720', ISU_ABBRV: '카카오' }] } });
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
