// Engine5 — RiskGuardService.evaluateAutoKillShadow 오케스트레이션 테스트
//   (DAR-502 [견고화 W2·P20] — 자동 킬스위치 SHADOW 계측)
import { RiskGuardService, RiskGuardAutoKillInput } from './risk-guard.service';

type CreateArg = { data: Record<string, unknown> };
type Row = Record<string, unknown> & { id: string };

/**
 * 자동킬 SHADOW 계측용 인메모리 prisma 페이크.
 *   - riskDecisionLog: create/findFirst(meta.kind 경로)/update 로 멱등 기록 검증.
 *   - paperTrade/intradayScalpTrade: 청산 시계열(netPnl) 주입.
 *   - marketIndex: 지수 2행 주입. cronRunLog: FAILED count 주입.
 */
function makeService(seed?: {
  paperSells?: Array<{ netPnl: number | null }>;
  scalpExits?: Array<{ netPnl: number | null }>;
  indexRows?: Array<{ closeIndex: number; openIndex: number }>;
  failedCronCount?: number;
}) {
  const logs: Row[] = [];
  const alerts: Array<{
    severity: string;
    source: string;
    message: string;
    meta?: { dedupeKey?: string; data?: Record<string, unknown> };
  }> = [];
  let idSeq = 0;

  const prisma = {
    riskDecisionLog: {
      create: jest.fn(async (arg: CreateArg) => {
        const row: Row = { id: `log${++idSeq}`, ...arg.data };
        logs.push(row);
        return row;
      }),
      findFirst: jest.fn(
        async (arg: {
          where: {
            track: string;
            tradeDate: string;
            meta?: { path: string[]; equals: unknown };
          };
        }) => {
          const kind = arg.where.meta?.equals;
          return (
            logs.find(
              (r) =>
                r.track === arg.where.track &&
                r.tradeDate === arg.where.tradeDate &&
                (r.meta as Record<string, unknown> | undefined)?.kind === kind,
            ) ?? null
          );
        },
      ),
      update: jest.fn(
        async (arg: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = logs.find((r) => r.id === arg.where.id);
          if (row) Object.assign(row, arg.data);
          return row as Row;
        },
      ),
    },
    paperTrade: {
      findMany: jest.fn(async () => seed?.paperSells ?? []),
    },
    intradayScalpTrade: {
      findMany: jest.fn(async () => seed?.scalpExits ?? []),
    },
    marketIndex: {
      findMany: jest.fn(async () => seed?.indexRows ?? []),
    },
    cronRunLog: {
      count: jest.fn(async () => seed?.failedCronCount ?? 0),
    },
  };
  const notifyProducer = {
    enqueueOpsAlert: jest.fn(
      async (
        severity: string,
        source: string,
        message: string,
        meta?: { dedupeKey?: string; data?: Record<string, unknown> },
      ) => {
        alerts.push({ severity, source, message, meta });
      },
    ),
  };
  const svc = new RiskGuardService(prisma as never, notifyProducer as never);
  return { svc, logs, alerts, prisma, notifyProducer };
}

const base = (over: Partial<RiskGuardAutoKillInput> = {}): RiskGuardAutoKillInput => ({
  track: 'paper-simulation',
  tradeDate: '20260704',
  lossSource: 'paper-trade',
  styleTag: null,
  ...over,
});

describe('RiskGuardService.evaluateAutoKillShadow (DAR-502 P20)', () => {
  it('정상(연속손실 4·급락 없음·오류 0): 권고 없음 → ALLOW 기록·알림 없음', async () => {
    const { svc, logs, alerts } = makeService({
      paperSells: [{ netPnl: -1 }, { netPnl: -2 }, { netPnl: -3 }, { netPnl: -4 }, { netPnl: 5 }],
    });
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.advice.shouldKill).toBe(false);
    expect(r.inputs.consecutiveLossCount).toBe(4); // 임계 5 미달
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('ALLOW');
    expect((logs[0].meta as Record<string, unknown>).kind).toBe('AUTO_KILL_ADVICE');
    expect(alerts).toHaveLength(0);
  });

  it('연속손실 5회: CONSECUTIVE_LOSS 권고 → SHADOW_VIOLATION 기록 + OPS_ALERT(일1회 dedupe)', async () => {
    const { svc, logs, alerts } = makeService({
      paperSells: [{ netPnl: -1 }, { netPnl: -2 }, { netPnl: -3 }, { netPnl: -4 }, { netPnl: -5 }],
    });
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.advice.shouldKill).toBe(true);
    expect(r.advice.triggerCode).toBe('CONSECUTIVE_LOSS');
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('SHADOW_VIOLATION');
    expect(logs[0].mode).toBe('SHADOW');
    expect(logs[0].violationCodes).toBe('CONSECUTIVE_LOSS');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('WARNING');
    expect(alerts[0].meta?.dedupeKey).toBe('auto-kill:shadow:paper-simulation:20260704');
  });

  it('API 오류 3회(CronRunLog FAILED): API_ERROR 권고', async () => {
    const { svc } = makeService({ failedCronCount: 3 });
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.inputs.apiErrorCount).toBe(3);
    expect(r.advice.shouldKill).toBe(true);
    expect(r.advice.triggerCode).toBe('API_ERROR');
  });

  it('시장급락 raw 값은 기록되나 frozen DEFAULT(marketDropPct=0)라 판정 미기여(임계 무변경)', async () => {
    // 전일 대비 -10% 급락이어도 DEFAULT 조건상 시장급락 레그는 비활성 → shouldKill=false.
    const { svc, logs } = makeService({
      indexRows: [
        { closeIndex: 900, openIndex: 990 },
        { closeIndex: 1000, openIndex: 1000 },
      ],
    });
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.inputs.marketDropPct).toBeCloseTo(-0.1, 10); // raw 기록됨
    expect(r.advice.shouldKill).toBe(false); // 판정에는 미기여(P23 사후 재해석용)
    expect((logs[0].meta as { inputs: { marketDropPct: number } }).inputs.marketDropPct).toBeCloseTo(
      -0.1,
      10,
    );
  });

  it('멱등: 같은 track+tradeDate 재호출은 1행 유지(장중 매 10분 재호출 노이즈 0)', async () => {
    const { svc, logs, prisma } = makeService({
      scalpExits: [{ netPnl: 5 }], // 정상
    });
    const inp = base({ track: 'intraday-scalp', lossSource: 'intraday-scalp' });
    await svc.evaluateAutoKillShadow(inp);
    await svc.evaluateAutoKillShadow(inp);
    await svc.evaluateAutoKillShadow(inp);
    expect(logs).toHaveLength(1);
    expect(prisma.riskDecisionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.riskDecisionLog.update).not.toHaveBeenCalled();
  });

  it('에스컬레이션: 당일 ALLOW→발동 전이 시 기존 행 갱신(신규 행 추가 없음)', async () => {
    // 1차: 정상(scalpExits 정상) → ALLOW. 2차: 연속손실 5회로 seed 교체 → 발동.
    const { svc, logs, prisma } = makeService({ scalpExits: [{ netPnl: 5 }] });
    const inp = base({ track: 'intraday-scalp', lossSource: 'intraday-scalp' });
    await svc.evaluateAutoKillShadow(inp);
    expect(logs[0].action).toBe('ALLOW');
    // 장중 손실 누적 → 연속손실 5회로 시계열 변경.
    (prisma.intradayScalpTrade.findMany as jest.Mock).mockResolvedValue([
      { netPnl: -1 },
      { netPnl: -2 },
      { netPnl: -3 },
      { netPnl: -4 },
      { netPnl: -5 },
    ]);
    await svc.evaluateAutoKillShadow(inp);
    expect(logs).toHaveLength(1); // 신규 행 없음
    expect(logs[0].action).toBe('SHADOW_VIOLATION'); // 에스컬레이션 갱신
    expect(prisma.riskDecisionLog.update).toHaveBeenCalledTimes(1);
  });

  it('SHADOW 중립성: 발동 권고여도 activate() 경로 없음(서비스에 KillSwitchManager 참조 부재)', async () => {
    // 구조적 증명: RiskGuardService 생성자에 KillSwitch 의존이 없다 → 발동 불가능.
    const { svc } = makeService({
      paperSells: [{ netPnl: -1 }, { netPnl: -2 }, { netPnl: -3 }, { netPnl: -4 }, { netPnl: -5 }],
    });
    // 서비스 인스턴스에 killSwitch/activate 참조가 존재하지 않음을 확인.
    expect((svc as unknown as Record<string, unknown>).killSwitch).toBeUndefined();
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.advice.shouldKill).toBe(true); // 권고는 하되
    // (발동은 하지 않음 — 이 서비스에는 activate 를 부를 대상 자체가 없다.)
  });

  it('graceful: 입력 조회 실패해도 판정 진행(0 폴백)·throw 없음', async () => {
    const { svc, prisma } = makeService();
    (prisma.paperTrade.findMany as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    (prisma.marketIndex.findMany as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    (prisma.cronRunLog.count as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.inputs).toEqual({ consecutiveLossCount: 0, marketDropPct: 0, apiErrorCount: 0 });
    expect(r.advice.shouldKill).toBe(false);
  });

  it('graceful: 영속 실패해도 결과 반환(throw 없음)', async () => {
    const { svc, prisma } = makeService({ failedCronCount: 3 });
    (prisma.riskDecisionLog.findFirst as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const r = await svc.evaluateAutoKillShadow(base());
    expect(r.advice.triggerCode).toBe('API_ERROR');
  });
});
