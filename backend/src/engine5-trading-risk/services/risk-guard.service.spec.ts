// Engine5 — RiskGuardService 오케스트레이션 테스트 (DAR-496)
import { RiskGuardService, RiskGuardEvaluateInput } from './risk-guard.service';

type CreateArg = { data: Record<string, unknown> };

function makeService() {
  const created: Record<string, unknown>[] = [];
  const alerts: Array<{ severity: string; source: string; message: string; meta?: Record<string, unknown> }> = [];
  const prisma = {
    riskDecisionLog: {
      create: jest.fn(async (arg: CreateArg) => {
        created.push(arg.data);
        return { id: 'log1', ...arg.data };
      }),
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
  return { svc, created, alerts, prisma, notifyProducer };
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
      base({ track: 'paper-simulation', dailyRealizedPnl: -5_000_000, availableCash: 0, entryBudget: 1_000_000 }),
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
      base({ track: 'dual-momentum-forward', availableCash: 100, entryBudget: 1_000_000, corpCode: '360750' }),
    );
    expect(d.action).toBe('BLOCK');
    expect(created[0].mode).toBe('ENFORCE');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('ERROR');
    expect(alerts[0].meta?.dedupeKey).toContain('risk-guard:block:dual-momentum-forward:20260704');
  });

  it('영속 실패해도 판정은 정상 반환(graceful)', async () => {
    const { svc, prisma } = makeService();
    (prisma.riskDecisionLog.create as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const d = await svc.evaluateEntry(base());
    expect(d.action).toBe('ALLOW');
  });
});
