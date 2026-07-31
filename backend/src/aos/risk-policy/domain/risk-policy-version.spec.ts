import {
  assertRiskPolicyMutable,
  canTransitionRiskPolicyVersion,
  canonicalizeRiskPolicyLimits,
  hashRiskPolicyLimits,
  transitionRiskPolicyVersion,
  validateRiskPolicyLimits,
} from './risk-policy-version';
import {
  RISK_POLICY_VERSION_STATUSES,
  RiskPolicyLimits,
  RiskPolicyVersionDomainError,
  RiskPolicyVersionLifecycle,
  RiskPolicyVersionStatus,
} from './risk-policy-version.types';

const limits: RiskPolicyLimits = {
  schemaVersion: 1,
  singleBuyMaxPct: 0.03,
  singlePositionMaxPct: 0.1,
  dailyLossMaxPct: -0.02,
  weeklyLossMaxPct: -0.05,
  monthlyLossMaxPct: -0.1,
  maxDrawdownPct: -0.15,
  maxOpenOrders: 5,
  maxDailyTrades: 10,
  maxOpenPositions: 20,
  maxSectorPct: 0.3,
  minCashReservePct: 0.05,
  killSwitchMode: 'REDUCE_ONLY',
  constraints: {
    assetClass: 'KR_STOCK',
    direction: 'LONG_ONLY',
    allowShort: false,
    allowLeverage: false,
    autoCoverFromLongTermAssets: false,
  },
};

describe('risk policy limits', () => {
  it('returns a canonical typed object without choosing any default values', () => {
    expect(validateRiskPolicyLimits(limits)).toEqual(limits);
  });

  it('hashes the same limits identically regardless of input key insertion order', () => {
    const reordered = {
      constraints: {
        autoCoverFromLongTermAssets: false,
        allowLeverage: false,
        direction: 'LONG_ONLY',
        allowShort: false,
        assetClass: 'KR_STOCK',
      },
      killSwitchMode: 'REDUCE_ONLY',
      minCashReservePct: 0.05,
      maxSectorPct: 0.3,
      maxOpenPositions: 20,
      maxDailyTrades: 10,
      maxOpenOrders: 5,
      maxDrawdownPct: -0.15,
      monthlyLossMaxPct: -0.1,
      weeklyLossMaxPct: -0.05,
      dailyLossMaxPct: -0.02,
      singlePositionMaxPct: 0.1,
      singleBuyMaxPct: 0.03,
      schemaVersion: 1,
    };

    expect(canonicalizeRiskPolicyLimits(reordered)).toBe(canonicalizeRiskPolicyLimits(limits));
    expect(hashRiskPolicyLimits(reordered)).toBe(hashRiskPolicyLimits(limits));
    expect(hashRiskPolicyLimits(limits)).toHaveLength(64);
  });

  it.each([
    ['allowShort', { allowShort: true }],
    ['allowLeverage', { allowLeverage: true }],
    ['autoCoverFromLongTermAssets', { autoCoverFromLongTermAssets: true }],
    ['assetClass', { assetClass: 'US_STOCK' }],
    ['direction', { direction: 'LONG_SHORT' }],
  ])('rejects the unsafe capability %s', (_name, override) => {
    expect(() =>
      validateRiskPolicyLimits({
        ...limits,
        constraints: { ...limits.constraints, ...override },
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSAFE_RISK_POLICY_CAPABILITY' }));
  });

  it.each([
    ['singleBuyMaxPct', 0],
    ['singlePositionMaxPct', 1.1],
    ['dailyLossMaxPct', 0],
    ['weeklyLossMaxPct', -1.1],
    ['maxOpenOrders', 1.5],
    ['maxDailyTrades', 0],
    ['minCashReservePct', -0.1],
  ])('rejects an invalid numeric limit %s=%p', (key, value) => {
    expect(() => validateRiskPolicyLimits({ ...limits, [key]: value })).toThrow(
      expect.objectContaining({ code: 'INVALID_RISK_POLICY_LIMITS' }),
    );
  });

  it('rejects internally inconsistent position and loss ladders', () => {
    expect(() =>
      validateRiskPolicyLimits({
        ...limits,
        singleBuyMaxPct: 0.2,
        singlePositionMaxPct: 0.1,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RISK_POLICY_LIMITS' }));
    expect(() =>
      validateRiskPolicyLimits({
        ...limits,
        weeklyLossMaxPct: -0.01,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RISK_POLICY_LIMITS' }));
  });

  it('rejects missing and unknown keys so a hash always has one schema meaning', () => {
    const { maxDailyTrades: _omitted, ...missing } = limits;
    expect(() => validateRiskPolicyLimits(missing)).toThrow(RiskPolicyVersionDomainError);
    expect(() => validateRiskPolicyLimits({ ...limits, unexpectedLimit: 1 })).toThrow(
      RiskPolicyVersionDomainError,
    );
    expect(() =>
      validateRiskPolicyLimits({
        ...limits,
        constraints: { ...limits.constraints, unexpectedCapability: false },
      }),
    ).toThrow(RiskPolicyVersionDomainError);
  });

  it.each([null, [], new Date(), Number.NaN])('rejects a non-policy JSON value: %p', (value) => {
    expect(() => hashRiskPolicyLimits(value)).toThrow(RiskPolicyVersionDomainError);
  });
});

describe('risk policy version state machine', () => {
  const t0 = new Date('2026-07-31T07:00:00.000Z');
  const effectiveFrom = new Date('2026-08-03T10:00:00.000Z');
  const expectedTransitions: Record<RiskPolicyVersionStatus, readonly RiskPolicyVersionStatus[]> = {
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

  it('keeps the complete transition matrix closed by default', () => {
    for (const from of RISK_POLICY_VERSION_STATUSES) {
      for (const to of RISK_POLICY_VERSION_STATUSES) {
        expect(canTransitionRiskPolicyVersion(from, to)).toBe(
          expectedTransitions[from].includes(to),
        );
      }
    }
  });

  it('follows the full guarded lifecycle', () => {
    let policy: RiskPolicyVersionLifecycle = { status: 'DRAFT' };
    for (const target of ['VALIDATED', 'BACKTESTED', 'APPROVAL_PENDING', 'APPROVED'] as const) {
      policy = transitionRiskPolicyVersion({ current: policy, target, now: t0 });
    }
    policy = transitionRiskPolicyVersion({
      current: policy,
      target: 'SCHEDULED',
      now: t0,
      effectiveFrom,
    });
    policy = transitionRiskPolicyVersion({
      current: policy,
      target: 'ACTIVE',
      now: effectiveFrom,
    });
    expect(policy.status).toBe('ACTIVE');

    const retiredAt = new Date(effectiveFrom.getTime() + 1);
    policy = transitionRiskPolicyVersion({
      current: policy,
      target: 'RETIRED',
      now: retiredAt,
    });
    expect(policy).toMatchObject({ status: 'RETIRED', retiredAt });
  });

  it('allows limits mutation only in DRAFT', () => {
    expect(() => assertRiskPolicyMutable('DRAFT')).not.toThrow();
    expect(() => assertRiskPolicyMutable('VALIDATED')).toThrow(
      expect.objectContaining({ code: 'RISK_POLICY_NOT_MUTABLE' }),
    );
  });

  it('rejects skipped transitions and early activation', () => {
    expect(() =>
      transitionRiskPolicyVersion({
        current: { status: 'DRAFT' },
        target: 'ACTIVE',
        now: t0,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RISK_POLICY_TRANSITION' }));

    expect(() =>
      transitionRiskPolicyVersion({
        current: { status: 'SCHEDULED', effectiveFrom },
        target: 'ACTIVE',
        now: new Date(effectiveFrom.getTime() - 1),
      }),
    ).toThrow(expect.objectContaining({ code: 'RISK_POLICY_ACTIVATION_TOO_EARLY' }));
  });

  it('requires a future effectiveFrom for SCHEDULED', () => {
    expect(() =>
      transitionRiskPolicyVersion({
        current: { status: 'APPROVED' },
        target: 'SCHEDULED',
        now: t0,
      }),
    ).toThrow(expect.objectContaining({ code: 'RISK_POLICY_EFFECTIVE_FROM_REQUIRED' }));
    expect(() =>
      transitionRiskPolicyVersion({
        current: { status: 'APPROVED' },
        target: 'SCHEDULED',
        now: t0,
        effectiveFrom: t0,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RISK_POLICY_EFFECTIVE_FROM_NOT_FUTURE',
      }),
    );
  });

  it.each<RiskPolicyVersionStatus>(['SUPERSEDED', 'ROLLED_BACK', 'RETIRED'])(
    'keeps terminal status %s closed',
    (status) => {
      for (const target of RISK_POLICY_VERSION_STATUSES) {
        expect(canTransitionRiskPolicyVersion(status, target)).toBe(false);
      }
    },
  );
});
