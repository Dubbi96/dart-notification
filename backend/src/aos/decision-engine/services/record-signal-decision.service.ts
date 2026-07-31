import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { buildSignalDecisionRecord } from '../domain/decision-ledger';
import { SignalDecisionRecordInput } from '../domain/decision-ledger.types';

@Injectable()
export class RecordSignalDecisionService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: SignalDecisionRecordInput) {
    const record = buildSignalDecisionRecord(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.signalDecision.createMany({
        data: [
          {
            decisionKey: record.decisionKey,
            mode: record.mode,
            featureSnapshotId: record.featureSnapshotId,
            marketRegimeSnapshotId: record.marketRegimeSnapshotId,
            strategyVersionId: record.strategyVersionId,
            riskPolicyVersionId: record.riskPolicyVersionId,
            legacyTradingSignalId: record.legacyTradingSignalId,
            evaluatorVersion: record.evaluatorVersion,
            receiptSchemaVersion: record.receiptSchemaVersion,
            status: record.status,
            score: record.score,
            blockReasonCodes: [...record.blockReasonCodes],
            decisionJson: record.decisionJson as Prisma.InputJsonValue,
            receiptHash: record.receiptHash,
            legacyScore: record.legacyScore,
            scoreDelta: record.scoreDelta,
            parityStatus: record.parityStatus,
            evaluatedAt: new Date(record.evaluatedAt),
          },
        ],
        skipDuplicates: true,
      });
      const decision = await tx.signalDecision.findUniqueOrThrow({
        where: { decisionKey: record.decisionKey },
        select: { id: true },
      });
      await tx.ruleEvaluationTrace.createMany({
        data: record.traces.map((trace) => ({
          signalDecisionId: decision.id,
          executionOrder: trace.executionOrder,
          ruleKey: trace.ruleKey,
          implementationKey: trace.implementationKey,
          category: trace.category,
          priority: trace.priority,
          parameterHash: trace.parameterHash,
          status: trace.status,
          contribution: trace.contribution,
          reasonCodes: [...trace.reasonCodes],
          factsJson: trace.facts as Prisma.InputJsonValue,
          traceHash: trace.traceHash,
        })),
        skipDuplicates: true,
      });
      return Object.freeze({ id: decision.id, ...record });
    });
  }
}
