// 위험조정 성과 공통 산식 — 순수 Rule (DAR-68)
//
// 최대낙폭(MDD)·Sharpe 비율의 단일 출처. 기존 engine3 백테스트
// (performance-calculator.service.ts) 와 engine5 졸업게이트
// (graduation-metrics) 가 동일 산식을 공유한다 — 중복구현 금지.
//
// AI 금지영역: 순수 산술. 부수효과·외부호출·AI 개입 0.

/**
 * 최대낙폭(MDD) — 자본(평가액) 시계열에서 직전 고점 대비 최대 하락폭(%).
 * 반환값은 0 이하(낙폭 없음=0, 하락=음수). 빈 배열·단일 점이면 0.
 *
 * peak 는 시계열을 진행하며 갱신되는 직전 최고 평가액이며, 각 시점의
 * (현재값-peak)/peak 중 가장 깊은 값을 낙폭으로 본다.
 */
export function calcMaxDrawdownPct(equityCurve: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = ((value - peak) / peak) * 100;
      if (drawdown < mdd) mdd = drawdown;
    }
  }
  return mdd;
}

/**
 * Sharpe 비율 — 기간수익률 표본의 (평균 / 표준편차) × 연환산계수.
 * 무위험수익률 0 가정. 표본 < 2 또는 변동성 0(분모 0)이면 0(측정 불가).
 *
 * @param periodReturns 기간수익률 표본(비율, 예: 0.01 = 1%)
 * @param annualizationFactor 연환산 계수(일별=√252, 거래당=√(252/평균보유일))
 */
export function calcSharpeRatio(
  periodReturns: number[],
  annualizationFactor: number,
): number {
  if (periodReturns.length < 2) return 0;
  const mean =
    periodReturns.reduce((s, r) => s + r, 0) / periodReturns.length;
  const variance =
    periodReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    periodReturns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * annualizationFactor;
}

/** 일별 수익률용 연환산 계수(거래일 252일 기준) */
export const DAILY_ANNUALIZATION_FACTOR = Math.sqrt(252);

/**
 * 연속 평가액 시계열 → 기간(일별) 수익률 배열.
 * v[i] 대비 v[i+1] 의 변화율. 직전값 ≤ 0 인 구간은 건너뛴다(0 나누기 방지).
 */
export function toPeriodReturns(equityCurve: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) returns.push((equityCurve[i] - prev) / prev);
  }
  return returns;
}
