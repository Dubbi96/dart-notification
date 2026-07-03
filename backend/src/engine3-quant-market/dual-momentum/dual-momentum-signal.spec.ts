// DAR-492 — 듀얼모멘텀 코어 월말 리밸런싱 판정(순수 Rule) 결정론 검증.
// 검증 대상: 12개월 모멘텀·상대/절대 판정 분기(공격A/공격B/방어)·무행동 경로·결측 fail-safe·
//   frozen 룩백/유니버스 불변성·argmax 타이브레이크.

import {
  MomentumBar,
  computeMomentum,
  decideDualMomentumTarget,
  resolveRebalanceAction,
  decideMonthlyRebalance,
} from './dual-momentum-signal';
import {
  MOMENTUM_LOOKBACK_DAYS,
  MIN_MOMENTUM_BARS,
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
  CORE_STYLE_TAG,
  CORE_CAPITAL_ALLOCATION_PCT,
  DUAL_MOMENTUM_PRESET,
} from './dual-momentum.constants';
import { etfByRole } from '../market-data/etf-universe';

/**
 * 유효 일봉 배열 생성: 길이 len, index 0=과거 종가, index len-1=현재 종가, 나머지 유효 필러.
 * 기본 len=253(=MIN_MOMENTUM_BARS), 기본 lookback=252 → window 전체가 유효.
 */
function makeBars(pastClose: number, currentClose: number, len: number = MIN_MOMENTUM_BARS): MomentumBar[] {
  const bars: MomentumBar[] = [];
  for (let i = 0; i < len; i++) bars.push({ close: 1000 });
  bars[0] = { close: pastClose };
  bars[len - 1] = { close: currentClose };
  return bars;
}

// ---------------------------------------------------------------------------
// computeMomentum (12개월 수익률)
// ---------------------------------------------------------------------------
describe('computeMomentum', () => {
  it('현재/과거 − 1 수익률을 반환한다 (작은 룩백)', () => {
    // bars[2]=120, bars[0]=100, lookback=2 → 120/100 − 1 = 0.2
    expect(computeMomentum([{ close: 100 }, { close: 110 }, { close: 120 }], 2)).toBeCloseTo(0.2, 10);
  });

  it('음수 수익률도 정상 반환', () => {
    // bars[2]=80, bars[0]=100 → 0.8 − 1 = −0.2
    expect(computeMomentum([{ close: 100 }, { close: 90 }, { close: 80 }], 2)).toBeCloseTo(-0.2, 10);
  });

  it('기본 룩백 = 252 거래일 (253봉 정확히 충족)', () => {
    // 과거 100 → 현재 130, 253봉, 기본 lookback → 0.3
    expect(computeMomentum(makeBars(100, 130))).toBeCloseTo(0.3, 10);
  });

  it('이력 부족(253봉 미만) → null (fail-safe)', () => {
    // 252봉 = 룩백 252 요구 253봉 미달
    expect(computeMomentum(makeBars(100, 130, MIN_MOMENTUM_BARS - 1))).toBeNull();
  });

  it('정확히 최소 봉수(253) → 산출 성공', () => {
    expect(computeMomentum(makeBars(100, 110, MIN_MOMENTUM_BARS))).not.toBeNull();
  });

  it('window 안에 결측일(NaN close) → null', () => {
    const bars = makeBars(100, 130);
    bars[125] = { close: NaN }; // window(0..252) 내부 결측
    expect(computeMomentum(bars)).toBeNull();
  });

  it('window 안에 비양수(0/음수) close → null', () => {
    const bars = makeBars(100, 130);
    bars[10] = { close: 0 };
    expect(computeMomentum(bars)).toBeNull();
  });

  it('과거 종가(index 0) 결측 → null', () => {
    const bars = makeBars(100, 130);
    bars[0] = { close: -5 };
    expect(computeMomentum(bars)).toBeNull();
  });

  it('null/undefined bars → null', () => {
    expect(computeMomentum(null)).toBeNull();
    expect(computeMomentum(undefined)).toBeNull();
  });

  it('빈 배열 → null', () => {
    expect(computeMomentum([])).toBeNull();
  });

  it('lookback ≤ 0 또는 비정수 → null', () => {
    expect(computeMomentum([{ close: 100 }, { close: 110 }], 0)).toBeNull();
    expect(computeMomentum([{ close: 100 }, { close: 110 }], -1)).toBeNull();
    expect(computeMomentum([{ close: 100 }, { close: 110 }, { close: 120 }], 1.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decideDualMomentumTarget (상대 + 절대 모멘텀 판정)
// ---------------------------------------------------------------------------
describe('decideDualMomentumTarget', () => {
  it('공격A 최대 & > 단기채 → 해외 S&P500(360750)', () => {
    expect(decideDualMomentumTarget(0.3, 0.1, 0.05)).toBe(CORE_OFFENSE_INTL_CODE);
  });

  it('공격B 최대 & > 단기채 → KODEX200(069500)', () => {
    expect(decideDualMomentumTarget(0.1, 0.3, 0.05)).toBe(CORE_OFFENSE_DOMESTIC_CODE);
  });

  it('공격 모멘텀 ≤ 단기채(절대 모멘텀 미충족) → 방어 종합채권(273130)', () => {
    expect(decideDualMomentumTarget(0.05, 0.03, 0.1)).toBe(CORE_DEFENSE_BOND_CODE);
  });

  it('경계: max(A,B) == MomT → 방어(초과가 아니면 방어)', () => {
    // max=0.1, MomT=0.1 → 0.1 > 0.1 false → 방어
    expect(decideDualMomentumTarget(0.1, 0.05, 0.1)).toBe(CORE_DEFENSE_BOND_CODE);
  });

  it('전 자산 음수라도 상대적으로 단기채보다 나으면 공격 진입', () => {
    // momA=−0.05 > momT=−0.1 → 공격A
    expect(decideDualMomentumTarget(-0.05, -0.2, -0.1)).toBe(CORE_OFFENSE_INTL_CODE);
  });

  it('전 자산 음수 & 단기채가 가장 나음 → 방어', () => {
    expect(decideDualMomentumTarget(-0.2, -0.15, -0.05)).toBe(CORE_DEFENSE_BOND_CODE);
  });

  it('argmax 동점(A==B) & > 단기채 → 해외A 우선(frozen tiebreak)', () => {
    expect(decideDualMomentumTarget(0.2, 0.2, 0.1)).toBe(CORE_OFFENSE_INTL_CODE);
  });

  it('입력 중 하나라도 null → null (fail-safe)', () => {
    expect(decideDualMomentumTarget(null, 0.1, 0.05)).toBeNull();
    expect(decideDualMomentumTarget(0.1, null, 0.05)).toBeNull();
    expect(decideDualMomentumTarget(0.1, 0.2, null)).toBeNull();
  });

  it('비유한(NaN/Infinity) 입력 → null', () => {
    expect(decideDualMomentumTarget(NaN, 0.1, 0.05)).toBeNull();
    expect(decideDualMomentumTarget(0.1, Infinity, 0.05)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRebalanceAction (무행동 vs 교체)
// ---------------------------------------------------------------------------
describe('resolveRebalanceAction', () => {
  it('목표 == 현재 보유 → HOLD (리밸런싱 생략)', () => {
    expect(resolveRebalanceAction(CORE_OFFENSE_INTL_CODE, CORE_OFFENSE_INTL_CODE)).toBe('HOLD');
  });

  it('목표 != 현재 보유 → SWITCH', () => {
    expect(resolveRebalanceAction(CORE_OFFENSE_INTL_CODE, CORE_DEFENSE_BOND_CODE)).toBe('SWITCH');
  });

  it('무보유(null) & 목표 있음 → SWITCH (신규 진입)', () => {
    expect(resolveRebalanceAction(null, CORE_DEFENSE_BOND_CODE)).toBe('SWITCH');
  });
});

// ---------------------------------------------------------------------------
// decideMonthlyRebalance (통합 월말 판정)
// ---------------------------------------------------------------------------
describe('decideMonthlyRebalance', () => {
  it('공격A 승 & 무보유 → 목표 360750, SWITCH', () => {
    const d = decideMonthlyRebalance(
      makeBars(100, 130), // MomA=+0.3
      makeBars(100, 110), // MomB=+0.1
      makeBars(100, 102), // MomT=+0.02
      null,
    );
    expect(d.target).toBe(CORE_OFFENSE_INTL_CODE);
    expect(d.action).toBe('SWITCH');
    expect(d.suspended).toBe(false);
    expect(d.momentums.a).toBeCloseTo(0.3, 10);
    expect(d.detail).toContain('SWITCH');
  });

  it('목표 == 현재 보유 → HOLD (회전 최소화)', () => {
    const d = decideMonthlyRebalance(
      makeBars(100, 130), // MomA=+0.3 승 → 목표 360750
      makeBars(100, 110),
      makeBars(100, 102),
      CORE_OFFENSE_INTL_CODE, // 이미 360750 보유
    );
    expect(d.target).toBe(CORE_OFFENSE_INTL_CODE);
    expect(d.action).toBe('HOLD');
    expect(d.suspended).toBe(false);
    expect(d.detail).toContain('리밸런싱 생략');
  });

  it('절대 모멘텀 미충족(공격 ≤ 단기채) → 방어 273130 SWITCH', () => {
    const d = decideMonthlyRebalance(
      makeBars(100, 101), // MomA=+0.01
      makeBars(100, 100.5), // MomB=+0.005
      makeBars(100, 105), // MomT=+0.05 (최대)
      CORE_OFFENSE_INTL_CODE,
    );
    expect(d.target).toBe(CORE_DEFENSE_BOND_CODE);
    expect(d.action).toBe('SWITCH');
  });

  it('데이터 결측(이력 부족) → 판정 보류, 전월 포지션 유지(무주문)', () => {
    const d = decideMonthlyRebalance(
      makeBars(100, 130, MIN_MOMENTUM_BARS - 1), // 이력 부족
      makeBars(100, 110),
      makeBars(100, 102),
      CORE_OFFENSE_DOMESTIC_CODE, // 전월 보유
    );
    expect(d.target).toBeNull();
    expect(d.suspended).toBe(true);
    expect(d.action).toBe('HOLD'); // 무주문(전월 유지)
    expect(d.momentums.a).toBeNull();
    expect(d.detail).toContain('보류');
    expect(d.detail).toContain(CORE_OFFENSE_DOMESTIC_CODE); // 전월 포지션 명시
  });

  it('일부 자산 결측이라도 하나라도 null이면 전체 보류(fail-safe)', () => {
    const d = decideMonthlyRebalance(
      makeBars(100, 130),
      null, // B 결측
      makeBars(100, 102),
      null,
    );
    expect(d.suspended).toBe(true);
    expect(d.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// frozen 불변성 (§9.2: 룩백·유니버스·자본비율 a-priori frozen)
// ---------------------------------------------------------------------------
describe('frozen 상수 불변성', () => {
  it('MOMENTUM_LOOKBACK_DAYS = 252 (frozen)', () => {
    expect(MOMENTUM_LOOKBACK_DAYS).toBe(252);
  });

  it('MIN_MOMENTUM_BARS = 룩백 + 1 = 253', () => {
    expect(MIN_MOMENTUM_BARS).toBe(253);
  });

  it('코어 자본 배분 = 65% (frozen)', () => {
    expect(CORE_CAPITAL_ALLOCATION_PCT).toBe(0.65);
  });

  it('styleTag = alloc:dual-momentum (§9 placeholder 정합)', () => {
    expect(CORE_STYLE_TAG).toBe('alloc:dual-momentum');
  });

  it('프리셋이 상수를 그대로 참조', () => {
    expect(DUAL_MOMENTUM_PRESET.lookbackDays).toBe(MOMENTUM_LOOKBACK_DAYS);
    expect(DUAL_MOMENTUM_PRESET.capitalAllocationPct).toBe(CORE_CAPITAL_ALLOCATION_PCT);
    expect(DUAL_MOMENTUM_PRESET.styleTag).toBe(CORE_STYLE_TAG);
  });

  // 유니버스 드리프트 회귀 고정: 상수 코드가 etf-universe.ts 역할과 1:1 일치해야 함.
  it('유니버스 코드가 etf-universe.ts 역할과 일치(드리프트 방지)', () => {
    expect(CORE_OFFENSE_INTL_CODE).toBe(etfByRole('OFFENSE_INTL')?.code);
    expect(CORE_OFFENSE_DOMESTIC_CODE).toBe(etfByRole('OFFENSE_DOMESTIC')?.code);
    expect(CORE_ABS_MOMENTUM_FILTER_CODE).toBe(etfByRole('CASH_SHORT')?.code);
    expect(CORE_DEFENSE_BOND_CODE).toBe(etfByRole('DEFENSE_BOND')?.code);
  });
});
