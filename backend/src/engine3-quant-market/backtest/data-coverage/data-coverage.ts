/**
 * data-coverage.ts — 백테스트 검증 창(11년) 데이터 커버리지 감사 — 순수 리포트 빌더 (DAR-544).
 *
 * 무엇: 확장 검증 창(기본 2015~2026)에 대해 연도별 가격(StockDailyPrice)·공시(Disclosure)
 *   데이터의 커버리지(존재 행수·거래일 충족·유니버스 폭)를 집계하고, 창 전체가 재검증(§8.2)·
 *   민감도 스윕(§8.4)을 완주할 만큼 데이터가 갖춰졌는지 게이트 판정을 낸다.
 *
 * ★ 측정 인프라만(불가침): 이 모듈은 전략 파라미터를 만들거나 바꾸지 않는다. 데이터 결측을
 *   '연도별로 정직하게' 드러낼 뿐, 리포트 결과로 어떤 룰·상수도 자동 변경하지 않는다(§8.4).
 *   반영은 오직 docs/trading/strategy-rulebook.md §8 변경 절차(문서 개정→재검증→사람 승인)로.
 *
 * ★ 순수 함수: DB·시각(now)·AI 개입 0. DB 질의와 달력 산출은 서비스(data-coverage.service.ts)가
 *   맡고, 이 파일은 이미 집계된 입력만 받아 결정론적으로 리포트를 조립한다(단위 테스트 DB 불요).
 *
 * ★ 달력 불완전 강건성(중요): KRX 하드코딩 달력(common/time/market-calendar KRX_HOLIDAYS)은
 *   최근 연도만 공휴일을 담는다(과거 연도 미등재 시 주말만 제외 → 기대 거래일 과대). 그래서
 *   '완전 연도'는 충족률%가 아니라 **실거래일 절대 하한**(KRX 연간 실거래일 ≈242~250)으로
 *   판정해 달력 공백을 데이터 결측으로 오판하지 않는다. 충족률%는 참고치로만 병기한다.
 */

/** 연도별 가격 커버리지 원시 집계(서비스 질의 산출). */
export interface PriceYearAggregate {
  year: number;
  /** stock_daily_prices 행수(종목×거래일). */
  rows: number;
  /** 실재 거래일 수(distinct tradeDate). */
  tradingDays: number;
  /** 커버된 종목 수(distinct stockCode). */
  stocks: number;
}

/** 연도별 공시 커버리지 원시 집계(서비스 질의 산출). */
export interface DisclosureYearAggregate {
  year: number;
  /** disclosures 행수. */
  rows: number;
  /** 커버된 기업 수(distinct corpCode). */
  corps: number;
}

/** buildCoverageReport 입력 — 서비스가 DB·달력에서 채운 집계. */
export interface CoverageAggregates {
  startYear: number;
  endYear: number;
  price: PriceYearAggregate[];
  disclosure: DisclosureYearAggregate[];
  /** 창 경계로 절단한, 연도별 KRX 기대 거래일 수(달력 SSOT 산출, 참고치). */
  expectedTradingDaysByYear: Record<number, number>;
  /** 연도가 창·asOf 안에서 '완전한 한 해'인지(연말까지 포함). 미지정 연도는 완전 연도로 간주. */
  fullYearByYear: Record<number, boolean>;
  /** 연도의 KRX 공휴일이 달력에 등재됐는지(미등재면 충족률%는 과대). 미지정은 미등재로 간주. */
  calendarCompleteByYear: Record<number, boolean>;
}

/** 연도 커버리지 상태. */
export type YearCoverageStatus = 'FULL' | 'PARTIAL' | 'MISSING';

export interface YearCoverage {
  year: number;
  /** 창·asOf 안에서 완전한 한 해인지(부분 연도는 충족률로 판정). */
  isFullYear: boolean;
  price: {
    rows: number;
    tradingDays: number;
    expectedTradingDays: number;
    /** 거래일 충족률(%, 참고치). 달력 미등재 연도는 과대표기됨 — coveragePctReliable 로 신뢰도 표기. */
    coveragePct: number | null;
    /** 충족률%이 신뢰 가능한지(달력 공휴일 등재 여부). */
    coveragePctReliable: boolean;
    distinctStocks: number;
  };
  disclosure: {
    rows: number;
    distinctCorps: number;
  };
  /** 가격 데이터 기준 연도 상태(공시는 게이트 보조 신호). */
  status: YearCoverageStatus;
}

export type CoverageVerdict = 'READY' | 'PARTIAL' | 'INSUFFICIENT';

export interface DataCoverageReport {
  window: { startYear: number; endYear: number };
  years: YearCoverage[];
  summary: {
    totalPriceRows: number;
    totalDisclosureRows: number;
    /** 가격 행 0인 연도(완전 결측). */
    missingYears: number[];
    /** 데이터가 있으나 완비 하한 미달인 연도(부분 결측). */
    partialYears: number[];
    /** 완전 커버(FULL) 연도. */
    fullyCoveredYears: number[];
    /** 공시 행 0인 연도. */
    disclosureMissingYears: number[];
    /** 달력 공휴일 미등재 연도(충족률% 과대 — 상태는 실거래일 하한으로 판정). */
    calendarIncompleteYears: number[];
    /**
     * 게이트 준비 완료 — 창의 모든 연도가 FULL 가격 커버 && 공시 존재.
     * 백테스트 러너·민감도 스윕을 11년 전 구간에서 신뢰성 있게 완주할 데이터 조건.
     */
    gateReady: boolean;
    verdict: CoverageVerdict;
    notes: string[];
  };
}

/**
 * 연도가 FULL 로 인정되는 거래일 충족률 임계(%). 부분 연도(창/asOf 절단)에만 적용.
 * ★ 측정 임계(전략 파라미터 아님).
 */
export const FULL_COVERAGE_MIN_PCT = 98;

/**
 * 완전 연도가 FULL 로 인정되는 실거래일 절대 하한. KRX 연간 실거래일은 ≈242~250 —
 * 이 값 이상이면 그 해 거래일이 사실상 모두 존재한다고 본다(달력 공백에 강건).
 * ★ 측정 임계(전략 파라미터 아님).
 */
export const FULL_YEAR_MIN_TRADING_DAYS = 240;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function classify(
  rows: number,
  tradingDays: number,
  coveragePct: number | null,
  isFullYear: boolean,
  calendarComplete: boolean,
): YearCoverageStatus {
  if (rows <= 0) return 'MISSING';
  if (isFullYear) {
    // 완전 연도: 실거래일 절대 하한으로 판정(달력 불완전에 강건).
    return tradingDays >= FULL_YEAR_MIN_TRADING_DAYS ? 'FULL' : 'PARTIAL';
  }
  // 부분 연도(창/asOf 절단): 달력 등재 시 충족률로, 미등재 시 판정 보류(PARTIAL).
  if (calendarComplete && coveragePct !== null) {
    return coveragePct >= FULL_COVERAGE_MIN_PCT ? 'FULL' : 'PARTIAL';
  }
  return 'PARTIAL';
}

/**
 * 이미 집계된 연도별 원시 수치로 커버리지 리포트를 조립한다(순수·결정론).
 * 창 [startYear, endYear] 의 모든 연도를 채우며, 데이터 없는 연도는 0/결측으로 명시한다.
 */
export function buildCoverageReport(input: CoverageAggregates): DataCoverageReport {
  const { startYear, endYear } = input;
  const priceByYear = new Map(input.price.map((p) => [p.year, p]));
  const discByYear = new Map(input.disclosure.map((d) => [d.year, d]));

  const years: YearCoverage[] = [];
  const missingYears: number[] = [];
  const partialYears: number[] = [];
  const fullyCoveredYears: number[] = [];
  const disclosureMissingYears: number[] = [];
  const calendarIncompleteYears: number[] = [];
  let totalPriceRows = 0;
  let totalDisclosureRows = 0;

  for (let year = startYear; year <= endYear; year++) {
    const p = priceByYear.get(year);
    const d = discByYear.get(year);
    const expected = input.expectedTradingDaysByYear[year] ?? 0;
    const isFullYear = input.fullYearByYear[year] ?? true;
    const calendarComplete = input.calendarCompleteByYear[year] ?? false;
    const rows = p?.rows ?? 0;
    const tradingDays = p?.tradingDays ?? 0;
    const stocks = p?.stocks ?? 0;
    const coveragePct =
      expected > 0 ? round2((tradingDays / expected) * 100) : rows > 0 ? null : 0;
    const status = classify(rows, tradingDays, coveragePct, isFullYear, calendarComplete);

    const discRows = d?.rows ?? 0;
    const discCorps = d?.corps ?? 0;

    totalPriceRows += rows;
    totalDisclosureRows += discRows;
    if (status === 'MISSING') missingYears.push(year);
    else if (status === 'PARTIAL') partialYears.push(year);
    else fullyCoveredYears.push(year);
    if (discRows <= 0) disclosureMissingYears.push(year);
    if (!calendarComplete) calendarIncompleteYears.push(year);

    years.push({
      year,
      isFullYear,
      price: {
        rows,
        tradingDays,
        expectedTradingDays: expected,
        coveragePct,
        coveragePctReliable: calendarComplete,
        distinctStocks: stocks,
      },
      disclosure: { rows: discRows, distinctCorps: discCorps },
      status,
    });
  }

  const gateReady =
    missingYears.length === 0 &&
    partialYears.length === 0 &&
    disclosureMissingYears.length === 0;
  const verdict: CoverageVerdict = gateReady
    ? 'READY'
    : missingYears.length === endYear - startYear + 1
      ? 'INSUFFICIENT'
      : 'PARTIAL';

  const notes: string[] = [];
  if (missingYears.length > 0) {
    notes.push(`가격 완전 결측 연도: ${missingYears.join(', ')} — 백필 필요.`);
  }
  if (partialYears.length > 0) {
    notes.push(
      `가격 부분 결측 연도(완전연도 실거래일<${FULL_YEAR_MIN_TRADING_DAYS} 또는 부분연도 충족률<${FULL_COVERAGE_MIN_PCT}%): ${partialYears.join(', ')}.`,
    );
  }
  if (disclosureMissingYears.length > 0) {
    notes.push(`공시 결측 연도: ${disclosureMissingYears.join(', ')} — 신호 조립 근거 부족.`);
  }
  if (calendarIncompleteYears.length > 0) {
    notes.push(
      `달력(KRX_HOLIDAYS) 미등재 연도 ${calendarIncompleteYears.join(', ')}: 충족률%는 공휴일 미반영 과대치 — 상태는 실거래일 하한으로 판정(coveragePctReliable=false).`,
    );
  }
  if (gateReady) {
    notes.push(
      `창 ${startYear}~${endYear} 전 연도 FULL 커버 + 공시 존재 — 11년 재검증·민감도 스윕 데이터 조건 충족.`,
    );
  }

  return {
    window: { startYear, endYear },
    years,
    summary: {
      totalPriceRows,
      totalDisclosureRows,
      missingYears,
      partialYears,
      fullyCoveredYears,
      disclosureMissingYears,
      calendarIncompleteYears,
      gateReady,
      verdict,
      notes,
    },
  };
}
