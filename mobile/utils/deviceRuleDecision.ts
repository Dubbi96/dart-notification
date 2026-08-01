import * as Crypto from 'expo-crypto';
import {
  canonicalizeJson,
  evaluateRules,
  type CanonicalRuleEvaluation,
  type JsonObject,
  type RuleEvaluationRequest,
  type RuleImplementationRegistry,
  type VersionedRule,
} from '@dart-notification/aos-rule-engine';

import type { TradingSignal } from '@app-types/signal.types';

/**
 * 앱에서 직접 실행하는 Shadow 단기 스윙 계획 v1.
 * 기존 short-momentum 정본(+10/-5/5거래일)을 사용하되 주문을 만들지 않는 표시 전용 Rule이다.
 */
export const DEVICE_SWING_RULE = Object.freeze({
  strategyVersionId: 'mobile-shadow-short-momentum.v1',
  riskPolicyVersionId: 'mobile-shadow-risk.v1',
  entryDiscountPct: 2,
  takeProfitPct: 10,
  stopLossPct: -5,
  partialExitPct: 50,
  maxHoldDays: 5,
});

const STRATEGY_CONFIG: JsonObject = {
  mode: 'SHADOW',
  scope: 'KR_STOCK_LONG_ONLY',
  horizonDays: [2, DEVICE_SWING_RULE.maxHoldDays],
  entry: { reference: 'LATEST_EOD_CLOSE', discountPct: DEVICE_SWING_RULE.entryDiscountPct },
  exit: {
    takeProfitPct: DEVICE_SWING_RULE.takeProfitPct,
    stopLossPct: DEVICE_SWING_RULE.stopLossPct,
    partialExitPct: DEVICE_SWING_RULE.partialExitPct,
  },
};

const RISK_CONFIG: JsonObject = {
  mode: 'SHADOW',
  failSafeOnMissingPrice: true,
  blockOnAnyRiskFlag: true,
  allowShort: false,
  allowLeverage: false,
};

const RISK_PRICE_PARAMETERS: JsonObject = { minimumPrice: 1 };
const RISK_FLAG_PARAMETERS: JsonObject = { maximumRiskFlagCount: 0 };
const ENTRY_PARAMETERS: JsonObject = {
  acceptedGrades: ['STRONG_BUY', 'BUY'],
  requireEntryReady: true,
};

export type DevicePlanTone = 'READY' | 'CHECK' | 'RISK' | 'DATA_UNAVAILABLE';

export interface DevicePricePlan {
  referencePrice: number;
  referenceTradeDate: string;
  entryLow: number;
  entryHigh: number;
  stopPrice: number;
  takeProfitPrice: number;
  takeProfitPct: number;
  stopLossPct: number;
  partialExitPct: number;
  maxHoldDays: number;
}

export interface DeviceSignalDecision {
  signalId: string;
  tone: DevicePlanTone;
  verdict: string;
  rationale: string;
  primaryCondition: string;
  invalidation: string;
  pricePlan: DevicePricePlan | null;
  evaluation: CanonicalRuleEvaluation;
  receiptHash: string;
  calculatedAt: string;
}

export interface DeviceEditionDecision {
  decisions: readonly DeviceSignalDecision[];
  readyCount: number;
  checkCount: number;
  riskCount: number;
  unavailableCount: number;
  headline: string;
  description: string;
}

const registry: RuleImplementationRegistry = Object.freeze({
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
});

async function sha256(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

async function buildRules(): Promise<readonly VersionedRule[]> {
  const [priceHash, flagHash, entryHash] = await Promise.all([
    sha256(canonicalizeJson(RISK_PRICE_PARAMETERS)),
    sha256(canonicalizeJson(RISK_FLAG_PARAMETERS)),
    sha256(canonicalizeJson(ENTRY_PARAMETERS)),
  ]);
  return Object.freeze([
    {
      ruleKey: 'risk.reference-price',
      implementationKey: 'mobile.risk.price-available.v1',
      category: 'RISK',
      priority: 10,
      enabled: true,
      weight: 0,
      parameterHash: priceHash,
      parameters: RISK_PRICE_PARAMETERS,
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
      parameterHash: flagHash,
      parameters: RISK_FLAG_PARAMETERS,
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
      parameterHash: entryHash,
      parameters: ENTRY_PARAMETERS,
      requiredFeatures: ['buyScore', 'entryReady', 'grade'],
      missingFeaturePolicy: 'ABSTAIN',
    },
  ] satisfies readonly VersionedRule[]);
}

let versionArtifactsPromise:
  | Promise<{
      rules: readonly VersionedRule[];
      strategyContentHash: string;
      riskPolicyContentHash: string;
    }>
  | undefined;

/** 한 앱 세션에서 불변인 version/rule hash는 한 번만 계산해 종목 수에 비례한 crypto 비용을 막는다. */
function versionArtifacts() {
  versionArtifactsPromise ??= Promise.all([
    buildRules(),
    sha256(canonicalizeJson(STRATEGY_CONFIG)),
    sha256(canonicalizeJson(RISK_CONFIG)),
  ]).then(([rules, strategyContentHash, riskPolicyContentHash]) => ({
    rules,
    strategyContentHash,
    riskPolicyContentHash,
  }));
  return versionArtifactsPromise;
}

function isEntryReady(signal: TradingSignal): boolean {
  const required = signal.entryConditions.filter((condition) => condition.required);
  return required.length > 0 && required.every((condition) => condition.met);
}

function roundDisplayPrice(value: number): number {
  const unit = value < 10_000 ? 10 : value < 100_000 ? 100 : 1_000;
  return Math.max(unit, Math.round(value / unit) * unit);
}

function primaryCondition(signal: TradingSignal): string {
  const unmet = signal.entryConditions.find((condition) => condition.required && !condition.met);
  if (unmet) return unmet.label;
  const met = signal.entryConditions.find((condition) => condition.required && condition.met);
  return met?.label ?? '상세 근거와 다음 거래일 가격 조건 확인';
}

function createPricePlan(signal: TradingSignal): DevicePricePlan | null {
  const reference = signal.referencePrice;
  if (!reference || reference.closePrice <= 0) return null;
  const entryHigh = roundDisplayPrice(reference.closePrice);
  return {
    referencePrice: reference.closePrice,
    referenceTradeDate: reference.tradeDate,
    entryLow: roundDisplayPrice(
      reference.closePrice * (1 - DEVICE_SWING_RULE.entryDiscountPct / 100),
    ),
    entryHigh,
    stopPrice: roundDisplayPrice(entryHigh * (1 + DEVICE_SWING_RULE.stopLossPct / 100)),
    takeProfitPrice: roundDisplayPrice(entryHigh * (1 + DEVICE_SWING_RULE.takeProfitPct / 100)),
    takeProfitPct: DEVICE_SWING_RULE.takeProfitPct,
    stopLossPct: DEVICE_SWING_RULE.stopLossPct,
    partialExitPct: DEVICE_SWING_RULE.partialExitPct,
    maxHoldDays: DEVICE_SWING_RULE.maxHoldDays,
  };
}

function classify(signal: TradingSignal, evaluation: CanonicalRuleEvaluation): DevicePlanTone {
  if (!signal.referencePrice) return 'DATA_UNAVAILABLE';
  if (signal.grade === 'BLOCKED' || signal.riskFlags.length > 0) return 'RISK';
  const entryTrace = evaluation.receipt.traces.find(
    (trace) => trace.ruleKey === 'entry.readiness-score',
  );
  return evaluation.receipt.status === 'COMPLETED' && entryTrace?.status === 'PASS'
    ? 'READY'
    : 'CHECK';
}

function verdict(tone: DevicePlanTone): string {
  if (tone === 'READY') return '조건부 진입 계획';
  if (tone === 'RISK') return '리스크 확인 전 대기';
  if (tone === 'DATA_UNAVAILABLE') return '가격 확인 전 대기';
  return '진입 조건 확인';
}

/** 서버 호출 없이 앱 프로세스에서 공용 evaluator를 실행한다. */
export async function evaluateSignalOnDevice(
  signal: TradingSignal,
  editionDate: string,
): Promise<DeviceSignalDecision> {
  const values: JsonObject = {
    buyScore: signal.buyScore,
    grade: signal.grade,
    entryReady: isEntryReady(signal),
    hardBlocked: signal.grade === 'BLOCKED',
    riskFlagCount: signal.riskFlags.length,
    referencePrice: signal.referencePrice?.closePrice ?? null,
    referenceTradeDate: signal.referencePrice?.tradeDate ?? null,
  };
  const [version, snapshotContentHash] = await Promise.all([
    versionArtifacts(),
    sha256(canonicalizeJson(values)),
  ]);
  const request: RuleEvaluationRequest = {
    receiptSchemaVersion: 'mobile-signal-decision.v1',
    evaluatorVersion: 'aos-rule-engine.0.1.0',
    evaluationKey: `${editionDate}:${signal.id}`,
    version: {
      strategyVersionId: DEVICE_SWING_RULE.strategyVersionId,
      strategyContentHash: version.strategyContentHash,
      riskPolicyVersionId: DEVICE_SWING_RULE.riskPolicyVersionId,
      riskPolicyContentHash: version.riskPolicyContentHash,
    },
    snapshot: {
      schemaVersion: 'mobile-edition-feature.v1',
      contentHash: snapshotContentHash,
      asOf: signal.createdAt,
      subject: { market: 'KR_STOCK', assetKey: signal.ticker ?? signal.corpCode },
      values,
    },
    rules: version.rules,
  };
  const evaluation = evaluateRules(request, registry);
  const tone = classify(signal, evaluation);
  const pricePlan = tone === 'READY' ? createPricePlan(signal) : null;
  const firstRisk = signal.riskFlags[0]?.label;
  const firstUnmet = signal.entryConditions.find(
    (condition) => condition.required && !condition.met,
  )?.label;
  const rationale =
    signal.summary ?? `매수점수 ${signal.buyScore}점과 필수 진입 조건, 리스크를 함께 평가했습니다.`;

  return {
    signalId: signal.id,
    tone,
    verdict: verdict(tone),
    rationale,
    primaryCondition: primaryCondition(signal),
    invalidation:
      firstRisk ??
      firstUnmet ??
      `필수 조건 이탈 또는 체결가 대비 ${Math.abs(DEVICE_SWING_RULE.stopLossPct)}% 하락`,
    pricePlan,
    evaluation,
    receiptHash: await sha256(evaluation.canonicalReceipt),
    calculatedAt: signal.createdAt,
  };
}

export async function evaluateEditionOnDevice(
  signals: readonly TradingSignal[],
  editionDate: string,
): Promise<DeviceEditionDecision> {
  const decisions = await Promise.all(
    signals.map((signal) => evaluateSignalOnDevice(signal, editionDate)),
  );
  const readyCount = decisions.filter((decision) => decision.tone === 'READY').length;
  const riskCount = decisions.filter((decision) => decision.tone === 'RISK').length;
  const unavailableCount = decisions.filter(
    (decision) => decision.tone === 'DATA_UNAVAILABLE',
  ).length;
  const checkCount = decisions.length - readyCount - riskCount - unavailableCount;
  const headline =
    readyCount > 0
      ? `${readyCount}개는 가격·조건을 함께 확인할 단계예요`
      : '지금은 신규 진입보다 확인과 대기가 우선이에요';
  const description =
    unavailableCount > 0
      ? `${signals.length}개 후보 중 ${unavailableCount}개는 기준 가격이 없어 숫자 플랜을 만들지 않았어요.`
      : `${signals.length}개 후보를 진입 조건과 리스크 Rule로 기기에서 다시 계산했어요.`;
  return Object.freeze({
    decisions: Object.freeze(decisions),
    readyCount,
    checkCount,
    riskCount,
    unavailableCount,
    headline,
    description,
  });
}
