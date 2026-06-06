// 위험조정 공통 산식 단위 스펙 (DAR-68)
// MDD·Sharpe 의 단일 출처 — engine3 백테스트·engine5 졸업게이트가 공유한다.

import {
  calcMaxDrawdownPct,
  calcSharpeRatio,
  toPeriodReturns,
  DAILY_ANNUALIZATION_FACTOR,
} from './risk-metrics';

describe('calcMaxDrawdownPct', () => {
  it('빈 배열·단일 점이면 낙폭 0', () => {
    expect(calcMaxDrawdownPct([])).toBe(0);
    expect(calcMaxDrawdownPct([100])).toBe(0);
  });

  it('상승만 하면 낙폭 0', () => {
    expect(calcMaxDrawdownPct([100, 110, 120])).toBe(0);
  });

  it('고점 대비 최대 하락폭(%)을 음수로 반환', () => {
    // 고점 120 → 저점 90 : (90-120)/120 = -25%
    expect(calcMaxDrawdownPct([100, 120, 90, 110])).toBeCloseTo(-25, 5);
  });

  it('여러 골 중 가장 깊은 낙폭을 택한다', () => {
    // 100→95(-5%), 회복 후 200→150(-25%)
    expect(calcMaxDrawdownPct([100, 95, 100, 200, 150])).toBeCloseTo(-25, 5);
  });
});

describe('calcSharpeRatio', () => {
  it('표본 < 2 면 0', () => {
    expect(calcSharpeRatio([], 1)).toBe(0);
    expect(calcSharpeRatio([0.01], 1)).toBe(0);
  });

  it('변동성 0(모두 동일)이면 0', () => {
    expect(calcSharpeRatio([0.01, 0.01, 0.01], DAILY_ANNUALIZATION_FACTOR)).toBe(0);
  });

  it('(평균/표준편차) × 연환산계수', () => {
    const returns = [0.01, 0.02, 0.03];
    const mean = 0.02;
    const variance = (0.01 ** 2 + 0 + 0.01 ** 2) / 3;
    const std = Math.sqrt(variance);
    const expected = (mean / std) * DAILY_ANNUALIZATION_FACTOR;
    expect(calcSharpeRatio(returns, DAILY_ANNUALIZATION_FACTOR)).toBeCloseTo(expected, 6);
  });
});

describe('toPeriodReturns', () => {
  it('연속 평가액 → 변화율 배열', () => {
    const r = toPeriodReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 6);
    expect(r[1]).toBeCloseTo(-0.1, 6);
  });

  it('직전값 ≤ 0 구간은 건너뛴다(0 나누기 방지)', () => {
    expect(toPeriodReturns([0, 100])).toEqual([]);
  });
});
