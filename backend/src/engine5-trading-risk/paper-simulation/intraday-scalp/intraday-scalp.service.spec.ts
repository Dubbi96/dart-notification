// DAR-411 — IntradayScalpService 1사이클 결정론 검증(분봉 fixture 기반).
//   유니버스 → 진입 평가 → 포지션 → 청산(익절/15:20 강제) 동작.
//   ★실주문 0 — 순수 모의 체결(simulateFill)만. 외부 주문 API 호출 없음.

import { IntradayScalpService } from './intraday-scalp.service';
import { INTRADAY_SCALP_STYLE_TAG } from './intraday-scalp-exit';
import { KillSwitchManager } from '../../domain/kill-switch';

/** KST 평일 정규장 시각 헬퍼(진짜 UTC instant). 2026-06-22 = 월요일. `now` 인자용. */
function kstMonday(hhmm: string): Date {
  const hh = hhmm.slice(0, 2);
  const mm = hhmm.slice(2, 4);
  return new Date(`2026-06-22T${hh}:${mm}:00+09:00`);
}

/**
 * DAR-435: 분봉 KST 벽시계를 UTC 컴포넌트에 담은 naive instant — 영속 entryTs/exitTs 의 timebase.
 *   minuteTimestamp('20260622', hhmm) 와 동일(분봉 수집기·진입 경로가 쓰는 규약).
 */
function kstNaive(hhmm: string): Date {
  const hh = Number(hhmm.slice(0, 2));
  const mm = Number(hhmm.slice(2, 4));
  return new Date(Date.UTC(2026, 5, 22, hh, mm));
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

/**
 * DAR-415 윈도우 스캔용 시계열: 평탄 base + 지정 인덱스에 트리거 + 평탄 tail.
 *   최신봉(마지막)은 평탄(미충족)이라, '최신 1봉만' 보면 진입 0(버그 재현).
 */
function windowCandles(triggerIdx: number, total = 40) {
  const rows: Array<{
    ts: Date;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    closePrice: number;
    volume: number;
  }> = [];
  for (let i = 0; i < total; i++) {
    const isTrig = i === triggerIdx;
    rows.push({
      ts: new Date(Date.UTC(2026, 5, 22, 0, i)),
      openPrice: isTrig ? 105 : 100,
      highPrice: isTrig ? 106 : 100,
      lowPrice: isTrig ? 99 : 100,
      closePrice: isTrig ? 105 : 100,
      volume: isTrig ? 300 : 100,
    });
  }
  return rows;
}

/** 상태 보존 Prisma 목 — intradayScalpTrade 는 in-memory 배열로 진입/청산 라운드트립을 재현. */
function buildPrismaMock(opts: {
  universe: Array<{ stockCode: string; corpCode: string }>;
  candlesByStock: Record<string, ReturnType<typeof triggerCandles>>;
  signals?: Array<{ corpCode: string; stockCode: string }>;
  disclosures?: Array<{ corpCode: string }>;
  /** L[1]: 같은 거래일 일봉 종가 폴백 스텁(없으면 null → 진입가 최후폴백) */
  dailyClose?: number | null;
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
          // F11: tradeDate 가 {gte,lte} 범위 객체일 수 있음(weeklyRealizedPnl). 문자열 동등 + 범위 모두 처리.
          if (w.tradeDate && typeof w.tradeDate === 'object') {
            const { gte, lte } = w.tradeDate;
            out = out.filter(
              (t) =>
                (gte === undefined || t.tradeDate >= gte) &&
                (lte === undefined || t.tradeDate <= lte),
            );
          } else if (w.tradeDate) {
            out = out.filter((t) => t.tradeDate === w.tradeDate);
          }
          if (w.styleTag) out = out.filter((t) => t.styleTag === w.styleTag);
          return out.map((t) => ({ ...t }));
        }),
        count: jest.fn(async (args: any) => {
          let out = trades;
          const w = args?.where ?? {};
          if (w.status) out = out.filter((t) => t.status === w.status);
          if (w.tradeDate) out = out.filter((t) => t.tradeDate === w.tradeDate);
          if (w.styleTag) out = out.filter((t) => t.styleTag === w.styleTag);
          return out.length;
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
      stockDailyPrice: {
        findFirst: jest.fn(async () =>
          opts.dailyClose != null ? { closePrice: opts.dailyClose } : null,
        ),
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

  it('DAR-426 현금 가드: 가용현금이 음수면(기보유 진입원가>자본) 충족 종목도 진입 0', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) }, // 3조건 충족
    });
    // 기보유 OPEN(다른 종목)이 자본(1천만)을 초과하는 진입원가를 점유 → 가용현금<0.
    mock.trades.push({
      id: 'seed',
      corpCode: 'CX',
      stockCode: '999999',
      tradeDate: '20260101',
      entryTs: kstNaive('0930'),
      entryPrice: 60_000,
      shares: 200, // 진입원가 12,000,000 > 자본 10,000,000
      entryReason: 'SEED',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'OPEN',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
    } as ScalpRow);

    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    // 충족 종목이 있어도 현금 소진 → 신규 진입 0(현금 음수 절대 금지).
    expect(r.entered).toBe(0);
    expect(mock.trades.filter((t) => t.status === 'OPEN' && t.corpCode === 'C1')).toHaveLength(0);
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

  // ── L[1](2026-06-26): 강제청산 가격결측 시 진입가 0% 손익 날조 금지(데이터정합) ──
  function seedOpenScalp(
    mock: ReturnType<typeof buildPrismaMock>,
    over: Partial<ScalpRow> = {},
  ) {
    mock.trades.push({
      id: 'op1',
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate: '20260622',
      entryTs: kstNaive('0951'),
      entryPrice: 100,
      shares: 10,
      entryReason: 'VOLUME_BREAKOUT_VWAP',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'OPEN',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
      ...over,
    } as ScalpRow);
  }

  it('L[1] forceCloseAll: 분봉·실시간 결측 시 같은 거래일 일봉종가로 청산(진입가 0% 날조 금지)', async () => {
    const mock = buildPrismaMock({ universe: [], candlesByStock: {}, dailyClose: 90 });
    seedOpenScalp(mock);
    const svc = new IntradayScalpService(mock.prisma);
    const forced = await svc.forceCloseAll(kstMonday('1520'));
    expect(forced.exited).toBe(1);
    const t = mock.trades[0];
    expect(t.status).toBe('CLOSED');
    expect(t.exitReason).toBe('FORCE_CLOSE_EOD');
    // 일봉 90 vs 진입 100 → 실손실 반영(returnPct ≠ 0)
    expect(t.returnPct).toBeLessThan(-5);
    // 일봉은 반드시 '같은 거래일' 한정 조회(orderBy desc cross-day 가짜손익 방지)
    expect(mock.prisma.stockDailyPrice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockCode: '000001', tradeDate: '20260622' },
      }),
    );
  });

  it('L[1] forceCloseAll: 모든 가격원 결측 시 진입가 폴백 + 데이터정합 error 로그(priceMissing)', async () => {
    const mock = buildPrismaMock({ universe: [], candlesByStock: {}, dailyClose: null });
    seedOpenScalp(mock);
    const svc = new IntradayScalpService(mock.prisma);
    const errSpy = jest.spyOn((svc as any).logger, 'error');
    const forced = await svc.forceCloseAll(kstMonday('1520'));
    expect(forced.exited).toBe(1);
    expect(mock.trades[0].status).toBe('CLOSED');
    expect(mock.trades[0].exitReason).toBe('FORCE_CLOSE_EOD');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('가격결측'));
  });

  it('L[1] runExitCycle: 가격결측이면 청산평가 스킵(0% 날조 대신 OPEN 유지)', async () => {
    const mock = buildPrismaMock({ universe: [], candlesByStock: {} });
    seedOpenScalp(mock);
    const svc = new IntradayScalpService(mock.prisma);
    const exit = await svc.runExitCycle(kstMonday('1030'));
    expect(exit.exited).toBe(0);
    expect(mock.trades[0].status).toBe('OPEN');
  });

  it('DAR-435 청산 timebase 통일: exitTs 가 entryTs 와 동일 naive-KST·exitTs>entryTs·holdMinutes 정확', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(120, 121, 100) }, // 현재가 120 → 익절 트리거
    });
    // 진입 KST 09:51(분봉 naive)인 OPEN 포지션 선주입.
    const entryTs = kstNaive('0951');
    mock.trades.push({
      id: 'open-time',
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate: '20260622',
      entryTs,
      entryPrice: 100,
      shares: 10,
      entryReason: 'VOLUME_BREAKOUT_VWAP',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'OPEN',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
    });
    const svc = new IntradayScalpService(mock.prisma);

    // 청산 발화 = KST 10:22(= UTC 01:22Z). new Date() 라면 naive 01:22 로 영속돼 역전됐을 시각.
    const exit = await svc.runExitCycle(kstMonday('1022'));
    expect(exit.exited).toBe(1);
    const t = mock.trades[0];
    expect(t.status).toBe('CLOSED');
    // exitTs 가 entryTs 와 동일 timebase(naive-KST 10:22)로 영속 — UTC 컴포넌트가 곧 KST 벽시계.
    expect(t.exitTs).toEqual(kstNaive('1022'));
    expect((t.exitTs as Date).getTime()).toBeGreaterThan(entryTs.getTime());
    // holdMinutes = 10:22 − 09:51 = 31분(0 으로 clamp 되지 않음).
    expect(t.holdMinutes).toBe(31);
  });

  it('DAR-444 가드레일: 장외 시각 청산 발화여도 exitTs 는 정규장(≤15:30)으로 clamp — 00·01시 등 장외 시각 영속 봉인', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(120, 121, 100) },
    });
    const entryTs = kstNaive('0951');
    mock.trades.push({
      id: 'open-guard',
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate: '20260622',
      entryTs,
      entryPrice: 100,
      shares: 10,
      entryReason: 'VOLUME_BREAKOUT_VWAP',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'OPEN',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
    });
    const svc = new IntradayScalpService(mock.prisma);

    // 청산 발화 = 환경시계 장외(KST 23:00). 가드레일이 없으면 23:00 또는 UTC 폴백(00~06시)이 영속될 위험.
    await svc.forceCloseAll(kstMonday('2300'));
    const t = mock.trades[0];
    expect(t.status).toBe('CLOSED');
    // exitTs 는 정규장 마감(15:30)으로 clamp — 장외 시각 절대 영속 안 됨.
    expect(t.exitTs).toEqual(kstNaive('1530'));
    // 불변식: exitTs ≥ entryTs, 그리고 정규장 시간(09:00~15:30 KST) 내.
    expect((t.exitTs as Date).getTime()).toBeGreaterThanOrEqual(entryTs.getTime());
    expect((t.holdMinutes as number)).toBeGreaterThanOrEqual(0);
  });

  it('DAR-435 회귀: 진입 경로는 항상 분봉 충족봉 ts(scan.candle.ts)를 entryTs 로 영속(new Date 금지)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    // 사이클 발화 now=10:00 이지만 entryTs 는 now 가 아니라 충족봉(triggerCandles 마지막 = naive 00:25)이어야 한다.
    await svc.runEntryCycle(kstMonday('1000'));
    const t = mock.trades[0];
    // 분봉 ts = whole-minute(.000 fraction)·UTC 컴포넌트 = KST 벽시계. new Date() instant 가 아니다.
    expect(t.entryTs).toEqual(new Date(Date.UTC(2026, 5, 22, 0, 25)));
    expect(t.entryTs.getUTCSeconds()).toBe(0);
    expect(t.entryTs.getMilliseconds()).toBe(0);
    // now(10:00 KST = 01:00Z instant)와 달라야 함 — entryTs 가 now 로 오염되지 않음을 봉인.
    expect(t.entryTs.getTime()).not.toBe(kstMonday('1000').getTime());
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
    // DAR-418 fee 투명화 필드(SSOT 비용율·순 목표·총수수료).
    expect(status.roundTripCostPct).toBeCloseTo(0.31, 6);
    expect(status.takeProfitNetPct).toBe(2.0);
    expect(status.stopLossNetPct).toBe(-1.2);
    expect(status.totalFees).toBe(0);
  });

  it('getStatus equityCurve: DAR-412 일별 flat-fill — 거래 없는 구간 평평 + 청산일 계단', async () => {
    const { prisma, trades } = buildPrismaMock({ universe: [], candlesByStock: {} });
    const closedRow = (tradeDate: string, netPnl: number, returnPct: number): ScalpRow => ({
      id: `c-${tradeDate}`,
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate,
      entryTs: kstNaive('0930'),
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

// DAR-414/423 — tradeDate SSOT 정렬: 단타가 분봉 collector와 동일 해석기
//   (resolveIntradayTradeDate, DAR-423 인트라데이 전용)를 써서 그 거래일 라벨 분봉/유니버스를
//   읽어 진입을 평가하는지 검증(버그: today/일봉 라벨 직접사용 시 라벨 불일치 → 빈 결과 → 0거래).
describe('IntradayScalpService — DAR-414/423 tradeDate 해석기 정렬', () => {
  /** 분봉 collector와 동일한 인트라데이 거래일을 반환하는 해석기 스텁(DAR-423). */
  function resolverStub(tradeDate: string) {
    return { resolveIntradayTradeDate: jest.fn(async () => tradeDate) } as any;
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
      resolveIntradayTradeDate: jest.fn(async () => {
        throw new Error('KRX 일시 오류');
      }),
    } as any;
    const svc = new IntradayScalpService(mock.prisma, undefined, throwing);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.tradeDate).toBe('20260622');
    expect(r.entered).toBe(1);
  });
});

// DAR-415 — 윈도우 스캔: 사이클 사이에 발생한 충족봉(최신봉 아님)을 포착해 진입.
//   기존 버그: evaluateScalpEntry 가 최신 1봉만 봐서, 충족 순간이 :X2분 스냅샷과 어긋나면 누락(진입 0).
describe('IntradayScalpService — DAR-415 윈도우 스캔 진입', () => {
  it('최신봉은 미충족이어도 윈도우 중간 충족봉을 포착해 진입(진입 ts=충족봉 시각)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': windowCandles(25) }, // 충족=25, 최신봉(39)=평탄
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));

    expect(r.entered).toBe(1);
    expect(mock.trades).toHaveLength(1);
    const t = mock.trades[0];
    expect(t.status).toBe('OPEN');
    expect(t.entryReason).toBe('VOLUME_BREAKOUT_VWAP');
    // ★진입 ts = 충족봉(인덱스 25) 시각 — 사이클 발화 시각(now=10:00)이 아님.
    expect(t.entryTs).toEqual(new Date(Date.UTC(2026, 5, 22, 0, 25)));
    // 진입가 = 충족봉 종가 105 × (1+슬리피지)
    expect(t.entryPrice).toBeGreaterThan(105);
  });

  it('중복 진입 방지: 같은 데이터로 두 사이클 실행해도 종목당 1진입(라운드트립)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': windowCandles(25) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r1 = await svc.runEntryCycle(kstMonday('1000'));
    const r2 = await svc.runEntryCycle(kstMonday('1010'));
    expect(r1.entered).toBe(1);
    expect(r2.entered).toBe(0); // 이미 보유 → 재진입 0
    expect(mock.trades).toHaveLength(1);
  });

  it('종목당 1라운드트립: 당일 이미 청산(CLOSED)된 종목은 재진입 안 함', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': windowCandles(25) },
    });
    // 같은 종목이 오늘 이미 한 번 라운드트립(CLOSED)한 상태를 선주입.
    mock.trades.push({
      id: 'closed-1',
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate: '20260622',
      entryTs: kstNaive('0935'),
      entryPrice: 100,
      shares: 10,
      entryReason: 'VOLUME_BREAKOUT_VWAP',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'CLOSED',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
      netPnl: 5000,
      returnPct: 1,
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(0); // CLOSED 이력 있어 재진입 금지
    expect(mock.trades.filter((t) => t.status === 'OPEN')).toHaveLength(0);
  });

  it('과진입 방지: 다수 종목이 충족해도 동시보유 상한(5)까지만 진입', async () => {
    const codes = ['000001', '000002', '000003', '000004', '000005', '000006', '000007'];
    const universe = codes.map((c, i) => ({ stockCode: c, corpCode: `C${i}` }));
    const candlesByStock: Record<string, ReturnType<typeof windowCandles>> = {};
    for (const c of codes) candlesByStock[c] = windowCandles(25);
    const mock = buildPrismaMock({
      universe,
      signals: universe.map((u) => ({ corpCode: u.corpCode, stockCode: u.stockCode })),
      candlesByStock,
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(5); // MAX_OPEN_POSITIONS
    expect(mock.trades).toHaveLength(5);
  });
});

// DAR-416 — 거래 타임라인(getTradeHistory): 모바일 '전략' 탭 단타 드릴다운 표면화.
//   최신 진입순·종목별 1행·종목명 결합(Company.corpName)·OPEN 청산필드 null.
describe('IntradayScalpService — DAR-416 거래 타임라인(getTradeHistory)', () => {
  /** company.findMany 를 포함한 타임라인 전용 프리즈마 목(상태 보존 배열). */
  function buildHistoryMock(rows: Partial<ScalpRow>[], companies: Array<{ corpCode: string; corpName: string }>) {
    return {
      intradayScalpTrade: {
        findMany: jest.fn(async (args: any) => {
          let out = rows as ScalpRow[];
          const w = args?.where ?? {};
          if (w.styleTag) out = out.filter((t) => t.styleTag === w.styleTag);
          // orderBy entryTs desc 재현(서비스 계약 — 최신 진입순).
          const sorted = [...out].sort((a, b) => b.entryTs.getTime() - a.entryTs.getTime());
          return sorted.map((t) => ({ ...t }));
        }),
      },
      company: {
        findMany: jest.fn(async (args: any) => {
          const wanted: string[] = args?.where?.corpCode?.in ?? [];
          return companies.filter((c) => wanted.includes(c.corpCode));
        }),
      },
    } as any;
  }

  const baseRow = (over: Partial<ScalpRow>): ScalpRow => ({
    id: 'x',
    corpCode: 'C1',
    stockCode: '000001',
    tradeDate: '20260622',
    entryTs: kstNaive('1000'),
    entryPrice: 100,
    shares: 10,
    entryReason: 'VOLUME_BREAKOUT_VWAP',
    commission: 0,
    tax: 0,
    slippage: 0,
    status: 'CLOSED',
    styleTag: INTRADAY_SCALP_STYLE_TAG,
    ...over,
  });

  it('CLOSED/OPEN 혼합: 최신 진입순·종목명 결합·OPEN 청산필드 null', async () => {
    const rows = [
      baseRow({
        id: 'closed-1',
        corpCode: 'C1',
        stockCode: '000001',
        entryTs: kstNaive('0935'),
        entryPrice: 100,
        status: 'CLOSED',
        exitTs: kstNaive('0950'),
        exitPrice: 102,
        exitReason: 'TAKE_PROFIT',
        returnPct: 1.5,
        netPnl: 18000,
      }),
      baseRow({
        id: 'open-1',
        corpCode: 'C2',
        stockCode: '000002',
        entryTs: kstNaive('1010'),
        entryPrice: 200,
        status: 'OPEN',
        exitTs: null,
        exitPrice: null,
        exitReason: null,
        returnPct: null,
        netPnl: null,
      }),
    ];
    const prisma = buildHistoryMock(rows, [
      { corpCode: 'C1', corpName: '가나기업' },
      { corpCode: 'C2', corpName: '다라기업' },
    ]);
    const svc = new IntradayScalpService(prisma);
    const hist = await svc.getTradeHistory();

    expect(hist.styleTag).toBe(INTRADAY_SCALP_STYLE_TAG);
    expect(hist.trades).toHaveLength(2);
    // 최신 진입순 — open-1(10:10) 먼저.
    expect(hist.trades[0].id).toBe('open-1');
    expect(hist.trades[0].corpName).toBe('다라기업');
    expect(hist.trades[0].status).toBe('OPEN');
    expect(hist.trades[0].exitTs).toBeNull();
    expect(hist.trades[0].exitReason).toBeNull();
    expect(hist.trades[0].returnPct).toBeNull();
    // CLOSED — 청산 필드·종목명 결합.
    expect(hist.trades[1].id).toBe('closed-1');
    expect(hist.trades[1].corpName).toBe('가나기업');
    expect(hist.trades[1].status).toBe('CLOSED');
    expect(hist.trades[1].exitReason).toBe('TAKE_PROFIT');
    expect(hist.trades[1].returnPct).toBeCloseTo(1.5, 6);
    expect(hist.trades[1].entryReason).toBe('VOLUME_BREAKOUT_VWAP');
    // ★DAR-435 ISO 직렬화 = `+09:00` 오프셋 명시(naive-KST 벽시계를 클라이언트가 정확히 복원).
    expect(typeof hist.trades[1].entryTs).toBe('string');
    expect(hist.trades[1].entryTs).toBe('2026-06-22T09:35:00+09:00');
    expect(hist.trades[1].exitTs).toBe('2026-06-22T09:50:00+09:00');
  });

  it('DAR-418 fee 투명화: gross/net 수익률·총수수료(수수료+세금) 노출', async () => {
    const rows = [
      baseRow({
        id: 'closed-fee',
        corpCode: 'C1',
        stockCode: '000001',
        entryPrice: 100,
        shares: 10, // 진입원가 1000
        status: 'CLOSED',
        exitPrice: 102,
        exitReason: 'TAKE_PROFIT',
        grossPnl: 25, // gross 2.5%
        netPnl: 20, // net 2.0%
        returnPct: 2.0,
        commission: 3,
        tax: 2,
      }),
    ];
    const prisma = buildHistoryMock(rows, [{ corpCode: 'C1', corpName: '가나기업' }]);
    const svc = new IntradayScalpService(prisma);
    const hist = await svc.getTradeHistory();
    const t = hist.trades[0];
    expect(t.grossReturnPct).toBeCloseTo(2.5, 6); // 25 / 1000 * 100
    expect(t.netReturnPct).toBeCloseTo(2.0, 6);
    expect(t.returnPct).toBeCloseTo(2.0, 6); // 기존 FE 호환(net 별칭)
    expect(t.totalFees).toBe(5); // 수수료 3 + 세금 2
    // 왕복 거래비용율은 응답 최상위에 노출(비용 인지 고지).
    expect(hist.roundTripCostPct).toBeCloseTo(0.31, 6);
  });

  it('OPEN 포지션: gross/net/총수수료 모두 null(미청산)', async () => {
    const rows = [baseRow({ id: 'open-fee', status: 'OPEN', exitPrice: null, exitReason: null, returnPct: null, netPnl: null })];
    const prisma = buildHistoryMock(rows, [{ corpCode: 'C1', corpName: '가나기업' }]);
    const svc = new IntradayScalpService(prisma);
    const hist = await svc.getTradeHistory();
    const t = hist.trades[0];
    expect(t.grossReturnPct).toBeNull();
    expect(t.netReturnPct).toBeNull();
    expect(t.totalFees).toBeNull();
  });

  it('종목명 미존재: stockCode 폴백', async () => {
    const rows = [baseRow({ id: 't1', corpCode: 'CX', stockCode: '009999' })];
    const prisma = buildHistoryMock(rows, []); // 매핑 없음
    const svc = new IntradayScalpService(prisma);
    const hist = await svc.getTradeHistory();
    expect(hist.trades[0].corpName).toBe('009999');
  });

  it('표본 0: 빈 타임라인 graceful(company 조회 스킵)', async () => {
    const prisma = buildHistoryMock([], []);
    const svc = new IntradayScalpService(prisma);
    const hist = await svc.getTradeHistory();
    expect(hist.trades).toEqual([]);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });
});

// ── DAR-424: 체결 알림 발행(진입/청산) ────────────────────────────────────────
describe('IntradayScalpService — DAR-424 체결 알림 발행', () => {
  it('진입 체결 시 enqueueTradeEntry 호출(현금·평가금 스냅샷 포함)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    // 종목명 조회 스텁(emitTradeEntry 가 사용).
    mock.prisma.company = { findUnique: jest.fn(async () => ({ corpName: '가나기업' })) };
    const producer = {
      enqueueTradeEntry: jest.fn().mockResolvedValue(undefined),
      enqueueTradeExit: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new IntradayScalpService(
      mock.prisma,
      undefined,
      undefined,
      producer as any,
    );

    await svc.runEntryCycle(kstMonday('1000'));

    expect(producer.enqueueTradeEntry).toHaveBeenCalledTimes(1);
    const payload = producer.enqueueTradeEntry.mock.calls[0][0];
    expect(payload).toMatchObject({
      kind: 'ENTRY',
      strategyKey: INTRADAY_SCALP_STYLE_TAG,
      strategyLabel: '분봉 단타',
      stockCode: '000001',
      corpName: '가나기업',
      deepLink: '/portfolio/strategy/intraday-scalp',
    });
    expect(payload.shares).toBe(mock.trades[0].shares);
    // 현금 = 초기자본 − 진입원가(<초기자본), 평가금 = 현금 + 보유평가합(>0).
    expect(payload.cash).toBeLessThan(10_000_000);
    expect(payload.totalValue).toBeGreaterThan(0);
    expect(producer.enqueueTradeExit).not.toHaveBeenCalled();
  });

  it('청산(강제) 체결 시 enqueueTradeExit 호출(손익%·사유 포함)', async () => {
    const mock = buildPrismaMock({
      universe: [],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    // 보유 포지션 1건 선적재(진입가 100·10주).
    mock.trades.push({
      id: 't-open',
      corpCode: 'C1',
      stockCode: '000001',
      tradeDate: '20260622',
      entryTs: new Date('2026-06-22T01:00:00Z'),
      entryPrice: 100,
      shares: 10,
      entryReason: 'VOLUME_BREAKOUT_VWAP',
      commission: 0,
      tax: 0,
      slippage: 0,
      status: 'OPEN',
      styleTag: INTRADAY_SCALP_STYLE_TAG,
    });
    mock.prisma.company = { findUnique: jest.fn(async () => ({ corpName: '가나기업' })) };
    const producer = {
      enqueueTradeEntry: jest.fn().mockResolvedValue(undefined),
      enqueueTradeExit: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new IntradayScalpService(mock.prisma, undefined, undefined, producer as any);

    // 15:20 강제청산(손익 무관 전량 청산).
    await svc.forceCloseAll(kstMonday('1520'));

    expect(producer.enqueueTradeExit).toHaveBeenCalledTimes(1);
    const payload = producer.enqueueTradeExit.mock.calls[0][0];
    expect(payload).toMatchObject({
      kind: 'EXIT',
      strategyKey: INTRADAY_SCALP_STYLE_TAG,
      exitReason: 'FORCE_CLOSE_EOD',
      stockCode: '000001',
    });
    expect(typeof payload.pnlPct).toBe('number');
    expect(typeof payload.cash).toBe('number');
  });

  it('producer 미주입(@Optional)이어도 체결은 graceful 진행', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(1); // 알림 미발행이어도 진입 정상
  });
});

// ── F5(2026-06-27): 단타 진입 kill-switch veto ──
describe('IntradayScalpService — F5 kill-switch', () => {
  function entryMock() {
    return buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
  }

  it('kill-switch 발동 시 신규 진입 차단(entered 0)', async () => {
    const mock = entryMock();
    const ks = new KillSwitchManager();
    await ks.activate('수동 점검', 'USER');
    const svc = new IntradayScalpService(
      mock.prisma,
      undefined,
      undefined,
      undefined,
      ks,
    );
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(0);
    expect(r.reason).toContain('킬스위치');
    expect(mock.trades).toHaveLength(0);
  });

  it('kill-switch 비활성이면 정상 진입(대조)', async () => {
    const mock = entryMock();
    const ks = new KillSwitchManager(); // 미발동
    const svc = new IntradayScalpService(
      mock.prisma,
      undefined,
      undefined,
      undefined,
      ks,
    );
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(1);
  });

  it('kill-switch 미주입(@Optional)이면 기존 동작 보존(진입)', async () => {
    const mock = entryMock();
    const svc = new IntradayScalpService(mock.prisma);
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(1);
  });
});

// ── F11(2026-06-27): 주간 손실 한도(WEEKLY_LOSS_LIMIT) 입력 정정 ──
describe('IntradayScalpService — F11 주간 손실 한도', () => {
  function resolverStub(tradeDate: string) {
    return { resolveIntradayTradeDate: () => tradeDate } as never;
  }
  // 이번주 CLOSED 손실 시드(일별 -1.8% < 일간한도 -2%, 주간 합 -5.4% > 주간한도 -5%).
  function seedWeeklyLosses(mock: ReturnType<typeof buildPrismaMock>) {
    for (const d of ['20260622', '20260623', '20260624']) {
      mock.trades.push({
        id: `loss-${d}`,
        corpCode: 'CX',
        stockCode: '009999',
        tradeDate: d,
        entryTs: kstNaive('0951'),
        entryPrice: 0,
        shares: 0,
        entryReason: 'VOLUME_BREAKOUT_VWAP',
        netPnl: -180000,
        commission: 0,
        tax: 0,
        slippage: 0,
        status: 'CLOSED',
        styleTag: INTRADAY_SCALP_STYLE_TAG,
      } as never);
    }
  }

  it('주중 누적 손실 -5% 초과 → WEEKLY_LOSS_LIMIT veto로 신규 진입 거부', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    seedWeeklyLosses(mock); // 이번주 -540,000 (-5.4% of 10M)
    // tradeDate=목(20260625): 당일 거래 0(일간 통과) but 주간 누적 -5.4% → 거부.
    const svc = new IntradayScalpService(
      mock.prisma,
      undefined,
      resolverStub('20260625'),
    );
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(0);
    // 신규 진입 종목(000001) OPEN 미생성
    expect(mock.trades.some((t) => t.stockCode === '000001')).toBe(false);
  });

  it('주간 손실 한도 미만이면 정상 진입(대조)', async () => {
    const mock = buildPrismaMock({
      universe: [{ stockCode: '000001', corpCode: 'C1' }],
      signals: [{ corpCode: 'C1', stockCode: '000001' }],
      candlesByStock: { '000001': triggerCandles(105, 106, 300) },
    });
    const svc = new IntradayScalpService(
      mock.prisma,
      undefined,
      resolverStub('20260625'),
    );
    const r = await svc.runEntryCycle(kstMonday('1000'));
    expect(r.entered).toBe(1);
  });
});
