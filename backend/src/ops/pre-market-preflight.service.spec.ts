import { PreMarketPreflightService } from './pre-market-preflight.service';
import { PrismaService } from '../prisma/prisma.service';
import { KisApiService } from '../engine3-quant-market/market-data/kis-api.service';
import { AutoTradingStatusService } from '../engine5-trading-risk/services/auto-status.service';

/**
 * DAR-487(견고화 W3·P26) — 장 시작 전 프리플라이트 서비스 단위 테스트.
 * 휴장 스킵 · 토큰 워밍(OK/미설정/실패) · 전일 일봉 정합(정상/신선도/손상/데이터없음) ·
 * 리스크 상태(킬스위치/게이트) 격리 점검을 검증. now 주입으로 결정론.
 */
describe('PreMarketPreflightService (DAR-487)', () => {
  // 2026-07-02T23:30:00Z = 2026-07-03(금) 08:30 KST — 거래일. 직전 거래일 = 20260702(목).
  const TRADING_NOW = new Date('2026-07-02T23:30:00.000Z');
  // 2026-08-16T23:30:00Z = 2026-08-17(월) 08:30 KST — 광복절 대체공휴일(휴장).
  const HOLIDAY_NOW = new Date('2026-08-16T23:30:00.000Z');

  function makeKis(over: Partial<KisApiService> = {}): KisApiService {
    return {
      isConfigured: true,
      getAccessToken: jest.fn().mockResolvedValue('tok-abc'),
      ...over,
    } as unknown as KisApiService;
  }

  function makeAutoStatus(over: {
    killSwitch?: Partial<{ isActive: boolean; reason: string | null; triggeredBy: 'SYSTEM' | 'USER' }>;
    riskGate?: Partial<{ blocked: boolean; blockedReason: string | null }>;
  } = {}): AutoTradingStatusService {
    return {
      getStatus: jest.fn().mockResolvedValue({
        killSwitch: {
          isActive: false,
          reason: null,
          triggeredBy: 'SYSTEM',
          activatedAt: null,
          ...over.killSwitch,
        },
        riskGate: {
          blocked: false,
          status: 'NORMAL',
          blockedReason: null,
          ...over.riskGate,
        },
        recentOrders: [],
        executionEnabled: false,
        notice: '',
        asOf: TRADING_NOW.toISOString(),
      }),
    } as unknown as AutoTradingStatusService;
  }

  function makePrisma(opts: {
    latestTradeDate?: string | null;
    rows?: Array<{ openPrice: number; highPrice: number; lowPrice: number; closePrice: number }>;
  } = {}): PrismaService {
    const latest =
      opts.latestTradeDate === undefined
        ? { tradeDate: '20260702' }
        : opts.latestTradeDate === null
          ? null
          : { tradeDate: opts.latestTradeDate };
    const rows = opts.rows ?? [
      { openPrice: 100, highPrice: 110, lowPrice: 90, closePrice: 105 },
    ];
    return {
      stockDailyPrice: {
        findFirst: jest.fn().mockResolvedValue(latest),
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as unknown as PrismaService;
  }

  it('휴장일이면 이후 점검을 스킵하고 무발송(HOLIDAY)', async () => {
    const svc = new PreMarketPreflightService(makePrisma(), makeKis(), makeAutoStatus());
    const r = await svc.buildReport(HOLIDAY_NOW);
    expect(r.isTradingDay).toBe(false);
    expect(r.overall).toBe('HOLIDAY');
    expect(r.findings).toHaveLength(0);
    expect(r.checks).toEqual({
      kisToken: 'SKIPPED',
      dailyPriceSanity: 'SKIPPED',
      killSwitch: 'SKIPPED',
      riskGate: 'SKIPPED',
    });
    expect(r.tradingDateKst).toBe('2026-08-17');
  });

  it('거래일 + 전부 정상이면 overall OK · 이상 0 · 모든 점검 OK', async () => {
    const kis = makeKis();
    const svc = new PreMarketPreflightService(makePrisma(), kis, makeAutoStatus());
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.isTradingDay).toBe(true);
    expect(r.overall).toBe('OK');
    expect(r.findings).toHaveLength(0);
    expect(r.checks.kisToken).toBe('OK');
    expect(r.checks.dailyPriceSanity).toBe('OK');
    expect(r.checks.killSwitch).toBe('OK');
    expect(r.checks.riskGate).toBe('OK');
    // 유효 캐시 존중: getAccessToken 은 now 를 넘겨 호출(내부 캐시 판정에 사용).
    expect(kis.getAccessToken).toHaveBeenCalledWith(TRADING_NOW.getTime());
  });

  it('KIS 미설정이면 토큰 점검 SKIPPED · 발급 시도 없음', async () => {
    const kis = makeKis({ isConfigured: false });
    const svc = new PreMarketPreflightService(makePrisma(), kis, makeAutoStatus());
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.kisToken).toBe('SKIPPED');
    expect(kis.getAccessToken).not.toHaveBeenCalled();
    expect(r.findings.find((f) => f.check === 'kis-token')).toBeUndefined();
  });

  it('KIS 토큰 발급 실패면 FAIL · OPS 채널 ERROR 소견(throw 없음)', async () => {
    const kis = makeKis({
      getAccessToken: jest.fn().mockRejectedValue(new Error('발급 제한')),
    });
    const svc = new PreMarketPreflightService(makePrisma(), kis, makeAutoStatus());
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.kisToken).toBe('FAIL');
    const f = r.findings.find((x) => x.check === 'kis-token');
    expect(f).toBeDefined();
    expect(f?.channel).toBe('OPS');
    expect(f?.severity).toBe('ERROR');
    expect(r.overall).toBe('ANOMALY');
  });

  it('일봉 데이터가 없으면 정합 점검 SKIPPED(오탐 방지)', async () => {
    const svc = new PreMarketPreflightService(
      makePrisma({ latestTradeDate: null }),
      makeKis(),
      makeAutoStatus(),
    );
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.dailyPriceSanity).toBe('SKIPPED');
    expect(r.findings.find((f) => f.check === 'daily-price-sanity')).toBeUndefined();
  });

  it('최근 일봉이 예상 직전 거래일보다 오래되면 신선도 WARN(OPS)', async () => {
    // 20260701 < prevTradingDay(20260703)=20260702 → stale.
    const svc = new PreMarketPreflightService(
      makePrisma({ latestTradeDate: '20260701' }),
      makeKis(),
      makeAutoStatus(),
    );
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.dailyPriceSanity).toBe('WARN');
    const f = r.findings.find((x) => x.check === 'daily-price-sanity');
    expect(f?.channel).toBe('OPS');
    expect(f?.severity).toBe('WARNING');
    expect(f?.message).toContain('20260701');
  });

  it('최근 일봉에 손상 행이 있으면 정합 WARN(OPS)', async () => {
    const svc = new PreMarketPreflightService(
      makePrisma({
        latestTradeDate: '20260702',
        rows: [
          { openPrice: 100, highPrice: 110, lowPrice: 90, closePrice: 105 }, // 정상
          { openPrice: 100, highPrice: 80, lowPrice: 90, closePrice: 85 }, // 고<저 손상
        ],
      }),
      makeKis(),
      makeAutoStatus(),
    );
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.dailyPriceSanity).toBe('WARN');
    const f = r.findings.find((x) => x.check === 'daily-price-sanity');
    expect(f?.severity).toBe('WARNING');
    expect(f?.message).toContain('손상 행 1건');
  });

  it('킬스위치 발동이면 killSwitch·riskGate FAIL · RISK 채널 CRITICAL 소견(중복 없음)', async () => {
    const svc = new PreMarketPreflightService(
      makePrisma(),
      makeKis(),
      makeAutoStatus({
        killSwitch: { isActive: true, reason: '드로다운 한도', triggeredBy: 'SYSTEM' },
        riskGate: { blocked: true, blockedReason: '킬스위치 발동' },
      }),
    );
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.killSwitch).toBe('FAIL');
    expect(r.checks.riskGate).toBe('FAIL');
    const risk = r.findings.filter((f) => f.channel === 'RISK');
    expect(risk).toHaveLength(1); // 킬스위치 1건만(게이트 중복 억제)
    expect(risk[0].check).toBe('kill-switch');
    expect(risk[0].severity).toBe('CRITICAL');
  });

  it('킬스위치 미발동인데 게이트만 차단이면 risk-gate 소견(ERROR)', async () => {
    const svc = new PreMarketPreflightService(
      makePrisma(),
      makeKis(),
      makeAutoStatus({
        killSwitch: { isActive: false },
        riskGate: { blocked: true, blockedReason: '기타 차단' },
      }),
    );
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.killSwitch).toBe('OK');
    expect(r.checks.riskGate).toBe('FAIL');
    const f = r.findings.find((x) => x.check === 'risk-gate');
    expect(f?.channel).toBe('RISK');
    expect(f?.severity).toBe('ERROR');
  });

  it('리스크 상태 조회 실패는 graceful(SKIPPED, throw 없음)', async () => {
    const autoStatus = {
      getStatus: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as AutoTradingStatusService;
    const svc = new PreMarketPreflightService(makePrisma(), makeKis(), autoStatus);
    const r = await svc.buildReport(TRADING_NOW);
    expect(r.checks.killSwitch).toBe('SKIPPED');
    expect(r.checks.riskGate).toBe('SKIPPED');
    expect(r.findings.filter((f) => f.channel === 'RISK')).toHaveLength(0);
  });
});
