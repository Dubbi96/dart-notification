// DAR-411 — IntradayScalpService 1사이클 결정론 검증(분봉 fixture 기반).
//   유니버스 → 진입 평가 → 포지션 → 청산(익절/15:20 강제) 동작.
//   ★실주문 0 — 순수 모의 체결(simulateFill)만. 외부 주문 API 호출 없음.

import { IntradayScalpService } from './intraday-scalp.service';
import { INTRADAY_SCALP_STYLE_TAG } from './intraday-scalp-exit';

/** KST 평일 정규장 시각 헬퍼. 2026-06-22 = 월요일. */
function kstMonday(hhmm: string): Date {
  const hh = hhmm.slice(0, 2);
  const mm = hhmm.slice(2, 4);
  return new Date(`2026-06-22T${hh}:${mm}:00+09:00`);
}

interface ScalpRow {
  id: string;
  corpCode: string;
  stockCode: string;
  tradeDate: string;
  entryTs: Date;
  entryPrice: number;
  shares: number;
  entryReason: string;
  entryVwap?: number | null;
  entryVolumeRatio?: number | null;
  commission: number;
  tax: number;
  slippage: number;
  status: string;
  styleTag: string;
  exitTs?: Date | null;
  exitPrice?: number | null;
  exitReason?: string | null;
  holdMinutes?: number | null;
  grossPnl?: number | null;
  netPnl?: number | null;
  returnPct?: number | null;
}

/** 분봉 단타 진입 트리거 시계열: 평탄 25분(가격100·거래량100) + 현재 1분(close·high·vol). */
function triggerCandles(close: number, high: number, volume: number) {
  const rows: Array<{
    ts: Date;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    closePrice: number;
    volume: number;
  }> = [];
  for (let i = 0; i < 25; i++) {
    rows.push({
      ts: new Date(Date.UTC(2026, 5, 22, 0, i)),
      openPrice: 100,
      highPrice: 100,
      lowPrice: 100,
      closePrice: 100,
      volume: 100,
    });
  }
  rows.push({
    ts: new Date(Date.UTC(2026, 5, 22, 0, 25)),
    openPrice: close,
    highPrice: high,
    lowPrice: 99,
    closePrice: close,
    volume,
  });
  return rows;
}

/** 상태 보존 Prisma 목 — intradayScalpTrade 는 in-memory 배열로 진입/청산 라운드트립을 재현. */
function buildPrismaMock(opts: {
  universe: Array<{ stockCode: string; corpCode: string }>;
  candlesByStock: Record<string, ReturnType<typeof triggerCandles>>;
  signals?: Array<{ corpCode: string; stockCode: string }>;
  disclosures?: Array<{ corpCode: string }>;
}) {
  const trades: ScalpRow[] = [];
  let seq = 0;
  return {
    trades,
    prisma: {
      stockMinutePrice: {
        findMany: jest.fn(async (args: any) => {
          if (args?.distinct) {
            // 유니버스 — distinct stockCode
            return opts.universe;
          }
          // 분봉 로드 — where.stockCode + tradeDate
          return opts.candlesByStock[args.where.stockCode] ?? [];
        }),
      },
      tradingSignal: {
        findMany: jest.fn(async () => opts.signals ?? []),
      },
      disclosure: {
        findMany: jest.fn(async () => opts.disclosures ?? []),
      },
      intradayScalpTrade: {
        findMany: jest.fn(async (args: any) => {
          let out = trades;
          const w = args?.where ?? {};
          if (w.status) out = out.filter((t) => t.status === w.status);
          if (w.tradeDate) out = out.filter((t) => t.tradeDate === w.tradeDate);
          if (w.styleTag) out = out.filter((t) => t.styleTag === w.styleTag);
          return out.map((t) => ({ ...t }));
        }),
        create: jest.fn(async (args: any) => {
          const row: ScalpRow = { id: `t${++seq}`, ...args.data };
          trades.push(row);
          return { ...row };
        }),
        update: jest.fn(async (args: any) => {
          const row = trades.find((t) => t.id === args.where.id);
          if (row) Object.assign(row, args.data);
          return { ...(row as ScalpRow) };
        }),
      },
    } as any,
  };
}

describe('IntradayScalpService — 1사이클', () => {
  it('정규장 외/주말이면 진입 스킵(graceful)', async () => {
    const { prisma } = buildPrismaMock({ universe: [], candlesByStock: {} });
    const svc = new IntradayScalpService(prisma);
    const weekend = new Date('2026-06-20T10:00:00+09:00'); // 토요일
    const r = await svc.runEntryCycle(weekend);
    expect(r.skipped).toBe(true);
    expect(r.entered).toBe(0);
    expect(prisma.intradayScalpTrade.create).not.toHaveBeenCalled();
  });

  it('유니버스→진입: 3조건 충족 종목에 모의 진입(OPEN 영속)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));

    expect(r.skipped).toBe(false);
    expect(r.evaluated).toBe(1);
    expect(r.entered).toBe(1);
    expect(mock.trades).toHaveLength(1);
    const t = mock.trades[0];
    expect(t.status).toBe('OPEN');
    expect(t.styleTag).toBe(INTRADAY_SCALP_STYLE_TAG);
    expect(t.entryReason).toBe('VOLUME_BREAKOUT_VWAP');
    expect(t.shares).toBeGreaterThan(0);
    // 진입 체결가 = 종가 105 × (1+슬리피지) ≈ 105.05
    expect(t.entryPrice).toBeGreaterThan(105);
  });

  it('미진입 종목(거래량 미폭발)은 진입 0', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000002', corpCode: 'C2' }],
      signals: [{ corpCode: 'C2', stockCode: '000002' }],
      candlesByStock: { '000002': triggerCandles(105, 106, 150) }, // 1.5배 < 2.5배
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(0);
    expect(mock.trades).toHaveLength(0);
  });

  it('진입 후 익절(+2%) 청산 — CLOSED·netPnl·returnPct 기록', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    await svc.runEntryCycle(kstMonday('1000'));
    expect(mock.trades[0].status).toBe('OPEN');

    // 현재가를 +10% 위로 → 익절 트리거.
    mock.prisma.stockMinutePrice.findMany.mockImplementation(async (args: any) => {
      if (args?.distinct) return [{ stockCode: '000001', corpCode: 'C1' }];
      return triggerCandles(120, 121, 100); // 마지막 종가 120
    });
    const exit = await svc.runExitCycle(kstMonday('1030'));
    expect(exit.exited).toBe(1);
    const t = mock.trades[0];
    expect(t.status).toBe('CLOSED');
    expect(t.exitReason).toBe('TAKE_PROFIT');
    expect(t.netPnl).toBeGreaterThan(0);
    expect(t.returnPct).toBeGreaterThan(0);
    expect(t.holdMinutes).toBeGreaterThanOrEqual(0);
  });

  it('15:20 신규 진입 마감 — 진입 스킵', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1520'));
    expect(r.skipped).toBe(true);
    expect(r.reason).toContain('진입 마감');
    expect(mock.trades).toHaveLength(0);
  });

  it('15:20 전량 강제청산 — 손익 무관 모든 OPEN 청산(당일 청산 보장)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    await svc.runEntryCycle(kstMonday('1000'));
    expect(mock.trades[0].status).toBe('OPEN');

    // 현재가가 임계 미달(소폭 +0.5%)이어도 강제청산은 무조건 청산.
    mock.prisma.stockMinutePrice.findMany.mockImplementation(async (args: any) => {
      if (args?.distinct) return [{ stockCode: '000001', corpCode: 'C1' }];
      return triggerCandles(105, 106, 100);
    });
    const forced = await svc.forceCloseAll(kstMonday('1520'));
    expect(forced.exited).toBe(1);
    expect(mock.trades[0].status).toBe('CLOSED');
    expect(mock.trades[0].exitReason).toBe('FORCE_CLOSE_EOD');
  });

  it('getStatus: forward 누적·저표본 graceful(표본 0)', async () => {
    const { prisma } = buildPrismaMock({ universe: [], candlesByStock: {} });
    const svc = new IntradayScalpService(prisma);
    const status = await svc.getStatus();
    expect(status.styleTag).toBe(INTRADAY_SCALP_STYLE_TAG);
    expect(status.backtestable).toBe(false);
    expect(status.lowSample).toBe(true);
    expect(status.closedTrades).toBe(0);
    expect(status.equityCurve).toEqual([]);
  });

  it('getStatus equityCurve: DAR-412 일별 flat-fill — 거래 없는 구간 평평 + 청산일 계단', async () => {
    const { prisma, trades } = buildPrismaMock({ universe: [], candlesByStock: {} });
    const closedRow = (tradeDate: string, netPnl: number, returnPct: number): ScalpRow => ({
      id: `c-${tradeDate}`,
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate,
      entryTs: kstMonday('0930'),
      entryPrice: 100,
      shares: 10,
      entryReason: 'TEST',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'CLOSED',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
      netPnl,
      returnPct,
    });
    // 두 청산일이 멀리 떨어져 있음(6/01, 6/15) — 직선 보간 방지 검증
    trades.push(closedRow('20260601', 50_000, 2));
    trades.push(closedRow('20260615', -20_000, -1));

    const svc = new IntradayScalpService(prisma);
    const status = await svc.getStatus();

    // 앵커(직전 달력일) + 변동일 × 2 = 4점
    expect(status.equityCurve.map((p) => p.tradeDate)).toEqual([
      '20260531', // 첫 변동 직전 앵커 — 0% flat
      '20260601',
      '20260614', // 둘째 변동 직전 앵커 — 직전 누적(첫 청산 후) 유지
      '20260615',
    ]);
    expect(status.equityCurve[0]).toMatchObject({ realizedPnl: 0, cumulativeReturnPct: 0 });
    // 앵커[2]는 첫 청산 후 누적수익률을 그대로 유지(평평) → 직선 보간 아님
    expect(status.equityCurve[2].cumulativeReturnPct).toBeCloseTo(
      status.equityCurve[1].cumulativeReturnPct,
      6,
    );
    expect(status.equityCurve[2].realizedPnl).toBe(0);
  });
});

// DAR-414 — tradeDate SSOT 정렬: 환경 시계 today(월 6/22)와 분봉 라벨(KRX 실가용일 6/19)이
//   어긋날 때, 단타가 분봉 collector와 동일 해석기(resolveLatestAvailableTradeDate)를 써서
//   6/19 라벨 분봉/유니버스를 읽어 진입을 평가하는지 검증(버그: today 직접사용 시 빈 결과 → 0거래).
describe('IntradayScalpService — DAR-414 tradeDate 해석기 정렬', () => {
  /** 분봉 collector와 동일한 KRX 실가용 거래일을 반환하는 해석기 스텁. */
  function resolverStub(tradeDate: string) {
    return { resolveLatestAvailableTradeDate: jest.fn(async () => tradeDate) } as any;
  }

  it('진입: 해석기가 준 거래일(6/19)로 분봉/유니버스 조회·진입 — 환경시계 today 미사용', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma, undefined, resolverStub('20260619'));

    // 환경시계 today = 6/22(월). 해석기는 KRX 실가용일 6/19 반환.
    const r = await svc.runEntryCycle(kstMonday('1000'));

    expect(r.skipped).toBe(false);
    expect(r.tradeDate).toBe('20260619'); // ★환경시계(6/22) 아님
    expect(r.entered).toBe(1);
    expect(mock.trades[0].tradeDate).toBe('20260619'); // 영속 거래일도 분봉 라벨과 일치

    // 분봉 로드(loadTodayCandles)·당일 공시 필터 모두 6/19 로 조회됐는지 확인.
    const minuteCalls = mock.prisma.stockMinutePrice.findMany.mock.calls.map((c: any[]) => c[0]);
    const candleLoad = minuteCalls.find((a: any) => a?.where?.stockCode === '000001');
    expect(candleLoad.where.tradeDate).toBe('20260619');
    const discCall = mock.prisma.disclosure.findMany.mock.calls[0][0];
    expect(discCall.where.rcpDt.startsWith).toBe('20260619');
  });

  it('해석기 미주입(단위 테스트): 환경시계 today 폴백 — 기존 동작 보존', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.tradeDate).toBe('20260622'); // today 폴백
    expect(r.entered).toBe(1);
  });

  it('해석기 throw 시 환경시계 today 폴백(graceful)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const throwing = {
      resolveLatestAvailableTradeDate: jest.fn(async () => {
        throw new Error('KRX 일시 오류');
      }),
    } as any;
    const svc = new IntradayScalpService(mock.prisma, undefined, throwing);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.tradeDate).toBe('20260622');
    expect(r.entered).toBe(1);
  });
});
