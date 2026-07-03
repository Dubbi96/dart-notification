// Engine5 — RiskGuardService 오케스트레이션 테스트 (DAR-496)
import { RiskGuardService, RiskGuardEvaluateInput } from './risk-guard.service';

type CreateArg = { data: Record<string, unknown> };

function makeService() {
  const created: Record<string, unknown>[] = [];
  const alerts: Array<{
    severity: string;
    source: string;
    message: string;
    meta?: Record<string, unknown>;
  }> = [];
  // 인메모리 HWM 저장소(포트폴리오 단위) — forward-only 갱신 로직 검증용.
  const hwmStore = new Map<string, Record<string, unknown>>();
  const prisma = {
    riskDecisionLog: {
      create: jest.fn(async (arg: CreateArg) => {
        created.push(arg.data);
        return { id: 'log1', ...arg.data };
      }),
    },
    accountHighWaterMark: {
      findUnique: jest.fn(async (arg: { where: { portfolioId: string } }) => {
        return hwmStore.get(arg.where.portfolioId) ?? null;
      }),
      create: jest.fn(async (arg: CreateArg) => {
        const row = { id: 'hwm1', ...arg.data };
        hwmStore.set(arg.data.portfolioId as string, row);
        return row;
      }),
      update: jest.fn(
        async (arg: { where: { portfolioId: string }; data: Record<string, unknown> }) => {
          const prev = hwmStore.get(arg.where.portfolioId) ?? {};
          const row = { ...prev, ...arg.data };
          hwmStore.set(arg.where.portfolioId, row);
          return row;
        },
      ),
    },
  };
  const notifyProducer = {
    enqueueOpsAlert: jest.fn(
      async (severity: string, source: string, message: string, meta?: Record<string, unknown>) => {
        alerts.push({ severity, source, message, meta });
      },
    ),
  };
  const svc = new RiskGuardService(prisma as never, notifyProducer as never);
  return { svc, created, alerts, prisma, notifyProducer, hwmStore };
}

const base = (over: Partial<RiskGuardEvaluateInput> = {}): RiskGuardEvaluateInput => ({
  track: 'paper-simulation',
  tradeDate: '20260704',
  totalCapital: 10_000_000,
  dailyRealizedPnl: 0,
  availableCash: 5_000_000,
  entryBudget: 1_000_000,
  ...over,
});

describe('RiskGuardService.evaluateEntry', () => {
  it('SHADOW 트랙: 위반이어도 BLOCK 아님 + RiskDecisionLog 기록', async () => {
    const { svc, created } = makeService();
    const d = await svc.evaluateEntry(
      base({
        track: 'paper-simulation',
        dailyRealizedPnl: -5_000_000,
        availableCash: 0,
        entryBudget: 1_000_000,
      }),
    );
    expect(d.action).toBe('SHADOW_VIOLATION');
    expect(created).toHaveLength(1);
    expect(created[0].mode).toBe('SHADOW');
    expect(created[0].action).toBe('SHADOW_VIOLATION');
    expect(created[0].violationCodes).toContain('DAILY_LOSS');
    expect(created[0].violationCodes).toContain('CASH_GUARD');
  });

  it('SHADOW 위반: 일 1회 dedupe 요약 알림(WARNING)', async () => {
    const { svc, alerts } = makeService();
    await svc.evaluateEntry(base({ dailyRealizedPnl: -5_000_000 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('WARNING');
    expect(alerts[0].meta?.dedupeKey).toBe('risk-guard:shadow:paper-simulation:20260704');
  });

  it('ALLOW: 위반 없으면 알림 없음(로그는 남김)', async () => {
    const { svc, created, alerts } = makeService();
    const d = await svc.evaluateEntry(base());
    expect(d.action).toBe('ALLOW');
    expect(created).toHaveLength(1);
    expect(created[0].action).toBe('ALLOW');
    expect(alerts).toHaveLength(0);
  });

  it('ENFORCE 트랙(dual-momentum-forward): 위반 시 BLOCK + 즉시 알림(ERROR)', async () => {
    const { svc, created, alerts } = makeService();
    const d = await svc.evaluateEntry(
      base({
        track: 'dual-momentum-forward',
        availableCash: 100,
        entryBudget: 1_000_000,
        corpCode: '360750',
      }),
    );
    expect(d.action).toBe('BLOCK');
    expect(created[0].mode).toBe('ENFORCE');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('ERROR');
    expect(alerts[0].meta?.dedupeKey).toContain('risk-guard:block:dual-momentum-forward:20260704');
  });

  it('MONTHLY_LOSS(P21): ENFORCE 코어가 당월 실현손실 −10% 초과면 BLOCK + meta 에 monthlyRealizedPnl 기록', async () => {
    const { svc, created } = makeService();
    const d = await svc.evaluateEntry(
      base({
        track: 'dual-momentum-forward',
        monthlyRealizedPnl: -1_500_000, // −15% ≪ −10%
        corpCode: '360750',
      }),
    );
    expect(d.action).toBe('BLOCK');
    expect(created[0].violationCodes).toContain('MONTHLY_LOSS');
    expect((created[0].meta as Record<string, unknown>).monthlyRealizedPnl).toBe(-1_500_000);
  });

  it('MONTHLY_LOSS(P21): SHADOW 측정 트랙은 −10% 초과여도 BLOCK 아님(기록만)', async () => {
    const { svc, created } = makeService();
    const d = await svc.evaluateEntry(
      base({ track: 'paper-simulation', monthlyRealizedPnl: -9_999_999 }),
    );
    expect(d.action).toBe('SHADOW_VIOLATION');
    expect(created[0].violationCodes).toContain('MONTHLY_LOSS');
  });

  it('영속 실패해도 판정은 정상 반환(graceful)', async () => {
    const { svc, prisma } = makeService();
    (prisma.riskDecisionLog.create as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const d = await svc.evaluateEntry(base());
    expect(d.action).toBe('ALLOW');
  });
});

describe('RiskGuardService.evaluateDrawdownCut (DAR-497 P19)', () => {
  it('최초 관측: HWM=현재 총자산 생성(과거 소급 없음) → 드로다운 0 → ALLOW', async () => {
    const { svc, prisma, created } = makeService();
    const r = await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf-core',
      tradeDate: '20260704',
      currentEquity: 10_000_000,
    });
    expect(prisma.accountHighWaterMark.create).toHaveBeenCalledTimes(1);
    expect(r.highWaterMark).toBe(10_000_000);
    expect(r.action).toBe('ALLOW');
    expect(r.drawdownPct).toBe(0);
    expect(created[0].violationCodes).toBe('');
  });

  it('신고점이면 HWM 상향 갱신(forward-only)', async () => {
    const { svc, hwmStore } = makeService();
    await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260701',
      currentEquity: 10_000_000,
    });
    const r = await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260702',
      currentEquity: 12_000_000,
    });
    expect(r.highWaterMark).toBe(12_000_000);
    expect(hwmStore.get('pf')?.highWaterMark).toBe(12_000_000);
    expect(hwmStore.get('pf')?.peakDate).toBe('20260702');
  });

  it('하락해도 HWM 유지(내려가지 않음) → 고점 대비 드로다운으로 판정', async () => {
    const { svc } = makeService();
    await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260701',
      currentEquity: 10_000_000,
    });
    const r = await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260702',
      currentEquity: 8_400_000,
    });
    expect(r.highWaterMark).toBe(10_000_000); // 유지
    expect(r.drawdownPct).toBeCloseTo(-16, 5);
    expect(r.action).toBe('BLOCK'); // ENFORCE
  });

  it('ENFORCE BLOCK: RiskDecisionLog 기록하되 OPS_ALERT 없음(킬스위치 RISK_ALERT 가 담당 — 중복 방지)', async () => {
    const { svc, created, alerts } = makeService();
    await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260701',
      currentEquity: 10_000_000,
    });
    await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260702',
      currentEquity: 8_000_000,
    });
    const blockLog = created.find((c) => c.action === 'BLOCK');
    expect(blockLog).toBeDefined();
    expect(blockLog?.violationCodes).toContain('DRAWDOWN_CUT');
    expect((blockLog?.meta as Record<string, unknown>).kind).toBe('DRAWDOWN_CUT');
    expect(alerts).toHaveLength(0); // ENFORCE 는 알림하지 않음
  });

  it('측정 트랙(SHADOW): 극단 드로다운에도 BLOCK 아님 + OPS_ALERT(일 1회 dedupe·포트폴리오 단위)', async () => {
    const { svc, alerts } = makeService();
    await svc.evaluateDrawdownCut({
      track: 'paper-simulation',
      portfolioId: 'pf-sim',
      tradeDate: '20260701',
      currentEquity: 10_000_000,
    });
    const r = await svc.evaluateDrawdownCut({
      track: 'paper-simulation',
      portfolioId: 'pf-sim',
      tradeDate: '20260702',
      currentEquity: 5_000_000,
    });
    expect(r.action).toBe('SHADOW_VIOLATION');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('WARNING');
    expect(alerts[0].meta?.dedupeKey).toBe(
      'risk-guard:drawdown:shadow:paper-simulation:pf-sim:20260702',
    );
  });

  it('HWM 조회 실패 → 현재 총자산 폴백(드로다운 0·오탐 없음)', async () => {
    const { svc, prisma } = makeService();
    (prisma.accountHighWaterMark.findUnique as jest.Mock).mockRejectedValueOnce(
      new Error('db down'),
    );
    const r = await svc.evaluateDrawdownCut({
      track: 'dual-momentum-forward',
      portfolioId: 'pf',
      tradeDate: '20260704',
      currentEquity: 7_000_000,
    });
    expect(r.highWaterMark).toBe(7_000_000);
    expect(r.action).toBe('ALLOW');
  });
});
