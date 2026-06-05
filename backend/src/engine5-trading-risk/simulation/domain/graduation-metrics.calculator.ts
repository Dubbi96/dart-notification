// 졸업지표 계산기 — 순수 Rule (M10, DAR-40)
// M10 졸업 보류기준 G1/G2/G3/G5를 캘린더 시간 축적 데이터로 산출.
// AI 금지영역: 지표 집계는 순수 Rule. AI 개입 0.

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
