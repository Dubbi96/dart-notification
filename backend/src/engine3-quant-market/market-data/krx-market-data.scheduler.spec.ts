import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { KrxApiService, KrxApiUnavailableError, KrxStockDailyRow, KrxIndexDailyRow } from './krx-api.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeKrxApi(overrides: Partial<KrxApiService> = {}): jest.Mocked<KrxApiService> {
  return {
    fetchStockDaily: jest.fn().mockResolvedValue([]),
    fetchIndexDaily: jest.fn().mockResolvedValue([]),
    fetchStockStatus: jest.fn().mockResolvedValue([]),
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
