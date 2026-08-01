import { createHash } from 'crypto';

import {
  canonicalizeJson,
  evaluateRules,
  JsonObject,
  RuleImplementationRegistry,
  VersionedRule,
} from '@dart-notification/aos-rule-engine';

/**
 * Android/Jest의 동일 fixture receipt와 byte parity를 고정한다.
 * 모바일 정책/fixture가 바뀌면 양쪽 expected가 함께 바뀌어야 하므로 플랫폼 drift를 숨길 수 없다.
 */
describe('AOS mobile/server Shadow receipt parity', () => {
  it('동일 version·snapshot·rule이면 Node와 디바이스가 같은 receipt hash를 만든다', () => {
    const strategyConfig: JsonObject = {
      mode: 'SHADOW',
      scope: 'KR_STOCK_LONG_ONLY',
      horizonDays: [2, 5],
      entry: { reference: 'LATEST_EOD_CLOSE', discountPct: 2 },
      exit: { takeProfitPct: 10, stopLossPct: -5, partialExitPct: 50 },
    };
    const riskConfig: JsonObject = {
      mode: 'SHADOW',
      failSafeOnMissingPrice: true,
      blockOnAnyRiskFlag: true,
      allowShort: false,
      allowLeverage: false,
    };
    const values: JsonObject = {
      buyScore: 72,
      grade: 'BUY',
      entryReady: true,
      hardBlocked: false,
      riskFlagCount: 0,
      referencePrice: 71_000,
      referenceTradeDate: '20260731',
    };
    const priceParameters: JsonObject = { minimumPrice: 1 };
    const flagParameters: JsonObject = { maximumRiskFlagCount: 0 };
    const entryParameters: JsonObject = {
      acceptedGrades: ['STRONG_BUY', 'BUY'],
      requireEntryReady: true,
    };
    const rules: readonly VersionedRule[] = [
      {
        ruleKey: 'risk.reference-price',
        implementationKey: 'mobile.risk.price-available.v1',
        category: 'RISK',
        priority: 10,
        enabled: true,
        weight: 0,
        parameterHash: hash(priceParameters),
        parameters: priceParameters,
        requiredFeatures: ['referencePrice'],
        missingFeaturePolicy: 'BLOCK',
      },
      {
        ruleKey: 'risk.signal-flags',
        implementationKey: 'mobile.risk.signal-flags.v1',
        category: 'RISK',
        priority: 20,
        enabled: true,
        weight: 0,
        parameterHash: hash(flagParameters),
        parameters: flagParameters,
        requiredFeatures: ['hardBlocked', 'riskFlagCount'],
        missingFeaturePolicy: 'BLOCK',
      },
      {
        ruleKey: 'entry.readiness-score',
        implementationKey: 'mobile.entry.readiness-score.v1',
        category: 'ENTRY',
        priority: 30,
        enabled: true,
        weight: 1,
        parameterHash: hash(entryParameters),
        parameters: entryParameters,
        requiredFeatures: ['buyScore', 'entryReady', 'grade'],
        missingFeaturePolicy: 'ABSTAIN',
      },
    ];
    const registry: RuleImplementationRegistry = {
      'mobile.risk.price-available.v1': ({ snapshot }) => {
        const price = snapshot.values.referencePrice;
        const pass = typeof price === 'number' && Number.isFinite(price) && price > 0;
        return {
          status: pass ? 'PASS' : 'FAIL',
          scoreDelta: 0,
          reasonCodes: [pass ? 'REFERENCE_PRICE_AVAILABLE' : 'REFERENCE_PRICE_INVALID'],
          facts: { referencePrice: typeof price === 'number' ? price : null },
        };
      },
      'mobile.risk.signal-flags.v1': ({ snapshot }) => {
        const hardBlocked = snapshot.values.hardBlocked === true;
        const riskFlagCount =
          typeof snapshot.values.riskFlagCount === 'number' ? snapshot.values.riskFlagCount : 0;
        const pass = !hardBlocked && riskFlagCount === 0;
        return {
          status: pass ? 'PASS' : 'FAIL',
          scoreDelta: 0,
          reasonCodes: [pass ? 'SIGNAL_RISK_CLEAR' : 'SIGNAL_RISK_REVIEW_REQUIRED'],
          facts: { hardBlocked, riskFlagCount },
        };
      },
      'mobile.entry.readiness-score.v1': ({ snapshot }) => {
        const score = snapshot.values.buyScore;
        const grade = snapshot.values.grade;
        const ready = snapshot.values.entryReady === true;
        const acceptedGrade = grade === 'STRONG_BUY' || grade === 'BUY';
        return {
          status: ready && acceptedGrade ? 'PASS' : 'ABSTAIN',
          scoreDelta: typeof score === 'number' ? score : 0,
          reasonCodes: [
            ready && acceptedGrade ? 'ENTRY_CONDITIONS_READY' : 'ENTRY_CONDITIONS_NOT_READY',
          ],
          facts: { acceptedGrade, entryReady: ready },
        };
      },
    };

    const evaluation = evaluateRules(
      {
        receiptSchemaVersion: 'mobile-signal-decision.v1',
        evaluatorVersion: 'aos-rule-engine.0.1.0',
        evaluationKey: '20260731:signal-1',
        version: {
          strategyVersionId: 'mobile-shadow-short-momentum.v1',
          strategyContentHash: hash(strategyConfig),
          riskPolicyVersionId: 'mobile-shadow-risk.v1',
          riskPolicyContentHash: hash(riskConfig),
        },
        snapshot: {
          schemaVersion: 'mobile-edition-feature.v1',
          contentHash: hash(values),
          asOf: '2026-07-31T10:00:00.000Z',
          subject: { market: 'KR_STOCK', assetKey: '005930' },
          values,
        },
        rules,
      },
      registry,
    );

    expect(hashCanonical(evaluation.canonicalReceipt)).toBe(
      'f813e900e799e5a4e3431d0233a818c5373fe7166181ad09cfababfb592add69',
    );
  });
});

function hash(value: JsonObject): string {
  return hashCanonical(canonicalizeJson(value));
}

function hashCanonical(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
