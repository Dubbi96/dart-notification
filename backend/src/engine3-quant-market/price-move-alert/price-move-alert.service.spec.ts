import { PriceMoveAlertService, PRICE_MOVE_DEFAULT_BATCH_SIZE } from './price-move-alert.service';

/**
 * PriceMoveAlertService 단위 스펙(갭분석 W7·W6) — DoD 보호:
 *  - 게이트: 킬스위치(env)·KIS 키 미설정·장외(정규장 밖)·겹침 → 무가동 스킵(ran=false).
 *  - 쿨다운: 같은 날 같은 종목은 두 번째 틱에서 재발화하지 않는다(종목당 1일 1회).
 *  - 배치 이월: 상한 초과 종목은 다음 틱으로 이월되고, 다음 틱에서 우선 처리된다.
 *  - 발화 페이로드: refId·딥링크(종목 상세)·뉴스 링크아웃·공시 병기 본문.
 *  - 판정 불가(전일 종가 없음·KIS null)는 발화하지 않는다(거짓 발화 0).
 */

/** KST 장중 평일 시각(2026-07-16 목요일 10:00 KST = 01:00 UTC). */
const MARKET_OPEN_NOW = new Date('2026-07-16T01:00:00Z');
/** KST 장외 시각(2026-07-16 목요일 20:00 KST). */
const OFF_HOURS_NOW = new Date('2026-07-16T11:00:00Z');
const TRADE_DATE = '20260716';

interface CompanyFixture {
  corpCode: string;
  corpName: string;
  stockCode: string;
}

const COMPANIES: CompanyFixture[] = [
  { corpCode: 'C001', corpName: '알파전자', stockCode: '000100' },
  { corpCode: 'C002', corpName: '베타화학', stockCode: '000200' },
  { corpCode: 'C003', corpName: '감마소재', stockCode: '000300' },
];

const makePrisma = (companies: CompanyFixture[] = COMPANIES) => ({
  watchList: {
    findMany: jest.fn().mockResolvedValue(companies.map((c) => ({ corpCode: c.corpCode }))),
  },
  company: { findMany: jest.fn().mockResolvedValue(companies) },
  stockDailyPrice: {
    // 종목별 전일 일봉: groupBy(max) → findMany(rows). 기본 전일 종가 10,000원.
    groupBy: jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(
        (where.stockCode.in as string[]).map((code) => ({
          stockCode: code,
          _max: { tradeDate: '20260715' },
        })),
      ),
    ),
    findMany: jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(
        (where.OR as { stockCode: string }[]).map((p) => ({
          stockCode: p.stockCode,
          closePrice: 10_000,
        })),
      ),
    ),
  },
  disclosure: {
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  stockStatusDaily: { findFirst: jest.fn().mockResolvedValue(null) },
  companyOverview: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
});

const makeKis = () => ({
  isConfigured: true,
  // 기본: 보합(0%) — 개별 테스트가 종목별 가격을 오버라이드.
  fetchCurrentPrice: jest.fn().mockImplementation((stockCode: string) =>
    Promise.resolve({ stockCode, price: 10_000, open: 0, high: 0, low: 0, volume: 0 }),
  ),
});

const makeConfig = (env: Record<string, string | undefined> = {}) => ({
  get: jest.fn().mockImplementation((key: string) => env[key]),
});

const makeDeps = (opts?: {
  companies?: CompanyFixture[];
  env?: Record<string, string | undefined>;
}) => {
  const prisma = makePrisma(opts?.companies);
  const kis = makeKis();
  const producer = { enqueuePriceMove: jest.fn().mockResolvedValue(undefined) };
  const config = makeConfig(opts?.env);
  const service = new PriceMoveAlertService(
    prisma as any,
    kis as any,
    producer as any,
    config as any,
  );
  return { service, prisma, kis, producer, config };
};

/** 특정 종목만 급변동(+6%) — 나머지는 보합. */
const primeSurge = (kis: ReturnType<typeof makeKis>, surgingCodes: string[], pct = 6) => {
  kis.fetchCurrentPrice.mockImplementation((stockCode: string) =>
    Promise.resolve({
      stockCode,
      price: surgingCodes.includes(stockCode) ? Math.round(10_000 * (1 + pct / 100)) : 10_000,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
    }),
  );
};

describe('PriceMoveAlertService (갭분석 W7·W6)', () => {
  // ── 게이트 ─────────────────────────────────────────────────────────────────
  describe('무가동 게이트(스킵 시 KIS 호출 0)', () => {
    it('킬스위치 PRICE_MOVE_ALERT_ENABLED=false → DISABLED 스킵', async () => {
      const { service, kis } = makeDeps({ env: { PRICE_MOVE_ALERT_ENABLED: 'false' } });
      const r = await service.runTick(MARKET_OPEN_NOW);
      expect(r).toMatchObject({ ran: false, skipReason: 'DISABLED' });
      expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
    });

    it('킬스위치 미설정(기본)이면 가동', async () => {
      const { service } = makeDeps();
      const r = await service.runTick(MARKET_OPEN_NOW);
      expect(r.ran).toBe(true);
    });

    it('KIS 키 미설정 → KIS_NOT_CONFIGURED 스킵(graceful)', async () => {
      const { service, kis } = makeDeps();
      (kis as any).isConfigured = false;
      const r = await service.runTick(MARKET_OPEN_NOW);
      expect(r).toMatchObject({ ran: false, skipReason: 'KIS_NOT_CONFIGURED' });
    });

    it('정규장 밖(평일 20:00 KST) → OFF_HOURS 스킵', async () => {
      const { service, kis } = makeDeps();
      const r = await service.runTick(OFF_HOURS_NOW);
      expect(r).toMatchObject({ ran: false, skipReason: 'OFF_HOURS' });
      expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
    });

    it('주말(토요일 10:00 KST) → OFF_HOURS 스킵', async () => {
      const { service } = makeDeps();
      const saturday = new Date('2026-07-18T01:00:00Z');
      const r = await service.runTick(saturday);
      expect(r).toMatchObject({ ran: false, skipReason: 'OFF_HOURS' });
    });
  });

  // ── ±5% 판정·발화 페이로드 ─────────────────────────────────────────────────
  describe('발화·페이로드', () => {
    it("+6% 종목만 발화 — refId·딥링크('왜 움직였나' 카드)·뉴스 링크아웃·본문 공시 병기", async () => {
      const { service, kis, producer, prisma } = makeDeps();
      primeSurge(kis, ['000200'], 6);
      prisma.disclosure.count.mockResolvedValueOnce(2); // 당일 공시 2건(첫 count 호출)

      const r = await service.runTick(MARKET_OPEN_NOW);

      expect(r).toMatchObject({ ran: true, scanned: 3, fired: 1 });
      expect(producer.enqueuePriceMove).toHaveBeenCalledTimes(1);
      const payload = producer.enqueuePriceMove.mock.calls[0][0];
      expect(payload).toMatchObject({
        refId: `000200-${TRADE_DATE}`,
        corpCode: 'C002',
        stockCode: '000200',
        corpName: '베타화학',
        tradeDate: TRADE_DATE,
        prevClose: 10_000,
        price: 10_600,
        // DAR-526: 카드(`/price-move/<refId>`)로 재타겟 — 기업상세(`/company/<corpCode>`)가 아님.
        deepLink: `/price-move/000200-${TRADE_DATE}`,
        newsUrl: 'https://finance.naver.com/item/news.naver?code=000200',
      });
      expect(payload.changePct).toBeCloseTo(6.0);
      expect(payload.title).toBe('베타화학 급변동 +6.0%');
      expect(payload.body).toContain('오늘 공시 2건');
      expect(payload.body).toContain('준실시간(최대 5분 지연)');
    });

    it('-5% 하락(경계)도 발화', async () => {
      const { service, kis, producer } = makeDeps();
      primeSurge(kis, ['000100'], -5);
      const r = await service.runTick(MARKET_OPEN_NOW);
      expect(r.fired).toBe(1);
      expect(producer.enqueuePriceMove.mock.calls[0][0].changePct).toBeCloseTo(-5.0);
    });

    it('±5% 미만은 발화 0', async () => {
      const { service, kis, producer } = makeDeps();
      primeSurge(kis, ['000100'], 4.9);
      const r = await service.runTick(MARKET_OPEN_NOW);
      expect(r.fired).toBe(0);
      expect(producer.enqueuePriceMove).not.toHaveBeenCalled();
    });

    it('전일 종가 미보유 종목은 판정 불가 — KIS 호출·발화 없이 스킵(거짓 발화 0)', async () => {
      const { service, kis, producer, prisma } = makeDeps();
      primeSurge(kis, ['000100', '000200', '000300'], 10);
      prisma.stockDailyPrice.groupBy.mockResolvedValue([
        { stockCode: '000100', _max: { tradeDate: '20260715' } },
      ]);
      prisma.stockDailyPrice.findMany.mockResolvedValue([
        { stockCode: '000100', closePrice: 10_000 },
      ]);

      const r = await service.runTick(MARKET_OPEN_NOW);

      expect(r.scanned).toBe(1); // 일봉 보유 종목만 현재가 조회
      expect(r.fired).toBe(1);
      expect(producer.enqueuePriceMove.mock.calls[0][0].stockCode).toBe('000100');
    });

    it('KIS 현재가 null(장애) 종목은 발화하지 않는다', async () => {
      const { service, kis, producer } = makeDeps();
      kis.fetchCurrentPrice.mockResolvedValue(null);
      const r = await service.runTick(MARKET_OPEN_NOW);
      expect(r.fired).toBe(0);
      expect(producer.enqueuePriceMove).not.toHaveBeenCalled();
    });

    it('무공시(48h 0건) 발화 본문에 팩트체크 근거 병기(W6 — 시장조치·조회공시)', async () => {
      const { service, kis, producer, prisma } = makeDeps();
      primeSurge(kis, ['000100'], 8);
      prisma.disclosure.count.mockResolvedValue(0); // 오늘 0건 + 48h 0건
      prisma.stockStatusDaily.findFirst.mockResolvedValue({
        isTradingSuspended: false,
        isInvestmentCaution: true,
        isAbnormalSurge: false,
      });
      prisma.disclosure.findFirst.mockResolvedValue({ rcpNo: 'r1' }); // 조회공시 존재

      await service.runTick(MARKET_OPEN_NOW);

      const payload = producer.enqueuePriceMove.mock.calls[0][0];
      expect(payload.body).toContain('관련 공시 없음(최근 48시간)');
      expect(payload.body).toContain('투자주의 지정');
      expect(payload.body).toContain('시황변동 조회공시 있음');
    });
  });

  // ── 쿨다운(종목당 1일 1회) ─────────────────────────────────────────────────
  describe('쿨다운 — 종목당 1일 1회(인메모리 1차)', () => {
    it('같은 날 두 번째 틱에서는 같은 종목을 재발화하지 않는다', async () => {
      const { service, kis, producer } = makeDeps();
      primeSurge(kis, ['000200'], 6);

      const first = await service.runTick(MARKET_OPEN_NOW);
      expect(first.fired).toBe(1);

      const later = new Date(MARKET_OPEN_NOW.getTime() + 5 * 60_000);
      const second = await service.runTick(later);
      expect(second.fired).toBe(0);
      expect(producer.enqueuePriceMove).toHaveBeenCalledTimes(1);
    });

    it('날짜가 바뀌면 쿨다운이 리셋되어 재발화 가능', async () => {
      const { service, kis, producer } = makeDeps();
      primeSurge(kis, ['000200'], 6);

      await service.runTick(MARKET_OPEN_NOW);
      // 다음 거래일(금요일) 같은 장중 시각.
      const nextDay = new Date('2026-07-17T01:00:00Z');
      const r = await service.runTick(nextDay);

      expect(r.fired).toBe(1);
      expect(producer.enqueuePriceMove).toHaveBeenCalledTimes(2);
      expect(producer.enqueuePriceMove.mock.calls[1][0].refId).toBe('000200-20260717');
    });
  });

  // ── 배치 상한·이월 ─────────────────────────────────────────────────────────
  describe('배치 상한 + 초과분 이월(매매 루프 우선 — KIS 유량 보호)', () => {
    it('배치 상한 초과 종목은 다음 틱으로 이월되고, 다음 틱에서 우선 처리된다', async () => {
      const { service, kis } = makeDeps({
        env: { PRICE_MOVE_ALERT_BATCH_SIZE: '2' },
      });
      primeSurge(kis, [], 0); // 발화 없음 — 스캔 대상 추적만

      const first = await service.runTick(MARKET_OPEN_NOW);
      expect(first).toMatchObject({ ran: true, scanned: 2, carried: 1 });
      const firstScanned = kis.fetchCurrentPrice.mock.calls.map((c) => c[0]);
      expect(firstScanned).toEqual(['000100', '000200']);

      kis.fetchCurrentPrice.mockClear();
      const later = new Date(MARKET_OPEN_NOW.getTime() + 5 * 60_000);
      const second = await service.runTick(later);
      // 이월분(000300) 우선 처리 후 나머지 재순회.
      const secondScanned = kis.fetchCurrentPrice.mock.calls.map((c) => c[0]);
      expect(secondScanned[0]).toBe('000300');
      expect(second.ran).toBe(true);
    });

    it('배치 크기 미설정 시 기본값 사용', () => {
      const { service } = makeDeps();
      expect(service.batchSize).toBe(PRICE_MOVE_DEFAULT_BATCH_SIZE);
    });
  });

  // ── 유니버스 없음 ─────────────────────────────────────────────────────────
  it('관심종목 0 이면 KIS 호출 없이 정상 종료(ran=true·scanned=0)', async () => {
    const { service, prisma, kis } = makeDeps();
    prisma.watchList.findMany.mockResolvedValue([]);
    const r = await service.runTick(MARKET_OPEN_NOW);
    expect(r).toMatchObject({ ran: true, scanned: 0, fired: 0 });
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
  });
});
