import { createHash } from 'crypto';

import {
  RiskPolicyLimits,
  RiskPolicyVersionDomainError,
  RiskPolicyVersionLifecycle,
  RiskPolicyVersionStatus,
  RiskPolicyVersionTransition,
} from './risk-policy-version.types';

const ALLOWED_TRANSITIONS: Readonly<
  Record<RiskPolicyVersionStatus, readonly RiskPolicyVersionStatus[]>
> = {
  DRAFT: ['VALIDATED'],
  VALIDATED: ['DRAFT', 'BACKTESTED'],
  BACKTESTED: ['DRAFT', 'APPROVAL_PENDING'],
  APPROVAL_PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['SCHEDULED'],
  SCHEDULED: ['APPROVED', 'ACTIVE'],
  ACTIVE: ['SUPERSEDED', 'ROLLED_BACK', 'RETIRED'],
  REJECTED: ['DRAFT'],
  SUPERSEDED: [],
  ROLLED_BACK: [],
  RETIRED: [],
};

const ROOT_KEYS = [
  'schemaVersion',
  'singleBuyMaxPct',
  'singlePositionMaxPct',
  'dailyLossMaxPct',
  'weeklyLossMaxPct',
  'monthlyLossMaxPct',
  'maxDrawdownPct',
  'maxOpenOrders',
  'maxDailyTrades',
  'maxOpenPositions',
  'maxSectorPct',
  'minCashReservePct',
  'killSwitchMode',
  'constraints',
] as const;

const CONSTRAINT_KEYS = [
  'assetClass',
  'direction',
  'allowShort',
  'allowLeverage',
  'autoCoverFromLongTermAssets',
] as const;

export function assertRiskPolicyMutable(status: RiskPolicyVersionStatus): void {
  if (status !== 'DRAFT') {
    throw new RiskPolicyVersionDomainError(
      'RISK_POLICY_NOT_MUTABLE',
      `Risk policy limits are immutable in ${status}.`,
    );
  }
}

export function canTransitionRiskPolicyVersion(
  from: RiskPolicyVersionStatus,
  to: RiskPolicyVersionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionRiskPolicyVersion({
  current,
  target,
  now = new Date(),
  effectiveFrom,
}: RiskPolicyVersionTransition): RiskPolicyVersionLifecycle {
  if (!canTransitionRiskPolicyVersion(current.status, target)) {
    throw new RiskPolicyVersionDomainError(
      'INVALID_RISK_POLICY_TRANSITION',
      `Risk policy cannot transition from ${current.status} to ${target}.`,
    );
  }

  const next: RiskPolicyVersionLifecycle = { ...current, status: target };
  if (target === 'DRAFT') {
    return {
      status: 'DRAFT',
      validatedAt: null,
      approvedAt: null,
      effectiveFrom: null,
      retiredAt: null,
    };
  }
  if (target === 'VALIDATED') {
    return { ...next, validatedAt: now };
  }
  if (target === 'APPROVED') {
    return {
      ...next,
      approvedAt: current.approvedAt ?? now,
      effectiveFrom: null,
    };
  }
  if (target === 'SCHEDULED') {
    if (!effectiveFrom) {
      throw new RiskPolicyVersionDomainError(
        'RISK_POLICY_EFFECTIVE_FROM_REQUIRED',
        'A scheduled risk policy requires effectiveFrom.',
      );
    }
    if (effectiveFrom.getTime() <= now.getTime()) {
      throw new RiskPolicyVersionDomainError(
        'RISK_POLICY_EFFECTIVE_FROM_NOT_FUTURE',
        'Risk policy effectiveFrom must be in the future.',
      );
    }
    return { ...next, effectiveFrom };
  }
  if (target === 'ACTIVE') {
    if (!current.effectiveFrom || now.getTime() < current.effectiveFrom.getTime()) {
      throw new RiskPolicyVersionDomainError(
        'RISK_POLICY_ACTIVATION_TOO_EARLY',
        'A scheduled risk policy cannot activate before effectiveFrom.',
      );
    }
  }
  if (target === 'SUPERSEDED' || target === 'ROLLED_BACK' || target === 'RETIRED') {
    return { ...next, retiredAt: now };
  }
  return next;
}

/**
 * 실제 숫자를 정하지 않고 저장 계약만 검증한다. 반환 객체는 키 순서가 고정된 canonical form이다.
 */
export function validateRiskPolicyLimits(value: unknown): RiskPolicyLimits {
  const root = assertExactObject(value, '$', ROOT_KEYS);
  const constraints = assertExactObject(root.constraints, '$.constraints', CONSTRAINT_KEYS);

  if (constraints.assetClass !== 'KR_STOCK' || constraints.direction !== 'LONG_ONLY') {
    throw unsafe('Only KR_STOCK LONG_ONLY risk policies are allowed.');
  }
  if (
    constraints.allowShort !== false ||
    constraints.allowLeverage !== false ||
    constraints.autoCoverFromLongTermAssets !== false
  ) {
    throw unsafe(
      'Short selling, leverage, and automatic loss coverage from long-term assets are forbidden.',
    );
  }

  const schemaVersion = positiveInteger(root.schemaVersion, '$.schemaVersion');
  const singleBuyMaxPct = ratio(root.singleBuyMaxPct, '$.singleBuyMaxPct', false);
  const singlePositionMaxPct = ratio(root.singlePositionMaxPct, '$.singlePositionMaxPct', false);
  const maxSectorPct = ratio(root.maxSectorPct, '$.maxSectorPct', false);
  const minCashReservePct = ratio(root.minCashReservePct, '$.minCashReservePct', true);
  const dailyLossMaxPct = negativeRatio(root.dailyLossMaxPct, '$.dailyLossMaxPct');
  const weeklyLossMaxPct = negativeRatio(root.weeklyLossMaxPct, '$.weeklyLossMaxPct');
  const monthlyLossMaxPct = negativeRatio(root.monthlyLossMaxPct, '$.monthlyLossMaxPct');
  const maxDrawdownPct = negativeRatio(root.maxDrawdownPct, '$.maxDrawdownPct');

  if (singleBuyMaxPct > singlePositionMaxPct) {
    throw invalid('$.singleBuyMaxPct', 'must not exceed singlePositionMaxPct');
  }
  if (singlePositionMaxPct > maxSectorPct) {
    throw invalid('$.singlePositionMaxPct', 'must not exceed maxSectorPct');
  }
  if (weeklyLossMaxPct > dailyLossMaxPct) {
    throw invalid('$.weeklyLossMaxPct', 'must be equal to or below dailyLossMaxPct');
  }
  if (monthlyLossMaxPct > weeklyLossMaxPct) {
    throw invalid('$.monthlyLossMaxPct', 'must be equal to or below weeklyLossMaxPct');
  }
  if (maxDrawdownPct > monthlyLossMaxPct) {
    throw invalid('$.maxDrawdownPct', 'must be equal to or below monthlyLossMaxPct');
  }

  if (root.killSwitchMode !== 'REDUCE_ONLY' && root.killSwitchMode !== 'FULL_HALT') {
    throw invalid('$.killSwitchMode', 'must be REDUCE_ONLY or FULL_HALT');
  }

  return {
    schemaVersion,
    singleBuyMaxPct,
    singlePositionMaxPct,
    dailyLossMaxPct,
    weeklyLossMaxPct,
    monthlyLossMaxPct,
    maxDrawdownPct,
    maxOpenOrders: positiveInteger(root.maxOpenOrders, '$.maxOpenOrders'),
    maxDailyTrades: positiveInteger(root.maxDailyTrades, '$.maxDailyTrades'),
    maxOpenPositions: positiveInteger(root.maxOpenPositions, '$.maxOpenPositions'),
    maxSectorPct,
    minCashReservePct,
    killSwitchMode: root.killSwitchMode,
    constraints: {
      assetClass: 'KR_STOCK',
      direction: 'LONG_ONLY',
      allowShort: false,
      allowLeverage: false,
      autoCoverFromLongTermAssets: false,
    },
  };
}

export function canonicalizeRiskPolicyLimits(value: unknown): string {
  return JSON.stringify(validateRiskPolicyLimits(value));
}

export function hashRiskPolicyLimits(value: unknown): string {
  return createHash('sha256').update(canonicalizeRiskPolicyLimits(value)).digest('hex');
}

function assertExactObject<const T extends readonly string[]>(
  value: unknown,
  path: string,
  expectedKeys: T,
): Record<T[number], unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalid(path, 'must be a plain object');
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw invalid(path, `must contain exactly: ${expectedKeys.join(', ')}`);
  }
  return value as Record<T[number], unknown>;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid(path, 'must be a positive safe integer');
  }
  return value;
}

function ratio(value: unknown, path: string, allowZero: boolean): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value > 1 ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw invalid(
      path,
      allowZero ? 'must be between 0 and 1' : 'must be greater than 0 and at most 1',
    );
  }
  return value;
}

function negativeRatio(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value >= 0) {
    throw invalid(path, 'must be at least -1 and below 0');
  }
  return value;
}

function invalid(path: string, reason: string): RiskPolicyVersionDomainError {
  return new RiskPolicyVersionDomainError(
    'INVALID_RISK_POLICY_LIMITS',
    `Invalid risk policy limits at ${path}: ${reason}.`,
  );
}

function unsafe(message: string): RiskPolicyVersionDomainError {
  return new RiskPolicyVersionDomainError('UNSAFE_RISK_POLICY_CAPABILITY', message);
}
