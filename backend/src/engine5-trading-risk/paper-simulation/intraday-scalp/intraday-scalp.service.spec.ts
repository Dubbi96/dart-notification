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
});
