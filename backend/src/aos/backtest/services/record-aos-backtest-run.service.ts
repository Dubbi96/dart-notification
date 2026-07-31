import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { jsonSafe } from '../domain/versioned-backtest';
import { CanonicalAosBacktestRecord } from '../domain/versioned-backtest.types';

@Injectable()
export class RecordAosBacktestRunService {
  constructor(private readonly prisma: PrismaService) {}

  async record(record: CanonicalAosBacktestRecord) {
    return this.prisma.$transaction(async (tx) => {
      await tx.aosBacktestRun.createMany({
        data: [
          {
            replayKey: record.replayKey,
            runType: record.runType,
            strategyVersionId: record.strategyVersionId,
            riskPolicyVersionId: record.riskPolicyVersionId,
            datasetVersion: record.datasetVersion,
            datasetHash: record.datasetHash,
            evaluatorVersion: record.evaluatorVersion,
            startDate: new Date(`${record.startDate}T00:00:00.000Z`),
            endDate: new Date(`${record.endDate}T00:00:00.000Z`),
            initialCapital: record.initialCapital,
            strategyParamsJson: jsonSafe(record.strategy) as Prisma.InputJsonValue,
            costsJson: jsonSafe(record.costs) as Prisma.InputJsonValue,
            metricsJson: jsonSafe(record.metrics) as Prisma.InputJsonValue,
            sensitivityJson: {
              observations: jsonSafe(record.sensitivity),
            } as Prisma.InputJsonValue,
            acceptanceStatus: record.acceptanceStatus,
            receiptHash: record.receiptHash,
          },
        ],
        skipDuplicates: true,
      });
      const run = await tx.aosBacktestRun.findUniqueOrThrow({
        where: { replayKey: record.replayKey },
        select: { id: true },
      });
      await Promise.all([
        tx.aosBacktestWindow.createMany({
          data: record.windows.map((window) => ({
            backtestRunId: run.id,
            sequence: window.sequence,
            role: window.role,
            startDate: new Date(`${window.startDate}T00:00:00.000Z`),
            endDate: new Date(`${window.endDate}T00:00:00.000Z`),
            metricsJson: jsonSafe(window.metrics) as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        }),
        tx.aosBacktestTrade.createMany({
          data: record.trades.map((trade, sequence) => ({
            backtestRunId: run.id,
            signalDecisionId: trade.signalDecisionId,
            sequence,
            corpCode: trade.corpCode,
            stockCode: trade.stockCode,
            eventType: trade.eventType,
            persona: trade.persona,
            regimeKey: trade.regimeKey,
            entryDate: trade.entryDate,
            entryPrice: trade.entryPrice,
            entryShares: trade.entryShares,
            exitDate: trade.exitDate,
            exitPrice: trade.exitPrice,
            exitReason: trade.exitReason,
            grossPnl: trade.grossPnl,
            netPnl: trade.netPnl,
            returnPct: trade.returnPct,
            maePct: trade.maxAdverseExcursionPct,
            mfePct: trade.maxFavorableExcursionPct,
            holdDays: trade.holdDays,
            commission: trade.commission,
            tax: trade.tax,
            slippage: trade.slippage,
            ruleKeys: [...new Set(trade.passedRuleKeys ?? [])].sort(),
          })),
          skipDuplicates: true,
        }),
        tx.aosBacktestAttribution.createMany({
          data: record.attributions.map((attribution) => ({
            backtestRunId: run.id,
            dimension: attribution.dimension,
            key: attribution.key,
            metricsJson: attribution.metrics as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        }),
        tx.aosBacktestAcceptanceCriterion.createMany({
          data: record.acceptance.map((criterion) => ({
            backtestRunId: run.id,
            criterionKey: criterion.criterionKey,
            passed: criterion.passed,
            actualJson: criterion.actual as Prisma.InputJsonValue,
            thresholdJson: criterion.threshold as Prisma.InputJsonValue,
            evidenceHash: criterion.evidenceHash,
          })),
          skipDuplicates: true,
        }),
      ]);
      return Object.freeze({ id: run.id, ...record });
    });
  }
}
