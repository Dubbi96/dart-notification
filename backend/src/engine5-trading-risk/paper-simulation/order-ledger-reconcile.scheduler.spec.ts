// Engine5 — OrderLedgerReconcileScheduler 테스트 (DAR-498 §4)
import { OrderLedgerReconcileScheduler } from './order-ledger-reconcile.scheduler';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { ReconcileReport } from './order-ledger-reconcile';

const REPORT: ReconcileReport = {
  tradeDate: '20260704',
  consistent: true,
  countPaper: 3,
  countLedger: 3,
  sharesPaper: 30,
  sharesLedger: 30,
  amountPaper: 300_000,
  amountLedger: 300_000,
  orphanPaperTradeIds: [],
  ghostPaperTradeIds: [],
  mismatches: [],
  summary: 'ok',
};

function makeScheduler(reconcileImpl?: () => Promise<ReconcileReport>) {
  const reconcile = {
    reconcileDay: jest.fn(reconcileImpl ?? (async () => REPORT)),
  };
  const recorded: string[] = [];
  const recorder = {
    record: jest.fn(async (jobKey: string, fn: () => Promise<ReconcileReport>) => {
      recorded.push(jobKey);
      return fn();
    }),
  };
  const scheduler = new OrderLedgerReconcileScheduler(
    reconcile as never,
    recorder as never,
  );
  return { scheduler, reconcile, recorder, recorded };
}

describe('OrderLedgerReconcileScheduler.runDaily', () => {
  it('reconcileDay 위임 + CronRunRecorder 로 원장대조 잡키 기록', async () => {
    const { scheduler, reconcile, recorded } = makeScheduler();
    const r = await scheduler.runDaily(new Date('2026-07-04T11:45:00Z'));
    expect(reconcile.reconcileDay).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual([CRON_JOB_KEYS.ORDER_LEDGER_RECONCILE]);
    expect(r).toEqual(REPORT);
  });

  it('겹침 가드: 진행 중이면 두 번째 호출 스킵(null)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const { scheduler } = makeScheduler(async () => {
      await gate;
      return REPORT;
    });
    const first = scheduler.runDaily();
    const second = await scheduler.runDaily(); // 첫 실행 진행 중
    expect(second).toBeNull();
    release();
    await expect(first).resolves.toEqual(REPORT);
  });

  it('recorder 미주입: 그대로 실행(리포트 반환)', async () => {
    const reconcile = { reconcileDay: jest.fn(async () => REPORT) };
    const scheduler = new OrderLedgerReconcileScheduler(reconcile as never);
    const r = await scheduler.runDaily();
    expect(r).toEqual(REPORT);
  });

  it('reconcileDay throw: cron 유지 위해 흡수(null 반환)', async () => {
    const { scheduler } = makeScheduler(async () => {
      throw new Error('db down');
    });
    await expect(scheduler.runDaily()).resolves.toBeNull();
  });
});
