// Engine5 — 주문 원장 대조(pure) 테스트 (DAR-498 §4)
import {
  reconcileOrderLedger,
  ReconcilePaperFill,
  ReconcileLedgerExec,
} from './order-ledger-reconcile';

const paper = (
  id: string,
  filledShares: number,
  amount: number,
): ReconcilePaperFill => ({ paperTradeId: id, filledShares, amount });

const ledger = (
  paperTradeId: string | null,
  executedShares: number,
  amount: number,
): ReconcileLedgerExec => ({ paperTradeId, executedShares, amount });

describe('reconcileOrderLedger', () => {
  it('완전 정합: 건수·수량·금액 일치 → consistent, 불일치 0', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000), paper('t2', 5, 50_000)],
      ledgerExecs: [ledger('t1', 10, 100_000), ledger('t2', 5, 50_000)],
    });
    expect(r.consistent).toBe(true);
    expect(r.mismatches).toHaveLength(0);
    expect(r.countPaper).toBe(2);
    expect(r.countLedger).toBe(2);
    expect(r.sharesPaper).toBe(15);
    expect(r.sharesLedger).toBe(15);
    expect(r.amountPaper).toBe(150_000);
    expect(r.summary).toContain('정합 OK');
  });

  it('orphan: 체결됐으나 원장 미기록 → ORPHAN_PAPER 불일치', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000), paper('t2', 5, 50_000)],
      ledgerExecs: [ledger('t1', 10, 100_000)],
    });
    expect(r.consistent).toBe(false);
    expect(r.orphanPaperTradeIds).toEqual(['t2']);
    expect(r.mismatches.some((m) => m.kind === 'ORPHAN_PAPER' && m.paperTradeId === 't2')).toBe(true);
    expect(r.summary).toContain('불일치');
  });

  it('ghost: 원장 체결이나 대응 PaperTrade 없음 → GHOST_LEDGER 불일치', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000)],
      ledgerExecs: [ledger('t1', 10, 100_000), ledger('t9', 3, 30_000)],
    });
    expect(r.consistent).toBe(false);
    expect(r.ghostPaperTradeIds).toEqual(['t9']);
    expect(r.mismatches.some((m) => m.kind === 'GHOST_LEDGER')).toBe(true);
  });

  it('수량 불일치: filledShares != executedShares → SHARES 불일치', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000)],
      ledgerExecs: [ledger('t1', 8, 100_000)],
    });
    expect(r.consistent).toBe(false);
    expect(r.mismatches.some((m) => m.kind === 'SHARES')).toBe(true);
  });

  it('금액 불일치: eps 초과 차이 → AMOUNT 불일치', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000)],
      ledgerExecs: [ledger('t1', 10, 100_050)], // 50원 차이 > eps(1)
    });
    expect(r.consistent).toBe(false);
    expect(r.mismatches.some((m) => m.kind === 'AMOUNT')).toBe(true);
  });

  it('금액 오차 eps 이내(반올림)는 정합', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000.4)],
      ledgerExecs: [ledger('t1', 10, 100_000)],
    });
    expect(r.consistent).toBe(true);
  });

  it('빈 창(체결 0): 정합 OK·무불일치', () => {
    const r = reconcileOrderLedger({ tradeDate: '20260704', paperFills: [], ledgerExecs: [] });
    expect(r.consistent).toBe(true);
    expect(r.countPaper).toBe(0);
    expect(r.summary).toContain('정합 OK');
  });

  it('null paperTradeId 원장은 ghost 로 분류(대응 불가)', () => {
    const r = reconcileOrderLedger({
      tradeDate: '20260704',
      paperFills: [paper('t1', 10, 100_000)],
      ledgerExecs: [ledger('t1', 10, 100_000), ledger(null, 1, 1_000)],
    });
    expect(r.consistent).toBe(false);
    expect(r.ghostPaperTradeIds).toContain('(null)');
  });
});
