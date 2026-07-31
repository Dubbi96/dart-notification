import { evaluateRules } from '@dart-notification/aos-rule-engine';

import { buildMarketRegimeSnapshot, buildSignalDecisionRecord } from './decision-ledger';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function evaluation(score = 42) {
  return evaluateRules(
    {
      receiptSchemaVersion: 'decision.v1',
      evaluatorVersion: 'aos-rule-engine.0.1.0',
      evaluationKey: '005930:20260801:GROWTH',
      version: {
        strategyVersionId: 'strategy-v1',
        strategyContentHash: HASH_A,
        riskPolicyVersionId: 'risk-v1',
        riskPolicyContentHash: HASH_B,
      },
      snapshot: {
        schemaVersion: 'feature.v1',
        contentHash: HASH_C,
        asOf: '2026-08-01T10:00:00.000Z',
        subject: { market: 'KR_STOCK', assetKey: '005930' },
        values: { close: 70000 },
      },
      rules: [
        {
          ruleKey: 'entry.score',
          implementationKey: 'test.score',
          category: 'ENTRY',
          priority: 10,
          enabled: true,
          weight: 1,
          parameterHash: HASH_A,
          parameters: {},
          requiredFeatures: ['close'],
          missingFeaturePolicy: 'BLOCK',
        },
      ],
    },
    {
      'test.score': () => ({
        status: 'PASS',
        scoreDelta: score,
        reasonCodes: ['TEST_PASS'],
        facts: { observed: true },
      }),
    },
  );
}

describe('AOS decision ledger domain', () => {
  it('동일 시장 입력은 동일 content hash를 만든다', () => {
    const input = {
      asOf: new Date('2026-08-01T10:00:00.000Z'),
      marketSessionDate: '20260801',
      schemaVersion: 'regime.v1',
      regimeKey: 'UNCLASSIFIED',
      confidence: null,
      facts: { kospiChange1d: null },
      sourceRefs: { index: '0001' },
      quality: { missing: ['kospiChange1d'] },
    } as const;

    expect(buildMarketRegimeSnapshot(input).contentHash).toBe(
      buildMarketRegimeSnapshot(input).contentHash,
    );
  });

  it('공유 evaluator receipt와 legacy 점수가 같으면 MATCH 원장을 만든다', () => {
    const first = buildSignalDecisionRecord({
      mode: 'LEGACY_PARITY',
      featureSnapshotId: 'feature-1',
      strategyVersionId: 'strategy-v1',
      riskPolicyVersionId: 'risk-v1',
      legacyTradingSignalId: 'signal-1',
      legacyScore: 42,
      evaluatedAt: new Date('2026-08-01T10:01:00.000Z'),
      evaluation: evaluation(),
    });
    const second = buildSignalDecisionRecord({
      mode: 'LEGACY_PARITY',
      featureSnapshotId: 'feature-1',
      strategyVersionId: 'strategy-v1',
      riskPolicyVersionId: 'risk-v1',
      legacyTradingSignalId: 'signal-1',
      legacyScore: 42,
      evaluatedAt: new Date('2026-08-01T10:01:00.000Z'),
      evaluation: evaluation(),
    });

    expect(first.parityStatus).toBe('MATCH');
    expect(first.scoreDelta).toBe(0);
    expect(first.receiptHash).toBe(second.receiptHash);
    expect(first.decisionKey).toBe(second.decisionKey);
    expect(first.traces).toHaveLength(1);
    expect(first.traces[0].traceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('receipt와 ledger의 pinned version 불일치를 거부한다', () => {
    expect(() =>
      buildSignalDecisionRecord({
        mode: 'SHADOW',
        featureSnapshotId: 'feature-1',
        strategyVersionId: 'different-version',
        riskPolicyVersionId: 'risk-v1',
        evaluatedAt: new Date('2026-08-01T10:01:00.000Z'),
        evaluation: evaluation(),
      }),
    ).toThrow('does not match');
  });
});
