import {
  assertStrategyVersionMutable,
  canTransitionStrategyVersion,
  canonicalizeStrategyVersionConfig,
  hashStrategyVersionConfig,
  transitionStrategyVersion,
} from './strategy-version-state-machine';
import {
  STRATEGY_VERSION_STATUSES,
  StrategyVersionDomainError,
  StrategyVersionLifecycle,
  StrategyVersionStatus,
} from './strategy-version.types';

describe('strategy version state machine', () => {
  const t0 = new Date('2026-07-31T07:00:00.000Z');
  const effectiveFrom = new Date('2026-07-31T09:30:00.000Z');

  it('follows the guarded happy path through scheduled activation', () => {
    let version: StrategyVersionLifecycle = { status: 'DRAFT' };

    version = transitionStrategyVersion({
      current: version,
      target: 'VALIDATED',
      now: t0,
    });
    expect(version.validatedAt).toEqual(t0);

    version = transitionStrategyVersion({
      current: version,
      target: 'BACKTESTED',
      now: t0,
    });
    version = transitionStrategyVersion({
      current: version,
      target: 'APPROVAL_PENDING',
      now: t0,
    });
    version = transitionStrategyVersion({
      current: version,
      target: 'APPROVED',
      now: t0,
    });
    expect(version.approvedAt).toEqual(t0);

    version = transitionStrategyVersion({
      current: version,
      target: 'SCHEDULED',
      now: t0,
      effectiveFrom,
    });
    expect(version.effectiveFrom).toEqual(effectiveFrom);

    version = transitionStrategyVersion({
      current: version,
      target: 'ACTIVE',
      now: effectiveFrom,
    });
    expect(version.status).toBe('ACTIVE');
  });

  it('rejects a skipped lifecycle transition', () => {
    expect(() =>
      transitionStrategyVersion({
        current: { status: 'DRAFT' },
        target: 'ACTIVE',
        now: t0,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_STRATEGY_VERSION_TRANSITION',
      }),
    );
  });

  it('allows configuration mutation only while DRAFT', () => {
    expect(() => assertStrategyVersionMutable('DRAFT')).not.toThrow();
    expect(() => assertStrategyVersionMutable('VALIDATED')).toThrow(
      expect.objectContaining({ code: 'STRATEGY_VERSION_NOT_MUTABLE' }),
    );
  });

  it('requires a future effectiveFrom before scheduling', () => {
    const approved: StrategyVersionLifecycle = {
      status: 'APPROVED',
      approvedAt: t0,
    };

    expect(() =>
      transitionStrategyVersion({
        current: approved,
        target: 'SCHEDULED',
        now: t0,
      }),
    ).toThrow(expect.objectContaining({ code: 'EFFECTIVE_FROM_REQUIRED' }));

    expect(() =>
      transitionStrategyVersion({
        current: approved,
        target: 'SCHEDULED',
        now: t0,
        effectiveFrom: t0,
      }),
    ).toThrow(expect.objectContaining({ code: 'EFFECTIVE_FROM_NOT_FUTURE' }));
  });

  it('does not activate a scheduled version early', () => {
    expect(() =>
      transitionStrategyVersion({
        current: { status: 'SCHEDULED', effectiveFrom },
        target: 'ACTIVE',
        now: new Date(effectiveFrom.getTime() - 1),
      }),
    ).toThrow(expect.objectContaining({ code: 'ACTIVATION_TOO_EARLY' }));
  });

  it.each<StrategyVersionStatus>(['SUPERSEDED', 'ROLLED_BACK', 'RETIRED'])(
    'keeps terminal status %s closed',
    (status) => {
      for (const target of STRATEGY_VERSION_STATUSES) {
        expect(canTransitionStrategyVersion(status, target)).toBe(false);
      }
    },
  );

  it('returns a clean lifecycle when a rejected version is revised', () => {
    expect(
      transitionStrategyVersion({
        current: {
          status: 'REJECTED',
          validatedAt: t0,
          approvedAt: t0,
          effectiveFrom,
        },
        target: 'DRAFT',
        now: t0,
      }),
    ).toEqual({
      status: 'DRAFT',
      validatedAt: null,
      approvedAt: null,
      effectiveFrom: null,
      retiredAt: null,
    });
  });
});

describe('strategy version config hash', () => {
  it('is stable regardless of object key insertion order', () => {
    const first = {
      universe: { market: 'KOSPI', minVolume: 100_000 },
      rules: [{ key: 'breakout', weight: 0.5 }],
    };
    const second = {
      rules: [{ weight: 0.5, key: 'breakout' }],
      universe: { minVolume: 100_000, market: 'KOSPI' },
    };

    expect(canonicalizeStrategyVersionConfig(first)).toBe(
      canonicalizeStrategyVersionConfig(second),
    );
    expect(hashStrategyVersionConfig(first)).toBe(hashStrategyVersionConfig(second));
    expect(hashStrategyVersionConfig(first)).toHaveLength(64);
  });

  it('preserves array order and changes the hash when configuration changes', () => {
    expect(hashStrategyVersionConfig(['ENTRY', 'EXIT'])).not.toBe(
      hashStrategyVersionConfig(['EXIT', 'ENTRY']),
    );
    expect(hashStrategyVersionConfig({ threshold: 0.7 })).not.toBe(
      hashStrategyVersionConfig({ threshold: 0.8 }),
    );
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date('2026-07-31T00:00:00.000Z'),
    { value: undefined },
  ])('rejects a non-JSON config value: %p', (value) => {
    expect(() => hashStrategyVersionConfig(value)).toThrow(StrategyVersionDomainError);
  });

  it('rejects cyclic configuration', () => {
    const config: Record<string, unknown> = {};
    config.self = config;

    expect(() => hashStrategyVersionConfig(config)).toThrow(
      expect.objectContaining({ code: 'INVALID_STRATEGY_CONFIG' }),
    );
  });

  it('rejects sparse arrays instead of hashing them as dense JSON', () => {
    expect(() => hashStrategyVersionConfig(new Array(1))).toThrow(
      expect.objectContaining({ code: 'INVALID_STRATEGY_CONFIG' }),
    );
  });
});
