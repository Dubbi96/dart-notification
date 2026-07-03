// Engine5 — 주문 원장 대조(pure) (M11 견고화 W2·P22, DAR-498 §4)
//
// AI 금지영역: 정합 검사는 순수 산술. AI 개입 0.
//
// 일일 원장 대조: **PaperTrade(파생 상태)** 와 **OrderRequest/OrderExecution(섀도 원장)** 이 같은
//   체결 사건을 건수·수량·금액으로 일치시키는지 순수 함수로 판정한다. 두 계산은 독립 경로
//   (PaperTrade=fillPendingEntries, 원장=ExecutionPort)라, 어긋나면 훅 누락·원장 드리프트 등
//   실주문 계층(M11)의 잠재 결함을 조기에 표면화한다(불일치 → P02 OPS_ALERT).
//
// ★M12 승격: 실계좌 연동 후엔 '원장 vs 실계좌 대조'로 바뀐다(원장이 SSOT). 지금은 '원장 vs
//   PaperTrade(파생)'로, 원장 기록 경로가 M11 착수 전 상시 검증되게 둔다.

/** 대조 대상 — 창(window) 내 체결된 시스템 모의 PaperTrade(파생). */
export interface ReconcilePaperFill {
  paperTradeId: string;
  filledShares: number;
  /** 체결 금액(=filledPrice × filledShares, KRW). */
  amount: number;
}

/** 대조 대상 — 창 내 체결 확정된 섀도 원장(OrderRequest EXECUTED + OrderExecution). */
export interface ReconcileLedgerExec {
  paperTradeId: string | null;
  executedShares: number;
  /** 체결 금액(=executedPrice × executedShares, KRW). */
  amount: number;
}

export interface ReconcileInput {
  tradeDate: string; // YYYYMMDD (대조 창 라벨)
  paperFills: ReconcilePaperFill[];
  ledgerExecs: ReconcileLedgerExec[];
  /** 금액 정합 허용 오차(KRW·건당). 기본 1(호가·Decimal 반올림 흡수). */
  amountEpsilonPerTrade?: number;
}

export interface ReconcileMismatch {
  paperTradeId: string;
  kind: 'ORPHAN_PAPER' | 'GHOST_LEDGER' | 'SHARES' | 'AMOUNT';
  detail: string;
}

export interface ReconcileReport {
  tradeDate: string;
  consistent: boolean;
  countPaper: number;
  countLedger: number;
  sharesPaper: number;
  sharesLedger: number;
  amountPaper: number;
  amountLedger: number;
  /** 원장에 대응 체결이 없는 PaperTrade(체결됐으나 원장 미기록). */
  orphanPaperTradeIds: string[];
  /** PaperTrade 에 대응이 없는 원장 체결(원장에만 존재). */
  ghostPaperTradeIds: string[];
  mismatches: ReconcileMismatch[];
  /** 사람이 읽는 한 줄 요약(OPS_ALERT 본문). */
  summary: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * reconcileOrderLedger — PaperTrade(파생) vs 섀도 원장(EXECUTED)의 건수·수량·금액 정합 판정(순수).
 *   paperTradeId 로 1:1 매칭한 뒤 orphan/ghost/수량/금액 불일치를 수집한다.
 */
export function reconcileOrderLedger(input: ReconcileInput): ReconcileReport {
  const eps = input.amountEpsilonPerTrade ?? 1;
  const paperById = new Map<string, ReconcilePaperFill>();
  for (const p of input.paperFills) paperById.set(p.paperTradeId, p);

  // 원장은 paperTradeId 로 매핑(중복 방지 — 마지막 것으로 덮음, 실제론 1:1).
  const ledgerByPaperId = new Map<string, ReconcileLedgerExec>();
  const ghostPaperTradeIds: string[] = [];
  for (const l of input.ledgerExecs) {
    if (l.paperTradeId && paperById.has(l.paperTradeId)) {
      ledgerByPaperId.set(l.paperTradeId, l);
    } else {
      ghostPaperTradeIds.push(l.paperTradeId ?? '(null)');
    }
  }

  const mismatches: ReconcileMismatch[] = [];
  const orphanPaperTradeIds: string[] = [];

  for (const p of input.paperFills) {
    const l = ledgerByPaperId.get(p.paperTradeId);
    if (!l) {
      orphanPaperTradeIds.push(p.paperTradeId);
      mismatches.push({
        paperTradeId: p.paperTradeId,
        kind: 'ORPHAN_PAPER',
        detail: `PaperTrade 체결(${p.filledShares}주) 이나 섀도 원장 미기록`,
      });
      continue;
    }
    if (p.filledShares !== l.executedShares) {
      mismatches.push({
        paperTradeId: p.paperTradeId,
        kind: 'SHARES',
        detail: `수량 불일치 paper=${p.filledShares} ledger=${l.executedShares}`,
      });
    }
    if (Math.abs(round2(p.amount) - round2(l.amount)) > eps) {
      mismatches.push({
        paperTradeId: p.paperTradeId,
        kind: 'AMOUNT',
        detail: `금액 불일치 paper=${round2(p.amount)} ledger=${round2(l.amount)}`,
      });
    }
  }

  for (const g of ghostPaperTradeIds) {
    mismatches.push({
      paperTradeId: g,
      kind: 'GHOST_LEDGER',
      detail: '섀도 원장 체결이나 대응 PaperTrade 없음',
    });
  }

  const sharesPaper = input.paperFills.reduce((s, p) => s + p.filledShares, 0);
  const sharesLedger = input.ledgerExecs.reduce((s, l) => s + l.executedShares, 0);
  const amountPaper = round2(input.paperFills.reduce((s, p) => s + p.amount, 0));
  const amountLedger = round2(input.ledgerExecs.reduce((s, l) => s + l.amount, 0));
  const consistent = mismatches.length === 0;

  const summary = consistent
    ? `[원장대조 ${input.tradeDate}] 정합 OK — 체결 ${input.paperFills.length}건 · ${sharesPaper}주 · ${amountPaper.toLocaleString()}원`
    : `[원장대조 ${input.tradeDate}] 불일치 ${mismatches.length}건 감지 — ` +
      `건수 paper=${input.paperFills.length}/ledger=${input.ledgerExecs.length} · ` +
      `수량 paper=${sharesPaper}/ledger=${sharesLedger} · ` +
      `금액 paper=${amountPaper.toLocaleString()}/ledger=${amountLedger.toLocaleString()} · ` +
      `orphan=${orphanPaperTradeIds.length} ghost=${ghostPaperTradeIds.length}`;

  return {
    tradeDate: input.tradeDate,
    consistent,
    countPaper: input.paperFills.length,
    countLedger: input.ledgerExecs.length,
    sharesPaper,
    sharesLedger,
    amountPaper,
    amountLedger,
    orphanPaperTradeIds,
    ghostPaperTradeIds,
    mismatches,
    summary,
  };
}
