// Engine5 — RiskGuard 공용 진입 게이트 순수 함수 테스트 (DAR-496)
import {
  evaluateRiskGuardEntry,
  resolveRiskGuardMode,
  DEFAULT_RISK_GUARD_MODES,
  RISK_GUARD_DAILY_LOSS_MAX_PCT,
  RiskGuardEntryInput,
  RiskGuardTrack,
} from './risk-guard-gate';

const base = (
  over: Partial<RiskGuardEntryInput> = {},
): RiskGuardEntryInput => ({
  track: 'paper-simulation',
  mode: 'SHADOW',
  totalCapital: 10_000_000,
  dailyRealizedPnl: 0,
  availableCash: 5_000_000,
  entryBudget: 1_000_000,
  ...over,
});

describe('evaluateRiskGuardEntry (순수 게이트)', () => {
  it('위반 없으면 ALLOW', () => {
    const d = evaluateRiskGuardEntry(base());
    expect(d.action).toBe('ALLOW');
    expect(d.allowed).toBe(true);
    expect(d.violations).toHaveLength(0);
  });

  describe('DAILY_LOSS 규칙', () => {
    it('당일 실현손익이 -2% 미만이면 위반', () => {
      // -2% 경계보다 더 큰 손실(-3%)
      const d = evaluateRiskGuardEntry(
        base({ mode: 'ENFORCE', dailyRealizedPnl: -300_000 }),
      );
      expect(d.violations.map((v) => v.code)).toContain('DAILY_LOSS');
      expect(d.action).toBe('BLOCK');
    });

    it('정확히 -2%(경계)는 위반 아님(< 비교)', () => {
      const d = evaluateRiskGuardEntry(
        base({ dailyRealizedPnl: RISK_GUARD_DAILY_LOSS_MAX_PCT * 10_000_000 }),
      );
      expect(d.violations.map((v) => v.code)).not.toContain('DAILY_LOSS');
    });

    it('totalCapital<=0 이면 손실 판정 스킵(0 나눗셈 방지)', () => {
      const d = evaluateRiskGuardEntry(
        base({ totalCapital: 0, dailyRealizedPnl: -1_000_000 }),
      );
      expect(d.violations.map((v) => v.code)).not.toContain('DAILY_LOSS');
    });
  });

  describe('CASH_GUARD 규칙', () => {
    it('진입예산이 가용현금을 초과하면 위반', () => {
      const d = evaluateRiskGuardEntry(
        base({ mode: 'ENFORCE', availableCash: 500_000, entryBudget: 1_000_000 }),
      );
      expect(d.violations.map((v) => v.code)).toContain('CASH_GUARD');
      expect(d.action).toBe('BLOCK');
    });

    it('진입예산 == 가용현금(경계)은 위반 아님(cashAfter=0)', () => {
      const d = evaluateRiskGuardEntry(
        base({ availableCash: 1_000_000, entryBudget: 1_000_000 }),
      );
      expect(d.violations.map((v) => v.code)).not.toContain('CASH_GUARD');
      expect(d.action).toBe('ALLOW');
    });
  });

  describe('★불변식: SHADOW 는 절대 BLOCK 하지 않는다', () => {
    it('SHADOW 모드에서 두 규칙 모두 위반이어도 SHADOW_VIOLATION(차단 아님)', () => {
      const d = evaluateRiskGuardEntry(
        base({
          mode: 'SHADOW',
          dailyRealizedPnl: -5_000_000,
          availableCash: 100,
          entryBudget: 9_999_999,
        }),
      );
      expect(d.action).toBe('SHADOW_VIOLATION');
      expect(d.allowed).toBe(false);
      expect(d.violations.length).toBeGreaterThanOrEqual(2);
    });

    it('ENFORCE 모드에서 동일 위반은 BLOCK', () => {
      const d = evaluateRiskGuardEntry(
        base({
          mode: 'ENFORCE',
          dailyRealizedPnl: -5_000_000,
          availableCash: 100,
          entryBudget: 9_999_999,
        }),
      );
      expect(d.action).toBe('BLOCK');
    });
  });
});

describe('resolveRiskGuardMode (모드 해석)', () => {
  const tracks: RiskGuardTrack[] = [
    'paper-simulation',
    'philosophy-style',
    'strategy-forward',
    'intraday-scalp',
    'dual-momentum-forward',
  ];

  it('기본값: 측정 트랙 SHADOW · 코어 forward ENFORCE (수용 기준)', () => {
    expect(resolveRiskGuardMode('paper-simulation', {})).toBe('SHADOW');
    expect(resolveRiskGuardMode('philosophy-style', {})).toBe('SHADOW');
    expect(resolveRiskGuardMode('strategy-forward', {})).toBe('SHADOW');
    expect(resolveRiskGuardMode('intraday-scalp', {})).toBe('SHADOW');
    expect(resolveRiskGuardMode('dual-momentum-forward', {})).toBe('ENFORCE');
  });

  it('DEFAULT_RISK_GUARD_MODES 와 일치', () => {
    for (const t of tracks) {
      expect(resolveRiskGuardMode(t, {})).toBe(DEFAULT_RISK_GUARD_MODES[t]);
    }
  });

  it('환경변수로 코드 변경 없이 ENFORCE 플립 가능', () => {
    const env = { RISK_GUARD_MODE_PAPER_SIMULATION: 'ENFORCE' };
    expect(resolveRiskGuardMode('paper-simulation', env)).toBe('ENFORCE');
  });

  it('환경변수로 SHADOW 강제도 가능(코어 → SHADOW)', () => {
    const env = { RISK_GUARD_MODE_DUAL_MOMENTUM_FORWARD: 'shadow' };
    expect(resolveRiskGuardMode('dual-momentum-forward', env)).toBe('SHADOW');
  });

  it('잘못된 값은 무시하고 기본값', () => {
    const env = { RISK_GUARD_MODE_PAPER_SIMULATION: 'garbage' };
    expect(resolveRiskGuardMode('paper-simulation', env)).toBe('SHADOW');
  });
});
