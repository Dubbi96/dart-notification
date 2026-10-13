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
  riskPolicyVersionId: 'mobile-shadow-risk.v2',
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
  requireEditionPriceDate: true,
  failSafeOnInvalidInputs: true,
  requireCurrentKillSwitchState: true,
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
const OPERATING_PARAMETERS: JsonObject = {
  validInputs: true,
  activeSignal: true,
  controlClear: true,
};

export interface DeviceEvaluationContext {
  evaluatedAt: string;
  scope: 'CURRENT' | 'HISTORICAL';
  killSwitchState?: 'CLEAR' | 'ACTIVE' | 'UNKNOWN';
  hardRiskBlocked?: boolean;
}

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
  scope: 'CURRENT' | 'HISTORICAL';
  dataWarning?: string;
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
});

async function sha256(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

async function buildRules(): Promise<readonly VersionedRule[]> {
  const [priceHash, flagHash, entryHash, operatingHash] = await Promise.all([
    sha256(canonicalizeJson(RISK_PRICE_PARAMETERS)),
    sha256(canonicalizeJson(RISK_FLAG_PARAMETERS)),
    sha256(canonicalizeJson(ENTRY_PARAMETERS)),
    sha256(canonicalizeJson(OPERATING_PARAMETERS)),
  ]);
  return Object.freeze([
    {
      ruleKey: 'risk.operating-conditions',
      implementationKey: 'mobile.risk.operating-conditions.v2',
      category: 'RISK',
      priority: 0,
      enabled: true,
      weight: 0,
      parameterHash: operatingHash,
      parameters: OPERATING_PARAMETERS,
      requiredFeatures: ['validInputs', 'activeSignal', 'controlClear'],
      missingFeaturePolicy: 'BLOCK',
    },
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
  const required = signal.entryConditions.filter((condition) => condition.required === true);
  return required.length > 0 && required.every((condition) => condition.met === true);
}

function validTradeDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(date);
}

function isoTimestamp(value: string): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !validTradeDate(value.slice(0, 10).replace(/-/g, ''))
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function inputWarning(signal: TradingSignal, editionDate: string): string | undefined {
  const reference = signal.referencePrice;
  if (!reference || !Number.isFinite(reference.closePrice) || reference.closePrice <= 0) {
    return '유효한 기준 종가가 없어 가격 계획을 중단했어요.';
  }
  if (reference.source !== 'STOCK_DAILY_PRICE') return '기준 가격의 출처를 확인할 수 없어요.';
  if (!validTradeDate(editionDate) || !validTradeDate(reference.tradeDate)) {
    return '가격 또는 에디션의 거래일이 올바르지 않아요.';
  }
  if (reference.tradeDate !== editionDate) {
    return '에디션 거래일과 가격 기준일이 달라 과거 가격으로 진입 계획을 만들지 않았어요.';
  }
  if (!Number.isFinite(signal.buyScore) || signal.buyScore < 0 || signal.buyScore > 100) {
    return '점수 데이터가 허용 범위를 벗어났어요.';
  }
  if (!['STRONG_BUY', 'BUY', 'WATCH', 'NEUTRAL', 'AVOID', 'BLOCKED'].includes(signal.grade)) {
    return '신호 등급이 올바르지 않아요.';
  }
  if (
    !isoTimestamp(signal.createdAt) ||
    (signal.expiresAt !== undefined && !isoTimestamp(signal.expiresAt))
  ) {
    return '신호의 생성·만료 시각을 확인할 수 없어요.';
  }
  if (
    !Array.isArray(signal.riskFlags) ||
    signal.riskFlags.some(
      (flag) =>
        !flag ||
        typeof flag.id !== 'string' ||
        typeof flag.label !== 'string' ||
        !['high', 'medium', 'low'].includes(flag.severity),
    )
  ) {
    return '리스크 정보가 불완전해 판단을 중단했어요.';
  }
  if (
    !Array.isArray(signal.entryConditions) ||
    signal.entryConditions.some(
      (condition) =>
        !condition ||
        typeof condition.required !== 'boolean' ||
        typeof condition.met !== 'boolean' ||
        typeof condition.label !== 'string',
    )
  ) {
    return '진입 조건 정보가 불완전해 판단을 중단했어요.';
  }
  return undefined;
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

function classify(
  signal: TradingSignal,
  evaluation: CanonicalRuleEvaluation,
  dataWarning?: string,
): DevicePlanTone {
  if (dataWarning) return 'DATA_UNAVAILABLE';
  if (evaluation.receipt.status === 'BLOCKED') return 'RISK';
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
  if (tone === 'DATA_UNAVAILABLE') return '데이터 확인 전 대기';
  return '진입 조건 확인';
}

/** 서버 호출 없이 앱 프로세스에서 공용 evaluator를 실행한다. */
export async function evaluateSignalOnDevice(
  signal: TradingSignal,
  editionDate: string,
  context?: DeviceEvaluationContext,
): Promise<DeviceSignalDecision> {
  // 미전달은 과거 에디션 재현. 현재 주문 가능 여부나 실시간 통제 확인으로 해석하지 않는다.
  const scope = context?.scope ?? 'HISTORICAL';
  const evaluatedAt = isoTimestamp(context?.evaluatedAt ?? signal.createdAt);
  const createdAt = isoTimestamp(signal.createdAt);
  const expiresAt = signal.expiresAt ? isoTimestamp(signal.expiresAt) : null;
  const evaluatedKstDate = evaluatedAt
    ? new Date(Date.parse(evaluatedAt) + 9 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '')
    : null;
  const dataWarning =
    inputWarning(signal, editionDate) ??
    (!evaluatedAt ? '평가 시각을 확인할 수 없어요.' : undefined) ??
    (scope === 'CURRENT' && editionDate !== evaluatedKstDate
      ? '현재 평가는 오늘 에디션만 사용해요. 과거·미래 데이터로 신규 진입을 판단하지 않아요.'
      : undefined);
  const activeSignal =
    !!evaluatedAt &&
    !!createdAt &&
    createdAt <= evaluatedAt &&
    (!expiresAt || evaluatedAt < expiresAt);
  const controlClear =
    context?.hardRiskBlocked !== true &&
    context?.killSwitchState !== 'ACTIVE' &&
    (scope === 'HISTORICAL' || context?.killSwitchState === 'CLEAR');
  // 비정상 JSON 수치는 null로 정규화하여 영수증 생성 자체가 전체 에디션을 실패시키지 않게 한다.
  const values: JsonObject = {
    buyScore: Number.isFinite(signal.buyScore) ? signal.buyScore : null,
    grade: typeof signal.grade === 'string' ? signal.grade : 'UNKNOWN',
    entryReady: Array.isArray(signal.entryConditions) && !dataWarning && isEntryReady(signal),
    hardBlocked: signal.grade === 'BLOCKED',
    riskFlagCount: Array.isArray(signal.riskFlags) ? signal.riskFlags.length : null,
    referencePrice: Number.isFinite(signal.referencePrice?.closePrice)
      ? signal.referencePrice!.closePrice
      : null,
    referenceTradeDate: signal.referencePrice?.tradeDate ?? null,
    referenceSource: signal.referencePrice?.source ?? null,
    validInputs: !dataWarning,
    activeSignal,
    controlClear,
    evaluationScope: scope,
    evaluatedAt,
    expiresAt,
    killSwitchState: context?.killSwitchState ?? 'UNKNOWN',
    hardRiskBlocked: context?.hardRiskBlocked ?? false,
  };
  const [version, snapshotContentHash] = await Promise.all([
    versionArtifacts(),
    sha256(canonicalizeJson(values)),
  ]);
  const request: RuleEvaluationRequest = {
    receiptSchemaVersion: 'mobile-signal-decision.v2',
    evaluatorVersion: 'aos-rule-engine.0.1.0',
    evaluationKey: `${editionDate}:${signal.id}`,
    version: {
      strategyVersionId: DEVICE_SWING_RULE.strategyVersionId,
      strategyContentHash: version.strategyContentHash,
      riskPolicyVersionId: DEVICE_SWING_RULE.riskPolicyVersionId,
      riskPolicyContentHash: version.riskPolicyContentHash,
    },
    snapshot: {
      schemaVersion: 'mobile-edition-feature.v2',
      contentHash: snapshotContentHash,
      asOf: createdAt ?? '1970-01-01T00:00:00.000Z',
      subject: { market: 'KR_STOCK', assetKey: signal.ticker ?? signal.corpCode },
      values,
    },
    rules: version.rules,
  };
  const evaluation = evaluateRules(request, registry);
  const tone = classify(signal, evaluation, dataWarning);
  const pricePlan = tone === 'READY' ? createPricePlan(signal) : null;
  const firstRisk = Array.isArray(signal.riskFlags) ? signal.riskFlags[0]?.label : undefined;
  const firstUnmet = Array.isArray(signal.entryConditions)
    ? signal.entryConditions.find((condition) => condition?.required && !condition.met)?.label
    : undefined;
  const rationale =
    signal.summary ?? `매수점수 ${signal.buyScore}점과 필수 진입 조건, 리스크를 함께 평가했습니다.`;

  return {
    signalId: signal.id,
    tone,
    verdict: verdict(tone),
    rationale,
    primaryCondition:
      dataWarning ??
      (!activeSignal
        ? '신호가 만료되었거나 평가 시점 이후에 생성되었어요.'
        : !controlClear
          ? 'Kill Switch 또는 통제 상태를 확인하기 전에는 신규 진입을 평가하지 않아요.'
          : primaryCondition(signal)),
    invalidation:
      dataWarning ??
      (!controlClear ? '통제 차단 또는 상태 미확인' : undefined) ??
      firstRisk ??
      firstUnmet ??
      `필수 조건 이탈 또는 체결가 대비 ${Math.abs(DEVICE_SWING_RULE.stopLossPct)}% 하락`,
    pricePlan,
    evaluation,
    receiptHash: await sha256(evaluation.canonicalReceipt),
    calculatedAt: evaluatedAt ?? '1970-01-01T00:00:00.000Z',
    scope,
    dataWarning,
  };
}

export async function evaluateEditionOnDevice(
  signals: readonly TradingSignal[],
  editionDate: string,
  context?: DeviceEvaluationContext,
): Promise<DeviceEditionDecision> {
  const decisions = await Promise.all(
    signals.map((signal) => evaluateSignalOnDevice(signal, editionDate, context)),
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
      ? `${signals.length}개 후보 중 ${unavailableCount}개는 데이터 확인이 필요해 숫자 플랜을 만들지 않았어요.`
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

export interface DeviceShadowPositionInput {
  entryPrice: number;
  currentPrice: number;
  heldTradingDays: number;
  partialExitTaken: boolean;
  quoteAt: string;
  evaluatedAt: string;
  /** 호출자가 명시하는 테스트 정책. 운영 시세 freshness 정책으로 자동 승격하지 않는다. */
  maxQuoteAgeMs: number;
  killSwitchState: 'CLEAR' | 'ACTIVE' | 'UNKNOWN';
  hardRiskBlocked: boolean;
}

export interface DeviceShadowPositionDecision {
  action: 'HOLD' | 'REDUCE' | 'EXIT' | 'BLOCKED';
  reason: string;
  portionPct: number;
  mode: 'SHADOW';
  executionAllowed: false;
}

/** 보유 가상 포지션의 종료 조건만 재현한다. 주문·실계좌·백그라운드 실행 권한은 없다. */
export function evaluateShadowPosition(
  input: DeviceShadowPositionInput,
): DeviceShadowPositionDecision {
  const result = (
    action: DeviceShadowPositionDecision['action'],
    reason: string,
    portionPct = 0,
  ): DeviceShadowPositionDecision => ({
    action,
    reason,
    portionPct,
    mode: 'SHADOW',
    executionAllowed: false,
  });
  if (input.killSwitchState !== 'CLEAR' || input.hardRiskBlocked !== false) {
    return result('BLOCKED', '통제 차단 또는 상태 미확인');
  }
  const quoteAt = isoTimestamp(input.quoteAt);
  const evaluatedAt = isoTimestamp(input.evaluatedAt);
  const age = quoteAt && evaluatedAt ? Date.parse(evaluatedAt) - Date.parse(quoteAt) : NaN;
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    !Number.isFinite(input.maxQuoteAgeMs) ||
    input.maxQuoteAgeMs <= 0 ||
    age > input.maxQuoteAgeMs
  ) {
    return result('BLOCKED', '현재가 시각이 없거나 허용 시세 수명을 벗어났어요.');
  }
  if (
    !Number.isFinite(input.entryPrice) ||
    input.entryPrice <= 0 ||
    !Number.isFinite(input.currentPrice) ||
    input.currentPrice <= 0 ||
    !Number.isInteger(input.heldTradingDays) ||
    input.heldTradingDays < 0 ||
    typeof input.partialExitTaken !== 'boolean'
  ) {
    return result('BLOCKED', '포지션 입력을 확인할 수 없어요.');
  }
  if (input.currentPrice * 100 <= input.entryPrice * (100 + DEVICE_SWING_RULE.stopLossPct)) {
    return result('EXIT', '기존 Shadow 손절 조건 도달', 100);
  }
  if (input.heldTradingDays >= DEVICE_SWING_RULE.maxHoldDays) {
    return result('EXIT', '기존 Shadow 최대 보유 거래일 도달', 100);
  }
  if (
    !input.partialExitTaken &&
    input.currentPrice * 100 >= input.entryPrice * (100 + DEVICE_SWING_RULE.takeProfitPct)
  ) {
    return result('REDUCE', '기존 Shadow 1차 목표 조건 도달', DEVICE_SWING_RULE.partialExitPct);
  }
  return result('HOLD', '손절·목표·보유기간 종료 조건 미도달');
}

export interface DeviceRuleSelfCheckResult {
  passed: number;
  total: number;
  scope: 'SYNTHETIC_SAFETY';
  executionAllowed: false;
  cases: readonly {
    id: string;
    label: string;
    explanation: string;
    passed: boolean;
    expected: string;
    actual: string;
  }[];
}

/** 고정 합성 사례로 현재 기기의 Rule 분기만 검증한다. 수익률 검증이나 실거래 인증이 아니다. */
export async function runDeviceRuleSelfCheck(): Promise<DeviceRuleSelfCheckResult> {
  const fixture: TradingSignal = {
    id: 'synthetic-safety-case',
    corpCode: 'SYNTHETIC',
    corpName: '합성 검증 종목',
    grade: 'BUY',
    buyScore: 72,
    createdAt: '2026-07-31T10:00:00.000Z',
    expiresAt: '2026-08-01T10:00:00.000Z',
    entryConditions: [
      { id: 'synthetic-entry', label: '가상 필수 조건', required: true, met: true },
    ],
    riskFlags: [],
    referencePrice: {
      tradeDate: '20260731',
      closePrice: 10_000,
      highPrice: 10_100,
      lowPrice: 9_900,
      source: 'STOCK_DAILY_PRICE',
    },
  };
  const context: DeviceEvaluationContext = {
    evaluatedAt: '2026-07-31T10:01:00.000Z',
    scope: 'CURRENT',
    killSwitchState: 'CLEAR',
  };
  const entryCases: {
    id: string;
    label: string;
    explanation: string;
    expected: DevicePlanTone;
    signal?: Partial<TradingSignal>;
    context?: Partial<DeviceEvaluationContext>;
  }[] = [
    {
      id: 'entry-ready',
      label: '진입 조건 충족',
      explanation: '가격·필수 조건·통제 확인 후에만 표시용 계획을 만듭니다.',
      expected: 'READY',
    },
    {
      id: 'missing-price',
      label: '가격 누락',
      explanation: '기준 가격이 없으면 숫자 계획을 만들지 않습니다.',
      expected: 'DATA_UNAVAILABLE',
      signal: { referencePrice: null },
    },
    {
      id: 'stale-price',
      label: '오래된 기준 가격',
      explanation: '해당 에디션 거래일 이전 종가는 진입 근거로 쓰지 않습니다.',
      expected: 'DATA_UNAVAILABLE',
      signal: { referencePrice: { ...fixture.referencePrice!, tradeDate: '20260730' } },
    },
    {
      id: 'future-price',
      label: '미래 가격 차단',
      explanation: '평가 대상 거래일 이후 종가로 미래 정보를 참조하지 않습니다.',
      expected: 'DATA_UNAVAILABLE',
      signal: { referencePrice: { ...fixture.referencePrice!, tradeDate: '20260803' } },
    },
    {
      id: 'invalid-price',
      label: '비정상 가격',
      explanation: '무한대·숫자 오류는 데이터 오류로 차단합니다.',
      expected: 'DATA_UNAVAILABLE',
      signal: { referencePrice: { ...fixture.referencePrice!, closePrice: Infinity } },
    },
    {
      id: 'invalid-score',
      label: '비정상 점수',
      explanation: '0~100 범위 밖 점수는 AI 우수 점수로 오인하지 않습니다.',
      expected: 'DATA_UNAVAILABLE',
      signal: { buyScore: 101 },
    },
    {
      id: 'risk-flag',
      label: 'Hard Risk 우선',
      explanation: '최고 점수라도 위험 플래그를 우회하지 못합니다.',
      expected: 'RISK',
      signal: {
        buyScore: 100,
        riskFlags: [{ id: 'halt', label: '거래정지 가정', severity: 'high' }],
      },
    },
    {
      id: 'kill-active',
      label: 'Kill Switch 활성',
      explanation: '진입 조건을 충족해도 활성 통제가 우선합니다.',
      expected: 'RISK',
      context: { killSwitchState: 'ACTIVE' },
    },
    {
      id: 'kill-unknown',
      label: '통제 상태 미확인',
      explanation: '현재 평가에서 통제 응답이 없으면 안전 상태로 가정하지 않습니다.',
      expected: 'RISK',
      context: { killSwitchState: 'UNKNOWN' },
    },
    {
      id: 'hard-gate',
      label: '추가 Risk Gate',
      explanation: '상위 위험 차단 결과를 기기 점수가 덮어쓰지 않습니다.',
      expected: 'RISK',
      context: { hardRiskBlocked: true },
    },
    {
      id: 'expired',
      label: '신호 만료',
      explanation: '평가 시점에 만료된 신호의 신규 진입을 중단합니다.',
      expected: 'RISK',
      signal: { expiresAt: '2026-07-31T10:01:00.000Z' },
    },
    {
      id: 'future-signal',
      label: '미래 신호 차단',
      explanation: '평가 시점 이후 생성된 신호는 쓸 수 없습니다.',
      expected: 'RISK',
      context: { evaluatedAt: '2026-07-31T09:59:00.000Z' },
    },
    {
      id: 'ai-no-authority',
      label: 'AI 문구 권한 없음',
      explanation: 'AI 요약에 매수를 써도 미충족 Rule을 통과하지 못합니다.',
      expected: 'CHECK',
      signal: {
        buyScore: 100,
        summary: '즉시 매수하라는 합성 AI 문구',
        entryConditions: [
          { id: 'synthetic-entry', label: '필수 조건 미충족', required: true, met: false },
        ],
      },
    },
    {
      id: 'empty-conditions',
      label: '필수 조건 누락',
      explanation: '필수 조건이 하나도 없으면 진입 준비로 보지 않습니다.',
      expected: 'CHECK',
      signal: { entryConditions: [] },
    },
  ];
  const cases: DeviceRuleSelfCheckResult['cases'][number][] = await Promise.all(
    entryCases.map(async (test) => {
      const decision = await evaluateSignalOnDevice({ ...fixture, ...test.signal }, '20260731', {
        ...context,
        ...test.context,
      });
      return {
        id: test.id,
        label: test.label,
        explanation: test.explanation,
        expected: test.expected,
        actual: decision.tone,
        passed:
          decision.tone === test.expected &&
          (test.expected === 'READY'
            ? decision.pricePlan !== null
            : decision.pricePlan === null),
      };
    }),
  );
  const position: DeviceShadowPositionInput = {
    entryPrice: 10_000,
    currentPrice: 10_100,
    heldTradingDays: 2,
    partialExitTaken: false,
    quoteAt: '2026-07-31T10:00:00.000Z',
    evaluatedAt: '2026-07-31T10:00:01.000Z',
    maxQuoteAgeMs: 60_000,
    killSwitchState: 'CLEAR',
    hardRiskBlocked: false,
  };
  const exitCases: {
    id: string;
    label: string;
    explanation: string;
    expected: DeviceShadowPositionDecision['action'];
    expectedPortionPct: number;
    input: Partial<DeviceShadowPositionInput>;
  }[] = [
    {
      id: 'stop',
      label: '손절 조건',
      explanation: '기존 Shadow -5% 조건 도달 시 가상 전량 종료를 재현합니다.',
      expected: 'EXIT',
      expectedPortionPct: 100,
      input: { currentPrice: 9_500 },
    },
    {
      id: 'gap-stop',
      label: '갭 하락',
      explanation: '손절가 아래로 벌어진 가격에서도 종료 조건이며 손절가 체결을 가정하지 않습니다.',
      expected: 'EXIT',
      expectedPortionPct: 100,
      input: { currentPrice: 8_000 },
    },
    {
      id: 'target',
      label: '분할 목표',
      explanation: '기존 Shadow +10% 조건에서 1회 분할 종료를 재현합니다.',
      expected: 'REDUCE',
      expectedPortionPct: 50,
      input: { currentPrice: 11_000 },
    },
    {
      id: 'no-repeat',
      label: '분할 중복 방지',
      explanation: '이미 분할 종료한 가상 포지션에 같은 종료를 반복하지 않습니다.',
      expected: 'HOLD',
      expectedPortionPct: 0,
      input: { currentPrice: 11_000, partialExitTaken: true },
    },
    {
      id: 'hold-limit',
      label: '보유기간 종료',
      explanation: '달력일이 아닌 입력된 보유 거래일이 기존 5일 한도에 도달하면 종료합니다.',
      expected: 'EXIT',
      expectedPortionPct: 100,
      input: { heldTradingDays: 5 },
    },
    {
      id: 'hold',
      label: '조건 미도달 대기',
      explanation: '조건이 없으면 행동하지 않고 유지합니다.',
      expected: 'HOLD',
      expectedPortionPct: 0,
      input: {},
    },
    {
      id: 'stale-quote',
      label: '현재가 지연',
      explanation: '명시된 합성 시세 수명 60초를 넘으면 매도 판단도 차단합니다.',
      expected: 'BLOCKED',
      expectedPortionPct: 0,
      input: { evaluatedAt: '2026-07-31T10:01:01.000Z' },
    },
    {
      id: 'exit-kill',
      label: '종료 통제 차단',
      explanation: '이 검증의 FULL_HALT 가정은 매수·매도 양쪽을 차단합니다.',
      expected: 'BLOCKED',
      expectedPortionPct: 0,
      input: { currentPrice: 9_000, killSwitchState: 'ACTIVE' },
    },
  ];
  for (const test of exitCases) {
    const decision = evaluateShadowPosition({ ...position, ...test.input });
    cases.push({
      id: test.id,
      label: test.label,
      explanation: test.explanation,
      expected: `${test.expected}:${test.expectedPortionPct}%:SHADOW`,
      actual: `${decision.action}:${decision.portionPct}%:${decision.mode}`,
      passed:
        decision.action === test.expected &&
        decision.portionPct === test.expectedPortionPct &&
        decision.mode === 'SHADOW' &&
        decision.executionAllowed === false,
    });
  }
  return {
    passed: cases.filter((test) => test.passed).length,
    total: cases.length,
    scope: 'SYNTHETIC_SAFETY',
    executionAllowed: false,
    cases,
  };
}
