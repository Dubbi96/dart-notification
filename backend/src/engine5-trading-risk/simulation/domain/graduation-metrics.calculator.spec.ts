// 졸업지표 계산기 단위 스펙 — 위험조정·벤치마크 (DAR-68)
// 핵심 가드: 표본/데이터 부족이면 측정 불가(null + measurable=false) 정직 표기(과신 방지).

import {
  calcRiskAdjusted,
  calcBenchmarkAlpha,
  RISK_ADJUSTED_MIN_POINTS,
  EquityPoint,
  BenchmarkPoint,
} from './graduation-metrics.calculator';

function equity(values: number[]): EquityPoint[] {
  return values.map((totalValue, i) => ({
    snapshotDate: `202601${String(i + 1).padStart(2, '0')}`,
    totalValue,
  }));
}

describe('calcRiskAdjusted', () => {
  it(`평가액 점 < ${RISK_ADJUSTED_MIN_POINTS} 이면 측정 불가(null + measurable=false)`, () => {
    const r = calcRiskAdjusted(equity([10_000_000, 10_100_000]));
    expect(r.measurable).toBe(false);
    expect(r.sharpe).toBeNull();
    expect(r.mddPct).toBeNull();
    expect(r.observations).toBe(2);
  });

  it('충분한 평가액 시계열에서 Sharpe·MDD 산출', () => {
    const r = calcRiskAdjusted(equity([10_000_000, 10_500_000, 9_800_000, 10_400_000]));
    expect(r.measurable).toBe(true);
    expect(r.observations).toBe(4);
    // 고점 10.5M → 저점 9.8M : (9.8-10.5)/10.5 ≈ -6.67%
    expect(r.mddPct).toBeCloseTo(-6.6667, 2);
    expect(typeof r.sharpe).toBe('number');
  });

  it('입력 순서가 뒤섞여도 날짜 오름차순으로 정렬해 산출', () => {
    const shuffled: EquityPoint[] = [
      { snapshotDate: '20260103', totalValue: 9_800_000 },
      { snapshotDate: '20260101', totalValue: 10_000_000 },
      { snapshotDate: '20260102', totalValue: 10_500_000 },
    ];
    const r = calcRiskAdjusted(shuffled);
    expect(r.mddPct).toBeCloseTo(-6.6667, 2);
  });
});

describe('calcBenchmarkAlpha', () => {
  const series: BenchmarkPoint[] = [
    { tradeDate: '20260101', closeIndex: 2500 },
    { tradeDate: '20260315', closeIndex: 2550 },
    { tradeDate: '20260601', closeIndex: 2600 }, // +4% over period
  ];

  it('alpha = 포트폴리오 수익률 - 벤치마크 수익률', () => {
    const r = calcBenchmarkAlpha('0001', 7, series);
    expect(r.measurable).toBe(true);
    expect(r.benchmarkReturnPct).toBeCloseTo(4, 5); // (2600-2500)/2500
    expect(r.alphaPct).toBeCloseTo(3, 5); // 7 - 4
    expect(r.fromDate).toBe('20260101');
    expect(r.toDate).toBe('20260601');
  });

  it('상승장에서 포트폴리오가 시장에 열위면 alpha 음수(위장통과 차단 신호)', () => {
    const r = calcBenchmarkAlpha('0001', 1, series); // 전략 +1% vs 시장 +4%
    expect(r.alphaPct).toBeCloseTo(-3, 5);
  });

  it('벤치마크 점 < 2 면 측정 불가(null + measurable=false)', () => {
    const r = calcBenchmarkAlpha('0001', 5, [{ tradeDate: '20260101', closeIndex: 2500 }]);
    expect(r.measurable).toBe(false);
    expect(r.benchmarkReturnPct).toBeNull();
    expect(r.alphaPct).toBeNull();
  });

  it('종가지수 ≤ 0 표본은 배제한다', () => {
    const r = calcBenchmarkAlpha('0001', 5, [
      { tradeDate: '20260101', closeIndex: 0 },
      { tradeDate: '20260201', closeIndex: 2500 },
    ]);
    // 유효 표본 1개 → 측정 불가
    expect(r.measurable).toBe(false);
  });
});
