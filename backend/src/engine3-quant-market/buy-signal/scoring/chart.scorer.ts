/**
 * C5. 현재 차트 점수 (ChartScore)
 * TechnicalIndicator 기반 기술적 조건 체크
 * AI 금지영역: 순수 Rule 함수.
 */

export interface ChartInput {
  closePrice: number | null;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  bollingerMid: number | null;
  preDsclReturn: number | null; // 공시 전 선행상승률 D-5~D-1 (%)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const CHART_RULES: Array<{
  check: (i: ChartInput) => boolean;
  weight: number;
}> = [
  { check: (i) => i.closePrice != null && i.ma20 != null && i.closePrice > i.ma20,           weight:  20 },
  { check: (i) => i.closePrice != null && i.ma60 != null && i.closePrice > i.ma60,           weight:  15 },
  { check: (i) => i.rsi14 != null && i.rsi14 < 70,                                           weight:  10 },
  { check: (i) => i.rsi14 != null && i.rsi14 > 30,                                           weight:  10 },
  { check: (i) => i.macdLine != null && i.macdSignal != null && i.macdLine > i.macdSignal,   weight:  15 },
  { check: (i) => i.closePrice != null && i.bollingerMid != null && i.closePrice > i.bollingerMid, weight: 10 },
  // 패널티 조건
  { check: (i) => i.closePrice != null && i.ma5 != null && i.closePrice < i.ma5,             weight: -20 },
  { check: (i) => i.preDsclReturn != null && i.preDsclReturn > 15,                           weight: -30 },
];

const MAX_POSITIVE_WEIGHT = CHART_RULES.filter((r) => r.weight > 0).reduce(
  (sum, r) => sum + r.weight,
  0,
); // 80

export function scoreChart(input: ChartInput): number {
  const raw = CHART_RULES.reduce(
    (sum, rule) => sum + (rule.check(input) ? rule.weight : 0),
    0,
  );
  return clamp(Math.round((raw / MAX_POSITIVE_WEIGHT) * 100), -100, 100);
}
