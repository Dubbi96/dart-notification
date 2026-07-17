import {
  buildCoverageReport,
  CoverageAggregates,
  PriceYearAggregate,
  DisclosureYearAggregate,
  FULL_YEAR_MIN_TRADING_DAYS,
} from './data-coverage';

/** 11년 창 전 연도가 완비된 이상적 집계(완전 연도·달력 등재·실거래일 ≥ 하한). */
function fullyCoveredAggregates(startYear: number, endYear: number): CoverageAggregates {
  const price: PriceYearAggregate[] = [];
  const disclosure: DisclosureYearAggregate[] = [];
  const expectedTradingDaysByYear: Record<number, number> = {};
  const fullYearByYear: Record<number, boolean> = {};
  const calendarCompleteByYear: Record<number, boolean> = {};
  for (let y = startYear; y <= endYear; y++) {
    expectedTradingDaysByYear[y] = 245;
    fullYearByYear[y] = true;
    calendarCompleteByYear[y] = true;
    price.push({ year: y, rows: 245 * 2500, tradingDays: 245, stocks: 2500 });
    disclosure.push({ year: y, rows: 30000, corps: 2400 });
  }
  return {
    startYear,
    endYear,
    price,
    disclosure,
    expectedTradingDaysByYear,
    fullYearByYear,
    calendarCompleteByYear,
  };
}

describe('buildCoverageReport (DAR-544 데이터 커버리지 감사)', () => {
  it('11년 전 연도 완비 → verdict READY · gateReady · 연도 12개 · 전부 FULL', () => {
    const report = buildCoverageReport(fullyCoveredAggregates(2015, 2026));
    expect(report.window).toEqual({ startYear: 2015, endYear: 2026 });
    expect(report.years).toHaveLength(12);
    expect(report.summary.verdict).toBe('READY');
    expect(report.summary.gateReady).toBe(true);
    expect(report.summary.missingYears).toEqual([]);
    expect(report.summary.partialYears).toEqual([]);
    expect(report.summary.fullyCoveredYears).toHaveLength(12);
    expect(report.years.every((y) => y.status === 'FULL')).toBe(true);
  });

  it('데이터 없는 연도는 0/결측으로 채워지고 missingYears 에 등재된다', () => {
    const agg = fullyCoveredAggregates(2015, 2017);
    agg.price = agg.price.filter((p) => p.year !== 2016);
    agg.disclosure = agg.disclosure.filter((d) => d.year !== 2016);
    const report = buildCoverageReport(agg);

    const y2016 = report.years.find((y) => y.year === 2016)!;
    expect(y2016.status).toBe('MISSING');
    expect(y2016.price.rows).toBe(0);
    expect(y2016.disclosure.rows).toBe(0);
    expect(report.summary.missingYears).toEqual([2016]);
    expect(report.summary.disclosureMissingYears).toEqual([2016]);
    expect(report.summary.gateReady).toBe(false);
    expect(report.summary.verdict).toBe('PARTIAL');
  });

  it(`완전 연도는 실거래일<${FULL_YEAR_MIN_TRADING_DAYS} 일 때 PARTIAL 로 분류된다`, () => {
    const agg = fullyCoveredAggregates(2020, 2020);
    agg.price = [{ year: 2020, rows: 200 * 100, tradingDays: 200, stocks: 100 }];
    const report = buildCoverageReport(agg);
    expect(report.years[0].status).toBe('PARTIAL');
    expect(report.summary.partialYears).toEqual([2020]);
    expect(report.summary.gateReady).toBe(false);
  });

  it(`완전 연도 실거래일 하한(${FULL_YEAR_MIN_TRADING_DAYS}) 경계는 FULL`, () => {
    const agg = fullyCoveredAggregates(2021, 2021);
    agg.price = [{ year: 2021, rows: 240 * 100, tradingDays: 240, stocks: 100 }];
    const report = buildCoverageReport(agg);
    expect(report.years[0].status).toBe('FULL');
  });

  it('★달력 미등재 연도라도 실거래일이 하한 이상이면 FULL(달력 공백을 결측으로 오판 금지)', () => {
    // 2018: 달력 공휴일 미등재 → 충족률 94%(과대치)이지만 실거래일 244 ≥ 240 → FULL.
    const agg = fullyCoveredAggregates(2018, 2018);
    agg.calendarCompleteByYear[2018] = false;
    agg.expectedTradingDaysByYear[2018] = 261; // 주말만 제외한 과대 기대치
    agg.price = [{ year: 2018, rows: 244 * 2100, tradingDays: 244, stocks: 2100 }];
    const report = buildCoverageReport(agg);
    const y = report.years[0];
    expect(y.status).toBe('FULL');
    expect(y.price.coveragePct).toBeCloseTo(93.49, 1);
    expect(y.price.coveragePctReliable).toBe(false);
    expect(report.summary.calendarIncompleteYears).toEqual([2018]);
    expect(report.summary.gateReady).toBe(true);
  });

  it('부분 연도(현재 연도)는 달력 등재 충족률로 판정 — 85%<98% → PARTIAL', () => {
    const agg = fullyCoveredAggregates(2026, 2026);
    agg.fullYearByYear[2026] = false; // asOf 로 절단된 진행 중 연도
    agg.calendarCompleteByYear[2026] = true;
    agg.expectedTradingDaysByYear[2026] = 134;
    agg.price = [{ year: 2026, rows: 114 * 2800, tradingDays: 114, stocks: 2800 }];
    const report = buildCoverageReport(agg);
    const y = report.years[0];
    expect(y.isFullYear).toBe(false);
    expect(y.price.coveragePct).toBeCloseTo(85.07, 1);
    expect(y.status).toBe('PARTIAL');
    expect(report.summary.partialYears).toEqual([2026]);
  });

  it('부분 연도가 asOf 까지 완비면 FULL(충족률 ≥ 98%)', () => {
    const agg = fullyCoveredAggregates(2026, 2026);
    agg.fullYearByYear[2026] = false;
    agg.calendarCompleteByYear[2026] = true;
    agg.expectedTradingDaysByYear[2026] = 134;
    agg.price = [{ year: 2026, rows: 133 * 2800, tradingDays: 133, stocks: 2800 }];
    const report = buildCoverageReport(agg);
    expect(report.years[0].price.coveragePct).toBeCloseTo(99.25, 1);
    expect(report.years[0].status).toBe('FULL');
  });

  it('전 연도 완전 결측 → verdict INSUFFICIENT', () => {
    const report = buildCoverageReport({
      startYear: 2015,
      endYear: 2016,
      price: [],
      disclosure: [],
      expectedTradingDaysByYear: { 2015: 245, 2016: 245 },
      fullYearByYear: { 2015: true, 2016: true },
      calendarCompleteByYear: { 2015: false, 2016: false },
    });
    expect(report.summary.missingYears).toEqual([2015, 2016]);
    expect(report.summary.verdict).toBe('INSUFFICIENT');
    expect(report.summary.gateReady).toBe(false);
  });

  it('합계는 연도별 행수의 총합과 일치한다', () => {
    const report = buildCoverageReport(fullyCoveredAggregates(2015, 2026));
    expect(report.summary.totalPriceRows).toBe(245 * 2500 * 12);
    expect(report.summary.totalDisclosureRows).toBe(30000 * 12);
  });
});
