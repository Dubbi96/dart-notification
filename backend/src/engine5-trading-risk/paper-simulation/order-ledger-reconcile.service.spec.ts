// Engine5 — OrderLedgerReconcileService 테스트 (DAR-498 §4)
import { OrderLedgerReconcileService } from './order-ledger-reconcile.service';

type PaperRow = { id: string; filledShares: number; filledPrice: number | null };
type LedgerRow = {
  paperTradeId: string | null;
  execution: { executedShares: number; executedPrice: number } | null;
};

function makeService(paper: PaperRow[], ledger: LedgerRow[]) {
  const alerts: Array<{ severity: string; source: string; message: string; meta?: Record<string, unknown> }> = [];
  const prisma = {
    paperTrade: { findMany: jest.fn(async () => paper) },
    orderRequest: { findMany: jest.fn(async () => ledger) },
  };
  const notifyProducer = {
    enqueueOpsAlert: jest.fn(
      async (severity: string, source: string, message: string, meta?: Record<string, unknown>) => {
        alerts.push({ severity, source, message, meta });
      },
    ),
  };
  const svc = new OrderLedgerReconcileService(prisma as never, notifyProducer as never);
  return { svc, alerts, notifyProducer };
}

const NOW = new Date('2026-07-04T11:00:00Z');

describe('OrderLedgerReconcileService.reconcileDay', () => {
  it('정합: 알림 없음, consistent 리포트', async () => {
    const { svc, alerts } = makeService(
      [{ id: 't1', filledShares: 10, filledPrice: 10_000 }],
      [{ paperTradeId: 't1', execution: { executedShares: 10, executedPrice: 10_000 } }],
    );
    const report = await svc.reconcileDay(NOW);
    expect(report.consistent).toBe(true);
    expect(report.countPaper).toBe(1);
    expect(alerts).toHaveLength(0);
  });

  it('불일치(orphan): OPS_ALERT(ERROR) + 멱등 dedupeKey', async () => {
    const { svc, alerts } = makeService(
      [
        { id: 't1', filledShares: 10, filledPrice: 10_000 },
        { id: 't2', filledShares: 5, filledPrice: 20_000 },
      ],
      [{ paperTradeId: 't1', execution: { executedShares: 10, executedPrice: 10_000 } }],
    );
    const report = await svc.reconcileDay(NOW);
    expect(report.consistent).toBe(false);
    expect(report.orphanPaperTradeIds).toContain('t2');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('ERROR');
    expect(alerts[0].source).toBe('order-ledger-reconcile');
    expect(alerts[0].meta?.dedupeKey).toBe(`order-ledger-reconcile:${report.tradeDate}`);
  });

  it('금액 불일치: filledPrice·executedPrice 차이 → 불일치·알림', async () => {
    const { svc, alerts } = makeService(
      [{ id: 't1', filledShares: 10, filledPrice: 10_000 }],
      [{ paperTradeId: 't1', execution: { executedShares: 10, executedPrice: 10_500 } }],
    );
    const report = await svc.reconcileDay(NOW);
    expect(report.consistent).toBe(false);
    expect(report.mismatches.some((m) => m.kind === 'AMOUNT')).toBe(true);
    expect(alerts).toHaveLength(1);
  });

  it('execution null 인 원장 행은 대조에서 제외(방어)', async () => {
    const { svc } = makeService(
      [{ id: 't1', filledShares: 10, filledPrice: 10_000 }],
      [
        { paperTradeId: 't1', execution: { executedShares: 10, executedPrice: 10_000 } },
        { paperTradeId: 't1', execution: null },
      ],
    );
    const report = await svc.reconcileDay(NOW);
    expect(report.consistent).toBe(true);
  });

  it('빈 창: 정합·무알림', async () => {
    const { svc, alerts } = makeService([], []);
    const report = await svc.reconcileDay(NOW);
    expect(report.consistent).toBe(true);
    expect(alerts).toHaveLength(0);
  });
});
