/**
 * financial-growth.spec.ts — DAR-93 (다년 재무 시계열 성장률)
 *
 * 순수 함수 검증(결정론적, I/O·AI 미개입):
 *  1) calcGrowthRate — 기본 성장률·부호 전환(절대값 분모)·결측(직전 null/0) 폴백
 *  2) quarterIndex — 보고서코드 시계열 순서
 *  3) computeGrowthSeries — YoY(동일 보고서·전년)·QoQ(직전 기간) 산출, 직전 결측 시 null
 */
import {
  calcGrowthRate,
  quarterIndex,
  computeGrowthSeries,
  PeriodFinancials,
} from './financial-growth';

describe('calcGrowthRate', () => {
  it('기본 성장률 = (현재−직전)/|직전|×100, 소수 2자리', () => {
    expect(calcGrowthRate(1200, 1000)).toBe(20);
    expect(calcGrowthRate(900, 1000)).toBe(-10);
    expect(calcGrowthRate(1, 3)).toBe(-66.67); // -66.666… 반올림
  });

  it('적자→흑자 전환은 절대값 분모로 방향성(+) 보존', () => {
    expect(calcGrowthRate(50, -100)).toBe(150); // (50-(-100))/100
    expect(calcGrowthRate(-50, 100)).toBe(-150);
  });

  it('직전 null/0 또는 현재 null 이면 산출 불가(null)', () => {
    expect(calcGrowthRate(100, null)).toBeNull();
    expect(calcGrowthRate(100, 0)).toBeNull();
    expect(calcGrowthRate(null, 100)).toBeNull();
    expect(calcGrowthRate(null, null)).toBeNull();
  });
});

describe('quarterIndex', () => {
  it('1Q<반기<3Q<사업보고서 순서', () => {
    expect(quarterIndex('11013')).toBeLessThan(quarterIndex('11012'));
    expect(quarterIndex('11012')).toBeLessThan(quarterIndex('11014'));
    expect(quarterIndex('11014')).toBeLessThan(quarterIndex('11011'));
  });
  it('미상 보고서코드는 최후순(99)', () => {
    expect(quarterIndex('99999')).toBe(99);
  });
});

describe('computeGrowthSeries', () => {
  function row(
    bsnsYear: string,
    reprtCode: string,
    o: Partial<PeriodFinancials> = {},
  ): PeriodFinancials {
    return { bsnsYear, reprtCode, revenue: null, operatingProfit: null, eps: null, ...o };
  }

  it('YoY — 동일 보고서코드·전년도 대비 산출', () => {
    const rows = [
      row('2023', '11011', { revenue: 1000, operatingProfit: 100, eps: 500 }),
      row('2024', '11011', { revenue: 1200, operatingProfit: 150, eps: 600 }),
    ];
    const series = computeGrowthSeries(rows);
    const g = series.get('2024:11011')!;
    expect(g.revenueGrowthYoY).toBe(20);
    expect(g.operatingProfitGrowthYoY).toBe(50);
    expect(g.epsGrowthYoY).toBe(20);
  });

  it('전년도 행이 없으면 YoY 는 null(결측 폴백)', () => {
    const rows = [row('2024', '11011', { revenue: 1200, eps: 600 })];
    const g = computeGrowthSeries(rows).get('2024:11011')!;
    expect(g.revenueGrowthYoY).toBeNull();
    expect(g.epsGrowthYoY).toBeNull();
  });

  it('QoQ — 시계열 직전 기간 대비 산출(연도 경계 포함)', () => {
    const rows = [
      row('2024', '11014', { revenue: 900 }), // 3Q
      row('2024', '11011', { revenue: 1200 }), // 사업보고서(직후)
      row('2025', '11013', { revenue: 300 }), // 다음해 1Q — 직전은 2024 사업보고서
    ];
    const series = computeGrowthSeries(rows);
    expect(series.get('2024:11011')!.revenueGrowthQoQ).toBeCloseTo(33.33, 2); // 1200 vs 900
    expect(series.get('2025:11013')!.revenueGrowthQoQ).toBe(-75); // 300 vs 1200
  });

  it('가장 이른 기간은 QoQ null, 입력 순서·중복에 무관하게 결정론적', () => {
    const shuffled = [
      row('2024', '11011', { revenue: 1200 }),
      row('2023', '11011', { revenue: 1000 }),
    ];
    const series = computeGrowthSeries(shuffled);
    expect(series.get('2023:11011')!.revenueGrowthQoQ).toBeNull();
    expect(series.get('2024:11011')!.revenueGrowthYoY).toBe(20);
  });

  it('빈 입력 → 빈 맵', () => {
    expect(computeGrowthSeries([]).size).toBe(0);
  });
});
