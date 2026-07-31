import { Injectable } from '@nestjs/common';
import { evaluateRules } from '@dart-notification/aos-rule-engine';

import { EvaluateAndRecordDecisionInput } from '../domain/decision-ledger.types';
import { RecordSignalDecisionService } from './record-signal-decision.service';

@Injectable()
export class EvaluateAndRecordDecisionService {
  constructor(private readonly recorder: RecordSignalDecisionService) {}

  async execute(input: EvaluateAndRecordDecisionInput) {
    const evaluation = evaluateRules(input.request, input.registry);
    return this.recorder.record({
      mode: input.mode,
      featureSnapshotId: input.featureSnapshotId,
      marketRegimeSnapshotId: input.marketRegimeSnapshotId,
      strategyVersionId: input.strategyVersionId,
      riskPolicyVersionId: input.riskPolicyVersionId,
      legacyTradingSignalId: input.legacyTradingSignalId,
      legacyScore: input.legacyScore,
      evaluatedAt: input.evaluatedAt,
      evaluation,
    });
  }
}
