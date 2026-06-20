import {
  BacktestSignalAssemblyService,
  parseRcpDtToInstant,
} from './backtest-signal-assembly.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';

/** rcpDt → DisclosureSignal row(셀렉트 형상) */
function row(rcpNo: string, rcpDt: string, buyScore: number, persona = 'GROWTH') {
  return {
    rcpNo,
    corpCode: `A${rcpNo}`,
    stockCode: rcpNo.slice(-6).padStart(6, '0'),
    eventType: 'SUPPLY_CONTRACT',
    persona,
    buyScore,
    disclosure: { rcpDt },
  };
}

describe('parseRcpDtToInstant — rcpDt → KST 왕복', () => {
  const calendar = new MarketCalendarService();

  it('14자리(YYYYMMDDHHmmss) 장후 공시 → 같은 KST 거래일', () => {
    const inst = parseRcpDtToInstant('20250619163000'); // 16:30 KST
    expect(calendar.formatDate(inst)).toBe('2025-06-19');
    expect(calendar.isAfterMarket(inst)).toBe(true);
  });

  it('8자리(YYYYMMDD) 시각미상 → 09:00 KST 장중 가정·같은 거래일', () => {
    const inst = parseRcpDtToInstant('20250619');
    expect(calendar.formatDate(inst)).toBe('2025-06-19');
    expect(calendar.isAfterMarket(inst)).toBe(false);
  });
});

describe('BacktestSignalAssemblyService — point-in-time 신호 조립', () => {
  let captured: { where?: Record<string, unknown> } = {};
  let returnedRows: ReturnType<typeof row>[] = [];

  const prisma = {
    tradingSignal: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        captured.where = args.where;
        return returnedRows;
      }),
    },
  } as unknown as import('../../../prisma/prisma.service').PrismaService;

  const service = new BacktestSignalAssemblyService(prisma);

  beforeEach(() => {
    captured = {};
    returnedRows = [];
    (prisma.tradingSignal.findMany as jest.Mock).mockClear();
  });

  it('★lookahead 0: rcpDt 구간 경계를 DB where 로 강제(미래 공시 미참조)', async () => {
    await service.assemble('2025-06-19', '2026-06-20', { minBuyScore: 50 });
    const where = captured.where as {
      disclosure: { rcpDt: { gte: string; lte: string } };
      buyScore?: { gte: number };
    };
    // 시작 경계: 구간 시작 compact, 종료 경계: 종일 포함 ceil
    expect(where.disclosure.rcpDt.gte).toBe('20250619');
    expect(where.disclosure.rcpDt.lte).toBe('20260620999999');
    expect(where.buyScore).toEqual({ gte: 50 });
  });

  it('시간순(발생일 asc) + 동일 시점 buyScore 내림차순 정렬', async () => {
    returnedRows = [
      row('111', '20250901', 60),
      row('222', '20250701', 55),
      row('333', '20250701', 80), // 같은 날, 더 높은 점수
    ];
    const signals = await service.assemble('2025-06-19', '2026-06-20');
    expect(signals.map((s) => s.rcpNo)).toEqual(['333', '222', '111']);
    expect(signals[0].disclosureAt.getTime()).toBeLessThanOrEqual(
      signals[2].disclosureAt.getTime(),
    );
  });

  it('persona 한정 옵션 → where.persona in', async () => {
    await service.assemble('2025-06-19', '2026-06-20', { personas: ['GROWTH', 'VALUE'] });
    const where = captured.where as { persona?: { in: string[] } };
    expect(where.persona).toEqual({ in: ['GROWTH', 'VALUE'] });
  });

  it('minBuyScore 미지정 시 buyScore 필터 없음(전수)', async () => {
    await service.assemble('2025-06-19', '2026-06-20');
    const where = captured.where as { buyScore?: unknown };
    expect(where.buyScore).toBeUndefined();
  });
});
