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
  it.each([1, 2])(
    'v%s 동일 version·snapshot·rule이면 Node와 디바이스가 같은 receipt hash를 만든다',
    (version) => {
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
        ...(version === 2
          ? {
              requireEditionPriceDate: true,
              failSafeOnInvalidInputs: true,
              requireCurrentKillSwitchState: true,
            }
          : {}),
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
        ...(version === 2
          ? {
              referenceSource: 'STOCK_DAILY_PRICE',
              validInputs: true,
              activeSignal: true,
              controlClear: true,
              evaluationScope: 'HISTORICAL',
              evaluatedAt: '2026-07-31T10:00:00.000Z',
              expiresAt: null,
              killSwitchState: 'UNKNOWN',
              hardRiskBlocked: false,
            }
          : {}),
      };
      const priceParameters: JsonObject = { minimumPrice: 1 };
      const flagParameters: JsonObject = { maximumRiskFlagCount: 0 };
      const entryParameters: JsonObject = {
        acceptedGrades: ['STRONG_BUY', 'BUY'],
        requireEntryReady: true,
      };
      const operatingParameters: JsonObject = {
        validInputs: true,
        activeSignal: true,
        controlClear: true,
      };
      const rules: readonly VersionedRule[] = [
        ...(version === 2
          ? [
              {
                ruleKey: 'risk.operating-conditions',
                implementationKey: 'mobile.risk.operating-conditions.v2',
                category: 'RISK' as const,
                priority: 0,
                enabled: true,
                weight: 0,
                parameterHash: hash(operatingParameters),
                parameters: operatingParameters,
                requiredFeatures: ['validInputs', 'activeSignal', 'controlClear'],
                missingFeaturePolicy: 'BLOCK' as const,
              },
            ]
          : []),
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
        'mobile.risk.operating-conditions.v2': ({ snapshot }) => {
          const reasons = [
            snapshot.values.validInputs === true ? null : 'INPUT_DATA_INVALID',
            snapshot.values.activeSignal === true ? null : 'SIGNAL_EXPIRED_OR_FUTURE',
            snapshot.values.controlClear === true ? null : 'CONTROL_BLOCKED_OR_UNVERIFIED',
          ].filter((reason): reason is string => reason !== null);
          return {
            status: reasons.length === 0 ? 'PASS' : 'FAIL',
            scoreDelta: 0,
            reasonCodes: reasons.length === 0 ? ['OPERATING_CONDITIONS_CLEAR'] : reasons,
          };
        },
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
          receiptSchemaVersion: `mobile-signal-decision.v${version}`,
          evaluatorVersion: 'aos-rule-engine.0.1.0',
          evaluationKey: '20260731:signal-1',
          version: {
            strategyVersionId: 'mobile-shadow-short-momentum.v1',
            strategyContentHash: hash(strategyConfig),
            riskPolicyVersionId: `mobile-shadow-risk.v${version}`,
            riskPolicyContentHash: hash(riskConfig),
          },
          snapshot: {
            schemaVersion: `mobile-edition-feature.v${version}`,
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
        version === 1
          ? 'f813e900e799e5a4e3431d0233a818c5373fe7166181ad09cfababfb592add69'
          : '250ef5ecf554d38bf5f00c82cfc5e8e1186ef712f35941621303dec6c7c47a30',
      );
    },
  );
});

function hash(value: JsonObject): string {
  return hashCanonical(canonicalizeJson(value));
}

function hashCanonical(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
