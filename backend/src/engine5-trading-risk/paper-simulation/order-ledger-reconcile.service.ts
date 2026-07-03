// Engine5 — OrderLedgerReconcileService: 일일 원장 대조 (M11 견고화 W2·P22, DAR-498 §4)
//
// AI 금지영역: 정합 검사는 순수 산술(order-ledger-reconcile.ts). 알림·조회만 담당. AI 개입 0.
//
// 장마감 후 하루 1회: 시스템 모의 체결(PaperTrade 파생) 과 섀도 원장(OrderRequest/OrderExecution)
//   을 같은 KST 거래일 창에서 건수·수량·금액 대조하고, 불일치 시 P02 OPS_ALERT 를 발행한다.
//   ★read-only 관측·알림 전용 — 매매/원장 무접점(M10 클록 보호). 실패해도 매매 흐름 무영향.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { formatKstDateCompact, kstDayStart } from '../../common/time/kst';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import { PaperSimulationService } from './paper-simulation.service';
import { SHADOW_LEDGER_KEY_PREFIX } from '../services/order-shadow-ledger.service';
import {
  ReconcileLedgerExec,
  ReconcilePaperFill,
  ReconcileReport,
  reconcileOrderLedger,
} from './order-ledger-reconcile';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OrderLedgerReconcileService {
  private readonly logger = new Logger(OrderLedgerReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional — 큐 미주입(단위 테스트)에서도 안전. 불일치 통지용.
    @Optional() private readonly notifyProducer?: NotificationProducerService,
  ) {}

  /**
   * reconcileDay — 주어진 시각(now)의 KST 거래일 체결을 대조하고 리포트를 반환한다.
   *   불일치면 OPS_ALERT(멱등 dedupeKey=원장대조:<거래일>) 발행. 정합이면 알림 없음(무소음).
   */
  async reconcileDay(now: Date = new Date()): Promise<ReconcileReport> {
    const dayStart = kstDayStart(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const tradeDate = formatKstDateCompact(now);

    // 파생: 창 내 체결된 시스템 모의 BUY(FILLED/PARTIAL). filledAt 기준(체결 시각).
    const paperRows = await this.prisma.paperTrade.findMany({
      where: {
        styleTag: PaperSimulationService.TRADE_STRATEGY_KEY,
        direction: 'BUY',
        status: { in: ['FILLED', 'PARTIAL'] },
        filledAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, filledShares: true, filledPrice: true },
    });
    const paperFills: ReconcilePaperFill[] = paperRows.map((r) => {
      const price = r.filledPrice ? Number(r.filledPrice) : 0;
      return {
        paperTradeId: r.id,
        filledShares: r.filledShares,
        amount: price * r.filledShares,
      };
    });

    // 원장: 창 내 체결 확정된 섀도 OrderRequest(EXECUTED) + 연결 OrderExecution.
    const ledgerRows = await this.prisma.orderRequest.findMany({
      where: {
        idempotencyKey: { startsWith: SHADOW_LEDGER_KEY_PREFIX },
        status: 'EXECUTED',
        execution: { is: { executedAt: { gte: dayStart, lt: dayEnd } } },
      },
      select: {
        paperTradeId: true,
        execution: { select: { executedShares: true, executedPrice: true } },
      },
    });
    const ledgerExecs: ReconcileLedgerExec[] = ledgerRows
      .filter((r) => r.execution)
      .map((r) => {
        const shares = r.execution!.executedShares;
        const price = Number(r.execution!.executedPrice);
        return {
          paperTradeId: r.paperTradeId,
          executedShares: shares,
          amount: price * shares,
        };
      });

    const report = reconcileOrderLedger({ tradeDate, paperFills, ledgerExecs });

    if (report.consistent) {
      this.logger.log(report.summary);
    } else {
      this.logger.warn(report.summary);
      await this.alert(report);
    }
    return report;
  }

  /** 불일치 OPS_ALERT — 하루 1건 멱등(dedupeKey=거래일). 큐 미주입이면 no-op. */
  private async alert(report: ReconcileReport): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      await this.notifyProducer.enqueueOpsAlert(
        'ERROR',
        'order-ledger-reconcile',
        `${report.summary}. 상세: ${report.mismatches
          .slice(0, 5)
          .map((m) => `${m.kind}(${m.paperTradeId})`)
          .join(', ')}`,
        {
          dedupeKey: `order-ledger-reconcile:${report.tradeDate}`,
          deepLink: '/portfolio',
          data: {
            tradeDate: report.tradeDate,
            countPaper: report.countPaper,
            countLedger: report.countLedger,
            sharesPaper: report.sharesPaper,
            sharesLedger: report.sharesLedger,
            amountPaper: report.amountPaper,
            amountLedger: report.amountLedger,
            orphans: report.orphanPaperTradeIds.length,
            ghosts: report.ghostPaperTradeIds.length,
            mismatchCount: report.mismatches.length,
          },
        },
      );
    } catch (e) {
      this.logger.error(
        `[원장대조] OPS_ALERT 발행 실패(무시): ${(e as Error).message}`,
      );
    }
  }
}
