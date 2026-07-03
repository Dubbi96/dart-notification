// Engine5 — RiskGuard 공용 진입 게이트 순수 함수 테스트 (DAR-496 · P19 드로다운 컷 DAR-497)
import {
  evaluateRiskGuardEntry,
  evaluateDrawdownCut,
  resolveRiskGuardMode,
  DEFAULT_RISK_GUARD_MODES,
  RISK_GUARD_DAILY_LOSS_MAX_PCT,
  RISK_GUARD_DRAWDOWN_CUT_MAX_PCT,
  RiskGuardDrawdownInput,
  RiskGuardEntryInput,
  RiskGuardTrack,
} from './risk-guard-gate';
import { GRADUATION_THRESHOLDS } from '../simulation/domain/graduation-gates';

const base = (over: Partial<RiskGuardEntryInput> = {}): RiskGuardEntryInput => ({
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
      const d = evaluateRiskGuardEntry(base({ mode: 'ENFORCE', dailyRealizedPnl: -300_000 }));
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
      const d = evaluateRiskGuardEntry(base({ totalCapital: 0, dailyRealizedPnl: -1_000_000 }));
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
      const d = evaluateRiskGuardEntry(base({ availableCash: 1_000_000, entryBudget: 1_000_000 }));
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

const ddBase = (over: Partial<RiskGuardDrawdownInput> = {}): RiskGuardDrawdownInput => ({
  track: 'dual-momentum-forward',
  mode: 'ENFORCE',
  highWaterMark: 10_000_000,
  currentEquity: 10_000_000,
  ...over,
});

describe('evaluateDrawdownCut (순수 드로다운 컷 게이트 — DAR-497 P19)', () => {
  it('상수 −15% 는 graduation-gates G6(MDD 한도)와 정합(frozen)', () => {
    // ★정합 봉인: 값 표류 시 이 회귀가 깨진다(§8.1 3게이트 없이 변경 금지).
    expect(RISK_GUARD_DRAWDOWN_CUT_MAX_PCT * 100).toBe(GRADUATION_THRESHOLDS.mddLimitPct);
    expect(RISK_GUARD_DRAWDOWN_CUT_MAX_PCT).toBe(-0.15);
  });

  it('고점 대비 −15% 초과 하락이면 DRAWDOWN_CUT (ENFORCE → BLOCK)', () => {
    // 고점 1000만 → 현재 840만 = −16% ≤ −15%
    const d = evaluateDrawdownCut(ddBase({ currentEquity: 8_400_000 }));
    expect(d.violations.map((v) => v.code)).toContain('DRAWDOWN_CUT');
    expect(d.action).toBe('BLOCK');
    expect(d.violations[0].details.drawdownPct).toBeCloseTo(-16, 5);
  });

  it('정확히 −15%(경계)는 위반(≤ 비교) → BLOCK', () => {
    const d = evaluateDrawdownCut(ddBase({ currentEquity: 8_500_000 }));
    expect(d.violations.map((v) => v.code)).toContain('DRAWDOWN_CUT');
    expect(d.action).toBe('BLOCK');
  });

  it('−15% 미만 하락(−14.9%)은 위반 아님 → ALLOW', () => {
    const d = evaluateDrawdownCut(ddBase({ currentEquity: 8_510_000 }));
    expect(d.violations).toHaveLength(0);
    expect(d.action).toBe('ALLOW');
  });

  it('신고점(현재 > 고점)은 드로다운 0 → ALLOW', () => {
    const d = evaluateDrawdownCut(ddBase({ currentEquity: 12_000_000 }));
    expect(d.action).toBe('ALLOW');
    expect(d.violations).toHaveLength(0);
  });

  it('고점 ≤ 0 이면 판정 스킵(드로다운 정의 불가)', () => {
    const d = evaluateDrawdownCut(ddBase({ highWaterMark: 0, currentEquity: -5 }));
    expect(d.violations).toHaveLength(0);
    expect(d.action).toBe('ALLOW');
  });

  it('★불변식: SHADOW 는 극단 드로다운(−90%)에도 절대 BLOCK 아님(SHADOW_VIOLATION)', () => {
    const d = evaluateDrawdownCut(
      ddBase({ track: 'paper-simulation', mode: 'SHADOW', currentEquity: 1_000_000 }),
    );
    expect(d.action).toBe('SHADOW_VIOLATION');
    expect(d.allowed).toBe(false);
    expect(d.violations.map((v) => v.code)).toContain('DRAWDOWN_CUT');
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
