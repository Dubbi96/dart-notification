// 졸업지표 계산기 — 순수 Rule (M10, DAR-40 / DAR-68)
// M10 졸업 보류기준 G1/G2/G3/G5를 캘린더 시간 축적 데이터로 산출.
// DAR-68: 위험조정(Sharpe·MDD)·벤치마크 초과수익(alpha) 추가 산출.
// AI 금지영역: 지표 집계는 순수 Rule. AI 개입 0.

import {
  calcMaxDrawdownPct,
  calcSharpeRatio,
  toPeriodReturns,
  DAILY_ANNUALIZATION_FACTOR,
} from '../../../common/metrics/risk-metrics';

/** G1 적중률: 진입 후 D+N 수익률 표본 */
export interface HitRateSample {
  /** D+N 시점 수익률 (%) */
  returnPct: number;
}

/** G5 Exit 정확도: 청산 시점 가격 vs 청산 후 D+N 가격 */
export interface ExitAccuracySample {
  priceAtExit: number;
  priceAfterHorizon: number;
}

export interface HitRateResult {
  evaluated: number;
  hits: number;
  hitRatePct: number; // 0~100
}

export interface ExitAccuracyResult {
  evaluated: number;
  correct: number;
  accuracyPct: number; // 0~100
}

export interface CumulativeReturnResult {
  initialCapital: number;
  currentValue: number;
  absolutePnl: number;
  returnPct: number; // 0 기준
}

export interface AiCostEfficiencyResult {
  aiCostKrw: number;
  netPnlKrw: number;
  netPnlAfterAiCost: number;
  /** AI비용 / 순익. 순익 ≤ 0 이면 -1(측정 불가 표시) */
  aiCostToNetPnlRatio: number;
}

/**
 * G1 적중률 (D+5): 표본 중 수익률 > 0 비율.
 */
export function calcHitRate(samples: HitRateSample[]): HitRateResult {
  const evaluated = samples.length;
  const hits = samples.filter((s) => s.returnPct > 0).length;
  const hitRatePct = evaluated > 0 ? (hits / evaluated) * 100 : 0;
  return { evaluated, hits, hitRatePct };
}

/**
 * G5 Exit 정확도 (D+3): 청산이 옳았는가 — 청산 후 가격이 청산가보다 하락했으면 정확.
 */
export function calcExitAccuracy(samples: ExitAccuracySample[]): ExitAccuracyResult {
  const evaluated = samples.length;
  const correct = samples.filter((s) => s.priceAfterHorizon < s.priceAtExit).length;
  const accuracyPct = evaluated > 0 ? (correct / evaluated) * 100 : 0;
  return { evaluated, correct, accuracyPct };
}

/**
 * G2 누적 수익률: (현재 평가액 - 초기 자본) / 초기 자본.
 */
export function calcCumulativeReturn(
  initialCapital: number,
  currentValue: number,
): CumulativeReturnResult {
  const absolutePnl = currentValue - initialCapital;
  const returnPct = initialCapital > 0 ? (absolutePnl / initialCapital) * 100 : 0;
  return { initialCapital, currentValue, absolutePnl, returnPct };
}

/**
 * G3 AI비용/순익: 누적 AI비용(KRW)과 누적 순익(KRW) 대비.
 */
export function calcAiCostEfficiency(
  aiCostKrw: number,
  netPnlKrw: number,
): AiCostEfficiencyResult {
  const netPnlAfterAiCost = netPnlKrw - aiCostKrw;
  const aiCostToNetPnlRatio = netPnlKrw > 0 ? aiCostKrw / netPnlKrw : -1;
  return { aiCostKrw, netPnlKrw, netPnlAfterAiCost, aiCostToNetPnlRatio };
}

// ── DAR-68: 위험조정·벤치마크 지표 ──

/** 일별 포트폴리오 평가액 1점 (PortfolioRiskSnapshot 의 totalValue) */
export interface EquityPoint {
  /** 스냅샷일(YYYYMMDD) */
  snapshotDate: string;
  /** 일별 평가금액(원) */
  totalValue: number;
}

/** 벤치마크(시장지수) 1점 (MarketIndex 의 종가지수) */
export interface BenchmarkPoint {
  /** 거래일(YYYYMMDD) */
  tradeDate: string;
  /** 종가지수 */
  closeIndex: number;
}

/** 최소 위험조정 측정 표본 — 일별 평가액 점이 이 미만이면 측정 불가 표기 */
export const RISK_ADJUSTED_MIN_POINTS = 3;

export interface RiskAdjustedResult {
  /** Sharpe 비율(연환산, 무위험수익률 0). 측정 불가면 null */
  sharpe: number | null;
  /** 최대낙폭(%, 0 이하). 측정 불가면 null */
  mddPct: number | null;
  /** 사용한 일별 평가액 점 수 */
  observations: number;
  /** 측정 가능 여부(점 ≥ RISK_ADJUSTED_MIN_POINTS) */
  measurable: boolean;
}

export interface BenchmarkAlphaResult {
  /** 벤치마크 지수코드(0001=KOSPI, 1001=KOSDAQ) */
  indexCode: string;
  /** 포트폴리오 기간 수익률(%) */
  portfolioReturnPct: number;
  /** 벤치마크 기간 수익률(%). 데이터 부족이면 null */
  benchmarkReturnPct: number | null;
  /** 초과수익 alpha(% , 포트폴리오 - 벤치마크). 측정 불가면 null */
  alphaPct: number | null;
  /** 벤치마크 기간 시작일(YYYYMMDD). 측정 불가면 null */
  fromDate: string | null;
  /** 벤치마크 기간 종료일(YYYYMMDD). 측정 불가면 null */
  toDate: string | null;
  /** 측정 가능 여부(시작·종료 종가지수 모두 확보) */
  measurable: boolean;
}

/**
 * 위험조정 지표(Sharpe·MDD) — 일별 평가액 시계열에서 산출.
 * 점이 RISK_ADJUSTED_MIN_POINTS 미만이면 측정 불가(null + measurable=false, 과신 방지).
 */
export function calcRiskAdjusted(equity: EquityPoint[]): RiskAdjustedResult {
  const sorted = [...equity].sort((a, b) =>
    a.snapshotDate < b.snapshotDate ? -1 : a.snapshotDate > b.snapshotDate ? 1 : 0,
  );
  const values = sorted.map((p) => p.totalValue);
  const observations = values.length;
  const measurable = observations >= RISK_ADJUSTED_MIN_POINTS;
  if (!measurable) {
    return { sharpe: null, mddPct: null, observations, measurable: false };
  }
  const dailyReturns = toPeriodReturns(values);
  return {
    sharpe: calcSharpeRatio(dailyReturns, DAILY_ANNUALIZATION_FACTOR),
    mddPct: calcMaxDrawdownPct(values),
    observations,
    measurable: true,
  };
}

/**
 * 벤치마크 대비 초과수익(alpha) — 동일 기간 시장지수 수익률 대비 포트폴리오 초과분.
 * 벤치마크 표본의 최초·최종 종가지수로 시장수익률을 구하고 alpha = 포트폴리오 - 시장.
 * 종가지수를 한쪽이라도 못 구하면 측정 불가(null + measurable=false).
 */
export function calcBenchmarkAlpha(
  indexCode: string,
  portfolioReturnPct: number,
  benchmark: BenchmarkPoint[],
): BenchmarkAlphaResult {
  const sorted = [...benchmark]
    .filter((p) => p.closeIndex > 0)
    .sort((a, b) =>
      a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0,
    );
  if (sorted.length < 2) {
    return {
      indexCode,
      portfolioReturnPct,
      benchmarkReturnPct: null,
      alphaPct: null,
      fromDate: null,
      toDate: null,
      measurable: false,
    };
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const benchmarkReturnPct =
    ((last.closeIndex - first.closeIndex) / first.closeIndex) * 100;
  return {
    indexCode,
    portfolioReturnPct,
    benchmarkReturnPct,
    alphaPct: portfolioReturnPct - benchmarkReturnPct,
    fromDate: first.tradeDate,
    toDate: last.tradeDate,
    measurable: true,
  };
}
