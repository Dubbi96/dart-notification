import { evaluateRules } from '@dart-notification/aos-rule-engine';

import { RecordSignalDecisionService } from './record-signal-decision.service';

describe('RecordSignalDecisionService', () => {
  it('decision과 trace를 단일 transaction에서 append-only createMany로 기록한다', async () => {
    const signalDecision = {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'decision-1' }),
    };
    const ruleEvaluationTrace = {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) =>
        callback({ signalDecision, ruleEvaluationTrace }),
      ),
    } as any;
    const service = new RecordSignalDecisionService(prisma);
    const evaluation = evaluateRules(
      {
        receiptSchemaVersion: 'decision.v1',
        evaluatorVersion: 'evaluator.v1',
        evaluationKey: 'decision-record-test',
        version: {
          strategyVersionId: 'strategy-v1',
          strategyContentHash: 'a'.repeat(64),
          riskPolicyVersionId: 'risk-v1',
          riskPolicyContentHash: 'b'.repeat(64),
        },
        snapshot: {
          schemaVersion: 'feature.v1',
          contentHash: 'c'.repeat(64),
          asOf: '2026-08-01T10:00:00.000Z',
          subject: { market: 'KR_STOCK', assetKey: '005930' },
          values: { available: true },
        },
        rules: [
          {
            ruleKey: 'risk.test',
            implementationKey: 'risk.test',
            category: 'RISK',
            priority: 1,
            enabled: true,
            weight: 0,
            parameterHash: 'd'.repeat(64),
            parameters: {},
            requiredFeatures: ['available'],
            missingFeaturePolicy: 'BLOCK',
          },
        ],
      },
      {
        'risk.test': () => ({ status: 'PASS', scoreDelta: 0, reasonCodes: ['SAFE'] }),
      },
    );

    const result = await service.record({
      mode: 'SHADOW',
      featureSnapshotId: 'feature-1',
      strategyVersionId: 'strategy-v1',
      riskPolicyVersionId: 'risk-v1',
      evaluatedAt: new Date('2026-08-01T10:02:00.000Z'),
      evaluation,
    });

    expect(result.id).toBe('decision-1');
    expect(signalDecision.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(ruleEvaluationTrace.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect((signalDecision as any).update).toBeUndefined();
    expect((ruleEvaluationTrace as any).delete).toBeUndefined();
  });
});
