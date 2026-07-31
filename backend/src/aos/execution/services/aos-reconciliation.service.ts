import { createHash } from 'crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { canonicalizeJson } from '@dart-notification/aos-rule-engine';

import { formatKstDateCompact, kstDayStart } from '../../../common/time/kst';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationProducerService } from '../../../notifications/notification-producer.service';
import { AOS_CANONICAL_PAPER_LEDGER_FLAG } from './canonical-paper-ledger.service';

const DAY_MS = 86_400_000;

@Injectable()
export class AosReconciliationService {
  private readonly logger = new Logger(AosReconciliationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationProducerService,
  ) {}

  async reconcileDay(now = new Date()) {
    const enabled = this.config.get<string | boolean>(AOS_CANONICAL_PAPER_LEDGER_FLAG, false);
    if (enabled !== true && enabled !== 'true') return [];
    const start = kstDayStart(now);
    const end = new Date(start.getTime() + DAY_MS);
    const tradeDate = formatKstDateCompact(now);
    const accounts = await this.prisma.aosTradingAccount.findMany({
      where: { accountType: 'SYSTEM_TRADING', status: 'ACTIVE' },
      select: { id: true },
    });
    return Promise.all(
      accounts.map((account) => this.reconcileAccount(account.id, tradeDate, start, end)),
    );
  }

  private async reconcileAccount(accountId: string, tradeDate: string, start: Date, end: Date) {
    const [paperRows, ledgerRows] = await Promise.all([
      this.prisma.paperTrade.findMany({
        where: {
          styleTag: 'paper-simulation',
          direction: 'BUY',
          status: { in: ['FILLED', 'PARTIAL'] },
          filledAt: { gte: start, lt: end },
        },
        select: { id: true, filledShares: true, filledPrice: true },
      }),
      this.prisma.aosOrder.findMany({
        where: {
          orderPlan: { tradingAccountId: accountId },
          fills: { some: { filledAt: { gte: start, lt: end } } },
        },
        select: {
          legacyPaperTradeId: true,
          fills: {
            where: { filledAt: { gte: start, lt: end } },
            select: { quantity: true, price: true },
          },
        },
      }),
    ]);
    const expected = Object.fromEntries(
      paperRows.map((row) => [
        row.id,
        { quantity: row.filledShares, amount: row.filledShares * Number(row.filledPrice ?? 0) },
      ]),
    );
    const actual = Object.fromEntries(
      ledgerRows
        .filter((row) => row.legacyPaperTradeId)
        .map((row) => [
          row.legacyPaperTradeId!,
          row.fills.reduce(
            (sum, fill) => ({
              quantity: sum.quantity + fill.quantity,
              amount: sum.amount + fill.quantity * Number(fill.price),
            }),
            { quantity: 0, amount: 0 },
          ),
        ]),
    );
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    const breaks = keys
      .filter(
        (key) =>
          !expected[key] ||
          !actual[key] ||
          expected[key].quantity !== actual[key].quantity ||
          Math.abs(expected[key].amount - actual[key].amount) > 1,
      )
      .map((key) => ({
        key,
        category: !expected[key] ? 'GHOST_LEDGER' : !actual[key] ? 'ORPHAN_PAPER' : 'FILL_MISMATCH',
        expected: expected[key] ?? {},
        actual: actual[key] ?? {},
      }));
    const payload = {
      schemaVersion: 'aos-reconciliation.v1',
      accountId,
      tradeDate,
      expected,
      actual,
      breaks,
    };
    const receiptHash = hash(payload);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.aosReconciliationRun.createMany({
        data: [
          {
            runKey: `aos-reconcile:${accountId}:${tradeDate}`,
            tradingAccountId: accountId,
            tradeDate,
            status: breaks.length === 0 ? 'MATCHED' : 'BROKEN',
            expectedJson: expected as Prisma.InputJsonValue,
            actualJson: actual as Prisma.InputJsonValue,
            unexplainedBreaks: breaks.length,
            receiptHash,
            completedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      const run = await tx.aosReconciliationRun.findUniqueOrThrow({
        where: { runKey: `aos-reconcile:${accountId}:${tradeDate}` },
        select: { id: true, status: true },
      });
      await tx.aosReconciliationBreak.createMany({
        data: breaks.map((item) => ({
          runId: run.id,
          breakKey: item.key,
          severity: 'ERROR',
          category: item.category,
          expectedJson: item.expected as Prisma.InputJsonValue,
          actualJson: item.actual as Prisma.InputJsonValue,
          evidenceHash: hash(item),
        })),
        skipDuplicates: true,
      });
      return run;
    });
    if (breaks.length > 0) {
      try {
        await this.notifications?.enqueueOpsAlert(
          'ERROR',
          'aos-reconciliation',
          `AOS 원장 불일치 ${breaks.length}건 — account=${accountId} tradeDate=${tradeDate}`,
          {
            dedupeKey: `aos-reconciliation:${accountId}:${tradeDate}`,
            deepLink: '/portfolio',
            data: { accountId, tradeDate, breaks: breaks.length, receiptHash },
          },
        );
      } catch (error) {
        this.logger.error(
          `[AOS:Reconciliation] OPS_ALERT 실패: ${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      }
    }
    return result;
  }
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(value as never))
    .digest('hex');
}
