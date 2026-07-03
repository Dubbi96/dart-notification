// Engine5 — OrderShadowLedgerService 테스트 (DAR-498 §1·§2·§3)
import {
  OrderShadowLedgerService,
  RecordReservationInput,
  shadowIdempotencyKey,
} from './order-shadow-ledger.service';
import { PaperExecutionAdapter } from '../domain/execution-port';
import { simulateFill, DEFAULT_FILL_PARAMS } from '../domain/fill-simulator';
import { reconcileOrderLedger } from '../paper-simulation/order-ledger-reconcile';

interface Row {
  id: string;
  idempotencyKey: string;
  status: string;
  [k: string]: unknown;
}

function makeLedger(
  opts: {
    approved?: boolean;
    violations?: { code: string }[];
    vetoReason?: string;
    noOrderRisk?: boolean;
    upsertThrows?: boolean;
  } = {},
) {
  const rowsById = new Map<string, Row>();
  const idByKey = new Map<string, string>();
  const executions: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  let seq = 0;

  const prisma = {
    orderRequest: {
      upsert: jest.fn(async ({ where, create, update }: never) => {
        if (opts.upsertThrows) throw new Error('boom');
        const key = (where as { idempotencyKey: string }).idempotencyKey;
        if (idByKey.has(key)) {
          const row = rowsById.get(idByKey.get(key)!)!;
          Object.assign(row, update);
          return { ...row };
        }
        const id = `req${++seq}`;
        const row: Row = { id, ...(create as object) } as Row;
        rowsById.set(id, row);
        idByKey.set(key, id);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: never) => {
        const w = where as { idempotencyKey?: string; id?: string };
        if (w.idempotencyKey) {
          const id = idByKey.get(w.idempotencyKey);
          return id ? { ...rowsById.get(id)! } : null;
        }
        if (w.id) return rowsById.has(w.id) ? { ...rowsById.get(w.id)! } : null;
        return null;
      }),
      update: jest.fn(async ({ where, data }: never) => {
        const id = (where as { id: string }).id;
        const row = rowsById.get(id)!;
        Object.assign(row, data as object);
        return { ...row };
      }),
    },
    orderExecution: {
      create: jest.fn(async ({ data }: never) => {
        const id = `exec${++seq}`;
        const row = { id, ...(data as Record<string, unknown>) };
        executions.push(row);
        return row;
      }),
    },
    tradingAuditLog: {
      create: jest.fn(async ({ data }: never) => {
        audits.push(data as Record<string, unknown>);
        return { id: `audit${++seq}`, ...(data as Record<string, unknown>) };
      }),
    },
  };

  const orderRisk = opts.noOrderRisk
    ? undefined
    : {
        evaluateOrder: jest.fn(async (req: { idempotencyKey: string }) => ({
          idempotencyKey: req.idempotencyKey,
          approved: opts.approved ?? true,
          result: {
            approved: opts.approved ?? true,
            violations: opts.violations ?? [],
            vetoed: !!opts.vetoReason,
            vetoReason: opts.vetoReason,
          },
          auditLogId: 'a1',
        })),
      };

  const svc = new OrderShadowLedgerService(
    prisma as never,
    orderRisk as never,
    new PaperExecutionAdapter(),
  );
  return { svc, prisma, rowsById, idByKey, executions, audits, orderRisk };
}

const reservation = (
  over: Partial<RecordReservationInput> = {},
): RecordReservationInput => ({
  tradingSignalId: 'sig1',
  paperTradeId: 'pt1',
  corpCode: 'C1',
  stockCode: '005930',
  orderedShares: 100,
  referencePrice: 70_000,
  totalCapital: 10_000_000,
  dailyRealizedPnl: 0,
  availableCash: 5_000_000,
  openOrderCount: 0,
  todayTradeCount: 0,
  buyScore: 80,
  killSwitchActive: false,
  ...over,
});

describe('OrderShadowLedgerService.recordReservation', () => {
  it('OrderRiskService.evaluateOrder 첫 실소비 + APPROVED 원장 생성(멱등키=tradingSignalId)', async () => {
    const { svc, orderRisk, rowsById } = makeLedger({ approved: true });
    await svc.recordReservation(reservation());
    expect(orderRisk!.evaluateOrder).toHaveBeenCalledTimes(1);
    const row = [...rowsById.values()][0];
    expect(row.idempotencyKey).toBe(shadowIdempotencyKey('sig1'));
    expect(row.status).toBe('APPROVED');
    expect(row.rejectionReason).toBeNull();
    expect(row.paperTradeId).toBe('pt1');
    expect(row.buyScoreSnapshot).toBe(80);
  });

  it('veto(비승인): status=REJECTED + rejectionReason 기록(SHADOW — 모의 체결은 별개 경로)', async () => {
    const { svc, rowsById } = makeLedger({
      approved: false,
      violations: [{ code: 'OVER_TRADING' }],
      vetoReason: 'Risk veto: buyScore 긍정이나 과매매',
    });
    await svc.recordReservation(reservation());
    const row = [...rowsById.values()][0];
    expect(row.status).toBe('REJECTED');
    expect(String(row.rejectionReason)).toContain('veto');
  });

  it('킬스위치 위반: status=KILLED', async () => {
    const { svc, rowsById } = makeLedger({
      approved: false,
      violations: [{ code: 'KILL_SWITCH_ACTIVE' }],
    });
    await svc.recordReservation(reservation({ killSwitchActive: true }));
    expect([...rowsById.values()][0].status).toBe('KILLED');
  });

  it('OrderRiskService 미주입: 판정 없이 예약만 기록(status=PENDING)', async () => {
    const { svc, rowsById } = makeLedger({ noOrderRisk: true });
    await svc.recordReservation(reservation());
    expect([...rowsById.values()][0].status).toBe('PENDING');
  });

  it('멱등: 같은 신호 재예약은 upsert 갱신(행 1개 유지)', async () => {
    const { svc, rowsById } = makeLedger();
    await svc.recordReservation(reservation({ paperTradeId: 'pt1' }));
    await svc.recordReservation(reservation({ paperTradeId: 'pt2' }));
    expect(rowsById.size).toBe(1);
    expect([...rowsById.values()][0].paperTradeId).toBe('pt2');
  });

  it('섀도 라이트: prisma 실패해도 throw 안 함(매매 보호)', async () => {
    const { svc } = makeLedger({ upsertThrows: true });
    await expect(svc.recordReservation(reservation())).resolves.toBeUndefined();
  });
});

describe('OrderShadowLedgerService.recordFill', () => {
  it('ExecutionPort 체결 확인 → OrderExecution 생성 + OrderRequest EXECUTED 연결 + 감사', async () => {
    const { svc, rowsById, executions, audits } = makeLedger();
    await svc.recordReservation(reservation());
    await svc.recordFill({
      tradingSignalId: 'sig1',
      paperTradeId: 'pt1',
      corpCode: 'C1',
      stockCode: '005930',
      orderedShares: 100,
      referencePrice: 70_000,
      dayVolume: 1_000_000,
      executedAt: new Date('2026-07-04T10:00:00Z'),
    });
    const direct = simulateFill(
      { direction: 'BUY', orderedShares: 100, entryPrice: 70_000, dayVolume: 1_000_000 },
      DEFAULT_FILL_PARAMS,
    );
    expect(executions).toHaveLength(1);
    expect(executions[0].executedShares).toBe(direct.filledShares);
    const row = [...rowsById.values()][0];
    expect(row.status).toBe('EXECUTED');
    expect(row.executionId).toBe(executions[0].id);
    expect(audits.some((a) => a.action === 'ORDER_EXECUTED')).toBe(true);
  });

  it('멱등: 이미 EXECUTED 면 두 번째 recordFill 은 no-op', async () => {
    const { svc, executions } = makeLedger();
    await svc.recordReservation(reservation());
    const fill = {
      tradingSignalId: 'sig1',
      paperTradeId: 'pt1',
      corpCode: 'C1',
      stockCode: '005930',
      orderedShares: 100,
      referencePrice: 70_000,
      dayVolume: 1_000_000,
      executedAt: new Date(),
    };
    await svc.recordFill(fill);
    await svc.recordFill(fill);
    expect(executions).toHaveLength(1);
  });

  it('orphan: 예약 기록 없이 recordFill → OrderExecution 미생성(대조 잡이 표면화)', async () => {
    const { svc, executions } = makeLedger();
    await svc.recordFill({
      tradingSignalId: 'ghost',
      paperTradeId: 'ptX',
      corpCode: 'C1',
      stockCode: '005930',
      orderedShares: 100,
      referencePrice: 70_000,
      executedAt: new Date(),
    });
    expect(executions).toHaveLength(0);
  });
});

describe('OrderShadowLedgerService.recordCancellation', () => {
  it('미체결 예약 → CANCELLED + 감사(ORDER_CANCELLED)', async () => {
    const { svc, rowsById, audits } = makeLedger();
    await svc.recordReservation(reservation());
    await svc.recordCancellation({ tradingSignalId: 'sig1', paperTradeId: 'pt1', reason: '이월 상한' });
    expect([...rowsById.values()][0].status).toBe('CANCELLED');
    expect(audits.some((a) => a.action === 'ORDER_CANCELLED')).toBe(true);
  });

  it('이미 EXECUTED 면 취소 무시(체결분 보호)', async () => {
    const { svc, rowsById } = makeLedger();
    await svc.recordReservation(reservation());
    await svc.recordFill({
      tradingSignalId: 'sig1',
      paperTradeId: 'pt1',
      corpCode: 'C1',
      stockCode: '005930',
      orderedShares: 100,
      referencePrice: 70_000,
      dayVolume: 1_000_000,
      executedAt: new Date(),
    });
    await svc.recordCancellation({ tradingSignalId: 'sig1', paperTradeId: 'pt1', reason: 'x' });
    expect([...rowsById.values()][0].status).toBe('EXECUTED');
  });

  it('예약 원장 없으면 no-op(정상)', async () => {
    const { svc, audits } = makeLedger();
    await svc.recordCancellation({ tradingSignalId: 'none', paperTradeId: 'p', reason: 'x' });
    expect(audits).toHaveLength(0);
  });
});

// ★핵심 불변식(DoD 재현): 섀도 원장(ExecutionPort 산출)과 PaperTrade 파생 체결(동일 simulateFill
//   입력)은 결정론적으로 일치한다 → 일일 대조가 항상 consistent. 두 계산이 어긋나면 대조가 잡는다.
describe('OrderShadowLedger ↔ PaperTrade 파생 정합 불변식', () => {
  it('같은 체결 입력: 원장 OrderExecution 과 PaperTrade 파생이 대조에서 consistent', async () => {
    const { svc, executions } = makeLedger();
    const shares = 137;
    const openPrice = 12_345;
    const dayVolume = 2_000_000;
    await svc.recordReservation(reservation({ orderedShares: shares, referencePrice: openPrice }));
    await svc.recordFill({
      tradingSignalId: 'sig1',
      paperTradeId: 'pt1',
      corpCode: 'C1',
      stockCode: '005930',
      orderedShares: shares,
      referencePrice: openPrice,
      dayVolume,
      executedAt: new Date(),
    });

    // PaperTrade 파생 체결(fillPendingEntries 가 쓰는 것과 동일 순수 함수·입력).
    const paperFill = simulateFill(
      { direction: 'BUY', orderedShares: shares, entryPrice: openPrice, dayVolume },
      DEFAULT_FILL_PARAMS,
    );
    const exec = executions[0];

    const report = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [
        {
          paperTradeId: 'pt1',
          filledShares: paperFill.filledShares,
          amount: paperFill.filledPrice * paperFill.filledShares,
        },
      ],
      ledgerExecs: [
        {
          paperTradeId: 'pt1',
          executedShares: exec.executedShares as number,
          amount:
            Number(exec.executedPrice) * (exec.executedShares as number),
        },
      ],
    });
    expect(report.consistent).toBe(true);
  });
});
