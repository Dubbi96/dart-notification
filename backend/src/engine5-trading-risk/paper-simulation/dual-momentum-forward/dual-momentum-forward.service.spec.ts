// DualMomentumForwardService 단위 테스트 (DAR-494 [견고화 W1·P13])
// 결정론 검증: 월말 판정→예약→익일 시가 체결(매도→매수)·fail-safe·킬스위치·현금/평가 산식.
// Prisma 는 인메모리 목으로 대체(read/write 결정론). 실 DB·AI 미사용.

import {
  isLastTradingDayOfMonth,
  nextTradingDay,
  lastTradingDayOfMonth,
} from '../../../common/time/market-calendar';
import {
  DualMomentumForwardService,
  DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL,
  DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD,
  CORE_TRACK_TYPE_LABEL,
  nextMonthEndDecisionDate,
} from './dual-momentum-forward.service';
import {
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
} from '../../../engine3-quant-market/dual-momentum/dual-momentum.constants';

// ── 날짜 헬퍼(캘린더 무관 연속일 — 모멘텀은 배열 인덱스만 사용) ──
function fmt(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function seqDatesEndingAt(count: number, endYmd: string): string[] {
  const end = new Date(
    Number(endYmd.slice(0, 4)),
    Number(endYmd.slice(4, 6)) - 1,
    Number(endYmd.slice(6, 8)),
  );
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    out.push(fmt(d));
  }
  return out;
}

interface Bar {
  etfCode: string;
  tradeDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
}

/** 유니버스 일봉 fixture 생성 — 오프A 강한 상승·오프B 약한 상승·채권 평탄(오프A 승자). */
function buildUniverseBars(decisionDate: string): Bar[] {
  const dates = seqDatesEndingAt(260, decisionDate); // 260봉(≥253 최소) ≤ 판정일
  const fillDate = nextTradingDay(decisionDate);
  const bars: Bar[] = [];
  const push = (code: string, date: string, close: number, open = close) =>
    bars.push({
      etfCode: code,
      tradeDate: date,
      openPrice: open,
      highPrice: close,
      lowPrice: open,
      closePrice: close,
    });

  dates.forEach((date, i) => {
    push(CORE_OFFENSE_INTL_CODE, date, 10_000 + i * 20); // A: 강한 상승 → 큰 모멘텀
    push(CORE_OFFENSE_DOMESTIC_CODE, date, 10_000 + i * 4); // B: 약한 상승
    push(CORE_ABS_MOMENTUM_FILTER_CODE, date, 10_000); // T: 평탄 → 모멘텀 0
    push(CORE_DEFENSE_BOND_CODE, date, 10_000); // 방어: 평탄
  });
  // 체결일(익일) 시가 바 — 전 유니버스.
  push(CORE_OFFENSE_INTL_CODE, fillDate, 15_200, 15_000);
  push(CORE_OFFENSE_DOMESTIC_CODE, fillDate, 11_050, 11_000);
  push(CORE_ABS_MOMENTUM_FILTER_CODE, fillDate, 10_000, 10_000);
  push(CORE_DEFENSE_BOND_CODE, fillDate, 10_000, 10_000);
  return bars;
}

// ── 인메모리 Prisma 목 ──
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v && typeof v === 'object' && 'in' in (v as any)) {
      if (!(v as any).in.includes(row[k])) return false;
    } else if (v && typeof v === 'object' && ('lte' in (v as any) || 'gte' in (v as any))) {
      const cond = v as any;
      if (cond.lte !== undefined && !(row[k] <= cond.lte)) return false;
      if (cond.gte !== undefined && !(row[k] >= cond.gte)) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}
function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const key = Object.keys(orderBy)[0];
  const dir = orderBy[key] === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir);
}

function makePrisma(bars: Bar[], seedTrades: any[] = []) {
  const trades: any[] = seedTrades.map((t, i) => ({ id: t.id ?? `seed${i}`, createdAt: i, ...t }));
  let seq = trades.length;
  const snapshots: any[] = [];

  const tradeDelegate = {
    findFirst: jest.fn(({ where, orderBy }: any) => {
      const found = sortRows(
        trades.filter((r) => matchWhere(r, where)),
        orderBy,
      );
      return Promise.resolve(found[0] ?? null);
    }),
    findMany: jest.fn(({ where, orderBy }: any) =>
      Promise.resolve(
        sortRows(
          trades.filter((r) => matchWhere(r, where)),
          orderBy,
        ),
      ),
    ),
    create: jest.fn(({ data }: any) => {
      const row = {
        id: `t${seq}`,
        createdAt: seq,
        status: 'PENDING',
        commission: 0,
        tax: 0,
        slippage: 0,
        shares: 0,
        ...data,
      };
      seq++;
      trades.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(({ where, data }: any) => {
      const row = trades.find((r) => r.id === where.id);
      Object.assign(row, data);
      return Promise.resolve(row);
    }),
    updateMany: jest.fn(({ where, data }: any) => {
      let n = 0;
      for (const r of trades)
        if (matchWhere(r, where)) {
          Object.assign(r, data);
          n++;
        }
      return Promise.resolve({ count: n });
    }),
  };

  const prisma: any = {
    __trades: trades,
    __snapshots: snapshots,
    user: {
      findFirst: jest.fn(() => Promise.resolve({ id: 'u1' })),
      create: jest.fn(() => Promise.resolve({ id: 'u1' })),
    },
    portfolio: {
      findFirst: jest.fn(() => Promise.resolve({ id: 'pf1' })),
      create: jest.fn(() => Promise.resolve({ id: 'pf1' })),
    },
    dualMomentumForwardTrade: tradeDelegate,
    etfDailyPrice: {
      findFirst: jest.fn(({ where, orderBy }: any) => {
        const found = sortRows(
          bars.filter((r) => matchWhere(r, where)),
          orderBy,
        );
        return Promise.resolve(found[0] ?? null);
      }),
      findMany: jest.fn(({ where, orderBy }: any) =>
        Promise.resolve(
          sortRows(
            bars.filter((r) => matchWhere(r, where)),
            orderBy,
          ),
        ),
      ),
    },
    portfolioRiskSnapshot: {
      upsert: jest.fn(({ where, create, update }: any) => {
        const existing = snapshots.find(
          (s) =>
            s.portfolioId === where.portfolioId_snapshotDate.portfolioId &&
            s.snapshotDate === where.portfolioId_snapshotDate.snapshotDate,
        );
        if (existing) {
          Object.assign(existing, update);
          return Promise.resolve(existing);
        }
        snapshots.push(create);
        return Promise.resolve(create);
      }),
      findMany: jest.fn(({ where, orderBy }: any) =>
        Promise.resolve(
          sortRows(
            snapshots.filter((r) => matchWhere(r, where)),
            orderBy,
          ),
        ),
      ),
    },
  };
  return prisma;
}

describe('DualMomentumForwardService (DAR-494)', () => {
  const DECISION = '20260130'; // 금 — 2026-01 마지막 거래일
  const FILL = nextTradingDay(DECISION); // 20260202(월)

  it('전제: 판정일은 실제 월말 거래일이다', () => {
    expect(isLastTradingDayOfMonth(DECISION)).toBe(true);
    expect(FILL).toBe('20260202');
  });

  it('월말 판정 → 승자 ETF 익일 시가 매수 예약(PENDING) 생성', async () => {
    const prisma = makePrisma(buildUniverseBars(DECISION));
    const svc = new DualMomentumForwardService(prisma);
    const res = await svc.runDailyCycle(DECISION);

    expect(res.rebalance).toBe('SWITCH');
    const pending = prisma.__trades.filter((t: any) => t.status === 'PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0].etfCode).toBe(CORE_OFFENSE_INTL_CODE); // 오프A 승자
    expect(pending[0].entryTradeDate).toBe(FILL);
    expect(res.holding).toBeNull(); // 아직 미체결
    // 평가액 = 초기자본(현금 보유·미실현 0).
    expect(res.equity).toBeCloseTo(DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL, 0);
  });

  it('익일 사이클: 예약 → 당일 시가 전량 매수 체결(현금 배분·평가 반영)', async () => {
    const bars = buildUniverseBars(DECISION);
    const prisma = makePrisma(bars);
    const svc = new DualMomentumForwardService(prisma);
    await svc.runDailyCycle(DECISION); // 예약
    const res = await svc.runDailyCycle(FILL); // 체결

    expect(res.filled).toBe(1);
    expect(res.holding).toBe(CORE_OFFENSE_INTL_CODE);
    const open = prisma.__trades.find((t: any) => t.status === 'OPEN');
    expect(open.shares).toBeGreaterThan(0);
    // 진입원가(shares×체결가 + 수수료) ≤ 초기자본 (현금≥0 불변식).
    const cost = open.shares * Number(open.entryPrice) + Number(open.commission);
    expect(cost).toBeLessThanOrEqual(DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL);
    // 체결가 = 시가 15000 × (1+슬리피지) 호가정렬(BUY 올림).
    expect(Number(open.entryPrice)).toBeGreaterThanOrEqual(15_000);
    // 평가 = 초기 + 미실현((종가15200−체결가)×주 − 매수수수료).
    expect(res.equity).toBeGreaterThan(0);
  });

  it('SWITCH: 보유 오프A → 방어 전환 시 매도(현금 확보) 후 매수', async () => {
    // 방어 승자가 되도록: 오프 모두 하락(음수 모멘텀 < 단기채 0) → target=방어채권.
    const dates = seqDatesEndingAt(260, DECISION);
    const fillDate = FILL;
    const bars: Bar[] = [];
    const push = (code: string, date: string, close: number, open = close) =>
      bars.push({
        etfCode: code,
        tradeDate: date,
        openPrice: open,
        highPrice: close,
        lowPrice: open,
        closePrice: close,
      });
    dates.forEach((date, i) => {
      push(CORE_OFFENSE_INTL_CODE, date, 20_000 - i * 20); // 하락 → 음수 모멘텀
      push(CORE_OFFENSE_DOMESTIC_CODE, date, 20_000 - i * 20);
      push(CORE_ABS_MOMENTUM_FILTER_CODE, date, 10_000); // 단기채 0
      push(CORE_DEFENSE_BOND_CODE, date, 10_000);
    });
    [CORE_OFFENSE_INTL_CODE, CORE_OFFENSE_DOMESTIC_CODE].forEach((c) =>
      push(c, fillDate, 15_100, 15_000),
    );
    [CORE_ABS_MOMENTUM_FILTER_CODE, CORE_DEFENSE_BOND_CODE].forEach((c) =>
      push(c, fillDate, 10_000, 10_000),
    );

    // 이미 오프A 100주 보유(진입가 14,900) 상태 seed.
    const prisma = makePrisma(bars, [
      {
        etfCode: CORE_OFFENSE_INTL_CODE,
        styleTag: 'alloc:dual-momentum',
        status: 'OPEN',
        decisionDate: '20251230',
        entryTradeDate: '20251231',
        reservedShares: 100,
        reservedPrice: 14900,
        entryPrice: 14900,
        shares: 100,
        commission: 223,
      },
    ]);
    const svc = new DualMomentumForwardService(prisma);
    await svc.runDailyCycle(DECISION); // 방어 예약(SWITCH)
    const res = await svc.runDailyCycle(FILL); // 매도(오프A)→매수(방어)

    // 오프A 매도(CLOSED) + 방어 매수(OPEN).
    const closed = prisma.__trades.filter((t: any) => t.status === 'CLOSED');
    expect(closed).toHaveLength(1);
    expect(closed[0].etfCode).toBe(CORE_OFFENSE_INTL_CODE);
    expect(closed[0].tax).toBe(0); // ETF 매도세 면제
    expect(res.holding).toBe(CORE_DEFENSE_BOND_CODE);
    expect(res.filled).toBe(2); // 매도 + 매수
  });

  it('결측 fail-safe: 이력 부족(253봉 미만) → 무행동 + OPS_ALERT(멱등)', async () => {
    const dates = seqDatesEndingAt(100, DECISION); // 253 미만 → computeMomentum=null
    const bars: Bar[] = [];
    dates.forEach((date) => {
      for (const c of [
        CORE_OFFENSE_INTL_CODE,
        CORE_OFFENSE_DOMESTIC_CODE,
        CORE_ABS_MOMENTUM_FILTER_CODE,
        CORE_DEFENSE_BOND_CODE,
      ]) {
        bars.push({
          etfCode: c,
          tradeDate: date,
          openPrice: 10_000,
          highPrice: 10_000,
          lowPrice: 10_000,
          closePrice: 10_000,
        });
      }
    });
    const enqueueOpsAlert = jest.fn(() => Promise.resolve());
    const prisma = makePrisma(bars);
    const svc = new DualMomentumForwardService(prisma, { enqueueOpsAlert } as any);
    const res = await svc.runDailyCycle(DECISION);

    expect(res.rebalance).toBe('SUSPENDED');
    expect(prisma.__trades.filter((t: any) => t.status === 'PENDING')).toHaveLength(0);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
    const alertMeta = (enqueueOpsAlert.mock.calls[0] as any[])[3];
    expect(alertMeta.dedupeKey).toBe(`dual-momentum-forward:suspended:${DECISION}`);
  });

  it('HOLD: 목표 == 현재 보유면 예약 없음(회전 최소화)', async () => {
    const prisma = makePrisma(buildUniverseBars(DECISION), [
      {
        etfCode: CORE_OFFENSE_INTL_CODE,
        styleTag: 'alloc:dual-momentum',
        status: 'OPEN',
        decisionDate: '20251230',
        entryTradeDate: '20251231',
        reservedShares: 100,
        reservedPrice: 12000,
        entryPrice: 12000,
        shares: 100,
        commission: 180,
      },
    ]);
    const svc = new DualMomentumForwardService(prisma);
    const res = await svc.runDailyCycle(DECISION);

    expect(res.rebalance).toBe('HOLD');
    expect(prisma.__trades.filter((t: any) => t.status === 'PENDING')).toHaveLength(0);
    expect(res.holding).toBe(CORE_OFFENSE_INTL_CODE);
  });

  it('킬스위치(REDUCE_ONLY): 매도만 집행·매수 예약 취소(현금 보유)', async () => {
    // SWITCH 시나리오(보유 오프A → 방어) + 킬스위치 활성.
    const dates = seqDatesEndingAt(260, DECISION);
    const bars: Bar[] = [];
    const push = (code: string, date: string, close: number, open = close) =>
      bars.push({
        etfCode: code,
        tradeDate: date,
        openPrice: open,
        highPrice: close,
        lowPrice: open,
        closePrice: close,
      });
    dates.forEach((date, i) => {
      push(CORE_OFFENSE_INTL_CODE, date, 20_000 - i * 20);
      push(CORE_OFFENSE_DOMESTIC_CODE, date, 20_000 - i * 20);
      push(CORE_ABS_MOMENTUM_FILTER_CODE, date, 10_000);
      push(CORE_DEFENSE_BOND_CODE, date, 10_000);
    });
    [CORE_OFFENSE_INTL_CODE, CORE_OFFENSE_DOMESTIC_CODE].forEach((c) =>
      push(c, FILL, 15_100, 15_000),
    );
    [CORE_ABS_MOMENTUM_FILTER_CODE, CORE_DEFENSE_BOND_CODE].forEach((c) =>
      push(c, FILL, 10_000, 10_000),
    );

    const prisma = makePrisma(bars, [
      {
        etfCode: CORE_OFFENSE_INTL_CODE,
        styleTag: 'alloc:dual-momentum',
        status: 'OPEN',
        decisionDate: '20251230',
        entryTradeDate: '20251231',
        reservedShares: 100,
        reservedPrice: 14900,
        entryPrice: 14900,
        shares: 100,
        commission: 223,
      },
    ]);
    const killSwitch = { isActive: () => true } as any;
    const svc = new DualMomentumForwardService(prisma, undefined, killSwitch);
    await svc.runDailyCycle(DECISION); // 방어 예약
    const res = await svc.runDailyCycle(FILL); // 킬스위치 → 매도만

    expect(prisma.__trades.filter((t: any) => t.status === 'CLOSED')).toHaveLength(1); // 매도됨
    expect(prisma.__trades.filter((t: any) => t.status === 'OPEN')).toHaveLength(0); // 매수 안 함
    expect(prisma.__trades.filter((t: any) => t.status === 'CANCELLED')).toHaveLength(1); // 예약 취소
    expect(res.holding).toBeNull(); // 현금 보유(축소)
  });

  it('월말 아닌 날: 판정 없음(NOT_MONTH_END) — 평가 스냅샷만', async () => {
    const prisma = makePrisma(buildUniverseBars(DECISION));
    const svc = new DualMomentumForwardService(prisma);
    const res = await svc.runDailyCycle('20260115'); // 월중

    expect(res.rebalance).toBe('NOT_MONTH_END');
    expect(prisma.__snapshots.length).toBeGreaterThan(0);
  });

  // ── DAR-497 [견고화 W2·P19]: 드로다운 컷 → 킬스위치 REDUCE_ONLY 발동(ENFORCE) ──
  const drawdownDecision = (over: any = {}) => ({
    action: 'ALLOW',
    track: 'dual-momentum-forward',
    mode: 'ENFORCE',
    violations: [],
    allowed: true,
    highWaterMark: 10_000_000,
    drawdownPct: 0,
    ...over,
  });

  it('드로다운 컷 BLOCK → 킬스위치 REDUCE_ONLY 발동(1회·자동 재개 금지)', async () => {
    const prisma = makePrisma([]); // 비월말·현금 → ETF 바 불필요
    let active = false;
    const killSwitch = {
      isActive: () => active,
      activate: jest.fn(async () => {
        active = true;
      }),
    } as any;
    const riskGuard = {
      evaluateDrawdownCut: jest.fn(async () =>
        drawdownDecision({
          action: 'BLOCK',
          allowed: false,
          drawdownPct: -18,
          violations: [{ code: 'DRAWDOWN_CUT', message: 'x', details: {} }],
        }),
      ),
    } as any;
    const svc = new DualMomentumForwardService(prisma, undefined, killSwitch, riskGuard);

    await svc.runDailyCycle('20260115'); // 비월말 사이클
    expect(riskGuard.evaluateDrawdownCut).toHaveBeenCalledTimes(1);
    expect(killSwitch.activate).toHaveBeenCalledTimes(1);
    const [reason, by] = killSwitch.activate.mock.calls[0];
    expect(reason).toContain('드로다운 컷');
    expect(reason).toContain('REDUCE_ONLY');
    expect(by).toBe('SYSTEM');

    // 이미 활성 → 재발동 금지(자동 재개 금지 + RISK_ALERT 스팸 방지).
    await svc.runDailyCycle('20260116');
    expect(killSwitch.activate).toHaveBeenCalledTimes(1);
  });

  it('드로다운 정상(ALLOW) → 킬스위치 미발동', async () => {
    const prisma = makePrisma([]);
    const killSwitch = { isActive: () => false, activate: jest.fn() } as any;
    const riskGuard = {
      evaluateDrawdownCut: jest.fn(async () => drawdownDecision({ drawdownPct: -5 })),
    } as any;
    const svc = new DualMomentumForwardService(prisma, undefined, killSwitch, riskGuard);

    await svc.runDailyCycle('20260115');
    expect(riskGuard.evaluateDrawdownCut).toHaveBeenCalledTimes(1);
    expect(killSwitch.activate).not.toHaveBeenCalled();
  });

  it('riskGuard 미주입(단위 폴백)이면 드로다운 평가 자체 스킵(무영향)', async () => {
    const prisma = makePrisma([]);
    const killSwitch = { isActive: () => false, activate: jest.fn() } as any;
    const svc = new DualMomentumForwardService(prisma, undefined, killSwitch);
    const res = await svc.runDailyCycle('20260115');
    expect(res.rebalance).toBe('NOT_MONTH_END');
    expect(killSwitch.activate).not.toHaveBeenCalled();
  });

  // ── DAR-501 [견고화 W2·P21]: 월간 손실 한도(−10%) → 게이트 BLOCK(당월 신규 진입 차단·킬스위치 아님) ──
  it('월간 손실 한도 BLOCK → 매도만 집행·매수 예약 취소(당월 신규 진입 중단·킬스위치 미발동)', async () => {
    // SWITCH 시나리오(보유 오프A → 방어) 재사용 + 게이트가 MONTHLY_LOSS BLOCK 반환.
    const dates = seqDatesEndingAt(260, DECISION);
    const bars: Bar[] = [];
    const push = (code: string, date: string, close: number, open = close) =>
      bars.push({
        etfCode: code,
        tradeDate: date,
        openPrice: open,
        highPrice: close,
        lowPrice: open,
        closePrice: close,
      });
    dates.forEach((date, i) => {
      push(CORE_OFFENSE_INTL_CODE, date, 20_000 - i * 20); // 하락 → 방어 전환
      push(CORE_OFFENSE_DOMESTIC_CODE, date, 20_000 - i * 20);
      push(CORE_ABS_MOMENTUM_FILTER_CODE, date, 10_000);
      push(CORE_DEFENSE_BOND_CODE, date, 10_000);
    });
    [CORE_OFFENSE_INTL_CODE, CORE_OFFENSE_DOMESTIC_CODE].forEach((c) =>
      push(c, FILL, 15_100, 15_000),
    );
    [CORE_ABS_MOMENTUM_FILTER_CODE, CORE_DEFENSE_BOND_CODE].forEach((c) =>
      push(c, FILL, 10_000, 10_000),
    );

    const prisma = makePrisma(bars, [
      {
        etfCode: CORE_OFFENSE_INTL_CODE,
        styleTag: 'alloc:dual-momentum',
        status: 'OPEN',
        decisionDate: '20251230',
        entryTradeDate: '20251231',
        reservedShares: 100,
        reservedPrice: 14900,
        entryPrice: 14900,
        shares: 100,
        commission: 223,
      },
    ]);
    const killSwitch = { isActive: () => false, activate: jest.fn() } as any;
    const riskGuard = {
      // 스냅샷 드로다운 평가는 정상(ALLOW) — 킬스위치 발동 없음.
      evaluateDrawdownCut: jest.fn(async () => ({
        action: 'ALLOW',
        allowed: true,
        track: 'dual-momentum-forward',
        mode: 'ENFORCE',
        violations: [],
        highWaterMark: 10_000_000,
        drawdownPct: 0,
      })),
      // 진입 게이트는 당월 손실 −10% 초과 → MONTHLY_LOSS BLOCK.
      evaluateEntry: jest.fn(async () => ({
        action: 'BLOCK',
        allowed: false,
        track: 'dual-momentum-forward',
        mode: 'ENFORCE',
        violations: [{ code: 'MONTHLY_LOSS', message: 'x', details: {} }],
      })),
    } as any;

    const svc = new DualMomentumForwardService(prisma, undefined, killSwitch, riskGuard);
    await svc.runDailyCycle(DECISION); // 방어 예약(SWITCH)
    const res = await svc.runDailyCycle(FILL); // 매도(오프A) → 매수 BLOCK

    // 게이트에 당월 실현손익이 전달됐는지(월간 룰 배선 확인).
    expect(riskGuard.evaluateEntry).toHaveBeenCalledTimes(1);
    const gateArg = riskGuard.evaluateEntry.mock.calls[0][0];
    expect(gateArg.track).toBe('dual-momentum-forward');
    expect(typeof gateArg.monthlyRealizedPnl).toBe('number');

    // 매도는 됐지만(현금 확보) 매수는 차단 → 예약 취소·현금 보유.
    expect(prisma.__trades.filter((t: any) => t.status === 'CLOSED')).toHaveLength(1);
    expect(prisma.__trades.filter((t: any) => t.status === 'OPEN')).toHaveLength(0);
    expect(prisma.__trades.filter((t: any) => t.status === 'CANCELLED')).toHaveLength(1);
    expect(res.holding).toBeNull();
    expect(res.filled).toBe(1); // 매도만
    // ★킬스위치가 아니라 게이트 BLOCK — 월 바뀌면 자동 재개(명세 3-3).
    expect(killSwitch.activate).not.toHaveBeenCalled();
  });
});

// 다음 판정 예정일(순수 캘린더) — 월 1회 리밸런싱 스케줄 안내값 (DAR-495 [견고화 W1·P17]).
describe('nextMonthEndDecisionDate (DAR-495)', () => {
  it('월중이면 이번 달 마지막 거래일을 반환한다', () => {
    const jan = nextMonthEndDecisionDate('20260115');
    expect(jan).toBe(lastTradingDayOfMonth(2026, 1)); // 20260130
    expect(isLastTradingDayOfMonth(jan)).toBe(true);
  });

  it('이번 달 마지막 거래일 당일이면 그대로(오늘 판정)', () => {
    const janEnd = lastTradingDayOfMonth(2026, 1);
    expect(nextMonthEndDecisionDate(janEnd)).toBe(janEnd);
  });

  it('이번 달 마지막 거래일이 지났으면 다음 달 마지막 거래일로 롤오버', () => {
    // 20260131(토)은 1월 마지막 거래일(20260130) 이후 → 2월로 롤오버.
    const feb = nextMonthEndDecisionDate('20260131');
    expect(feb).toBe(lastTradingDayOfMonth(2026, 2));
    expect(feb > '20260131').toBe(true);
  });

  it('연말 롤오버: 12월 마지막 거래일 이후는 다음 해 1월로 넘어간다', () => {
    const decEnd = lastTradingDayOfMonth(2026, 12);
    // 12월 마지막 거래일이 12/31 미만(연말 휴장 통상)일 때 그 이후일로 연도 롤오버 검증.
    if (decEnd < '20261231') {
      const res = nextMonthEndDecisionDate('20261231');
      expect(res).toBe(lastTradingDayOfMonth(2027, 1));
      expect(res.slice(0, 4)).toBe('2027');
    } else {
      expect(nextMonthEndDecisionDate(decEnd)).toBe(decEnd);
    }
  });
});

// 코어 트랙 스코어카드(read-only) — 통일 성적표·유형 라벨·다음 판정일 (DAR-495 [견고화 W1·P17]).
describe('DualMomentumForwardService.getScorecard (DAR-495)', () => {
  const DECISION = '20260130';
  const FILL = nextTradingDay(DECISION);

  it('빈 트랙: 표본 0·LOW_SAMPLE·평가=초기자본·유형 라벨/다음 판정일 정직 표기', async () => {
    const prisma = makePrisma(buildUniverseBars(DECISION));
    const svc = new DualMomentumForwardService(prisma);
    const card = await svc.getScorecard();

    expect(card.trackTypeLabel).toBe(CORE_TRACK_TYPE_LABEL);
    expect(card.rebalanceFrequency).toBe('MONTHLY');
    expect(card.styleTag).toBe('alloc:dual-momentum');
    expect(card.scorecard.sampleSize).toBe(0);
    expect(card.lowSample).toBe(true);
    expect(card.lowSampleThreshold).toBe(DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD);
    expect(card.holding).toBeNull();
    expect(card.holdingName).toBeNull();
    expect(card.equity).toBeCloseTo(DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL, 0);
    expect(card.cumulativeReturnPct).toBeCloseTo(0, 5);
    // 다음 판정 예정일은 실제 월말 거래일이어야 한다(스케줄 안내·과신 방지 없음).
    expect(isLastTradingDayOfMonth(card.nextDecisionDate)).toBe(true);
  });

  it('회전 1건 후: 통일 성적표 표본 반영 + etfName 병기 + 자산곡선 누적', async () => {
    // SWITCH(보유 오프A→방어) → 오프A 청산 CLOSED 1건 생성(기존 시나리오 재사용).
    const dates = seqDatesEndingAt(260, DECISION);
    const bars: Bar[] = [];
    const push = (code: string, date: string, close: number, open = close) =>
      bars.push({
        etfCode: code,
        tradeDate: date,
        openPrice: open,
        highPrice: close,
        lowPrice: open,
        closePrice: close,
      });
    dates.forEach((date, i) => {
      push(CORE_OFFENSE_INTL_CODE, date, 20_000 - i * 20);
      push(CORE_OFFENSE_DOMESTIC_CODE, date, 20_000 - i * 20);
      push(CORE_ABS_MOMENTUM_FILTER_CODE, date, 10_000);
      push(CORE_DEFENSE_BOND_CODE, date, 10_000);
    });
    [CORE_OFFENSE_INTL_CODE, CORE_OFFENSE_DOMESTIC_CODE].forEach((c) =>
      push(c, FILL, 15_100, 15_000),
    );
    [CORE_ABS_MOMENTUM_FILTER_CODE, CORE_DEFENSE_BOND_CODE].forEach((c) =>
      push(c, FILL, 10_000, 10_000),
    );

    const prisma = makePrisma(bars, [
      {
        etfCode: CORE_OFFENSE_INTL_CODE,
        styleTag: 'alloc:dual-momentum',
        status: 'OPEN',
        decisionDate: '20251230',
        entryTradeDate: '20251231',
        reservedShares: 100,
        reservedPrice: 14900,
        entryPrice: 14900,
        shares: 100,
        commission: 223,
        entryTs: new Date('2025-12-31T00:00:00Z'),
      },
    ]);
    const svc = new DualMomentumForwardService(prisma);
    await svc.runDailyCycle(DECISION); // 방어 예약(SWITCH)
    await svc.runDailyCycle(FILL); // 매도(오프A)→매수(방어)

    const card = await svc.getScorecard();
    // 통일 성적표(trade-scorecard SSOT): 오프A 청산 1건 반영.
    expect(card.scorecard.sampleSize).toBe(1);
    expect(card.scorecard.closedCount).toBe(1);
    // 현재 보유 = 방어채권(+ 사람 읽는 이름).
    expect(card.holding).toBe(CORE_DEFENSE_BOND_CODE);
    expect(card.holdingName).toBe('KODEX 종합채권(AA-이상)액티브');
    // 자산곡선: 두 사이클 스냅샷 누적(≥2점).
    expect(card.equityCurve.length).toBeGreaterThanOrEqual(2);
    // 리밸런싱 이력: CLOSED(오프A)에 etfName 병기.
    const closedRow = card.rebalanceHistory.find((r) => r.status === 'CLOSED');
    expect(closedRow?.etfCode).toBe(CORE_OFFENSE_INTL_CODE);
    expect(closedRow?.etfName).toBe('TIGER 미국S&P500');
  });
});
