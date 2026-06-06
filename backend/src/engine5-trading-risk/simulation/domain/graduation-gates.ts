// 졸업 게이트 평가기 — 순수 Rule (M10 졸업 측정, DAR-67)
//
// GraduationMetricsService.getMetrics() 산출값(G1 적중률·G2 누적수익·G3 AI비용/순익·
// G5 Exit정확도)을 "현재값 vs 기준 · 통과여부 · 표본수"로 매핑한다.
// 기준치는 cc-mvp-definition §9 go/no-go 게이트(= paper-simulation 게이트)와 일치:
//   G1 적중률(D+5) ≥ 55%, G2 누적수익 > 0%, G3 AI비용/순익 ≤ 0.2, G5 Exit정확도(D+3) ≥ 50%.
//
// ★ 과신 방지(DAR-39/56 계승): 표본 부족(< MIN_SAMPLE) 게이트는 통과로 위장하지 않고
//   pass=null + lowSample=true 로 정직 표기. AI 금지영역: 순수 산술 비교만 — AI 개입 0.

import { GraduationMetrics } from '../graduation-metrics.service';

/** 표본 기반 게이트(G1·G5)의 최소 표본수 — 미만이면 LOW_SAMPLE(과신 방지) */
export const GRADUATION_MIN_SAMPLE = 5;

/** 게이트 기준치 */
export const GRADUATION_THRESHOLDS = {
  /** G1 적중률(D+5) 기준 — % */
  hitRatePct: 55,
  /** G2 누적 수익률 기준 — % (초과) */
  cumulativeReturnPct: 0,
  /** G3 AI비용/순익 비율 기준 — 이하 */
  aiCostRatio: 0.2,
  /** G5 Exit 정확도(D+3) 기준 — % */
  exitAccuracyPct: 50,
} as const;

export type GateId = 'G1' | 'G2' | 'G3' | 'G5';
export type GateComparator = 'gte' | 'gt' | 'lte';
export type GateUnit = 'percent' | 'ratio';

export interface GraduationGate {
  id: GateId;
  /** 사람이 읽는 지표명 */
  label: string;
  /** 현재 측정값(percent: 0~100, ratio: 배수). 측정 불가면 null */
  currentValue: number | null;
  /** 통과 기준치 */
  threshold: number;
  /** 비교 방향 */
  comparator: GateComparator;
  unit: GateUnit;
  /** 통과 여부 — 표본 부족·측정 불가면 null(정직 표기) */
  pass: boolean | null;
  /** 표본수(표본 기반 게이트만, 그 외 null) */
  sampleSize: number | null;
  /** 표본 부족 경고(표본 기반 게이트만 true 가능) */
  lowSample: boolean;
  /** 측정 가능 여부(G3: 순익 ≤ 0 이면 측정 불가) */
  measurable: boolean;
}

export interface GraduationReport {
  portfolioId: string;
  /** 산출 시각(ISO) */
  asOf: string;
  gates: GraduationGate[];
  /** 통과 게이트 수 */
  passedCount: number;
  /** 전체 게이트 수 */
  totalGates: number;
  /** 전부 통과(졸업 도달) 여부 */
  allPassed: boolean;
  /** 졸업 진척률(0~1) = passedCount / totalGates */
  progress: number;
  /** 표본 부족 게이트가 하나라도 있으면 true(전체 과신 경고) */
  lowSample: boolean;
}

function compare(value: number, threshold: number, comparator: GateComparator): boolean {
  switch (comparator) {
    case 'gte':
      return value >= threshold;
    case 'gt':
      return value > threshold;
    case 'lte':
      return value <= threshold;
  }
}

/** 표본 기반 게이트(G1·G5) 평가 — 표본 부족이면 pass=null */
function buildSampleGate(
  id: GateId,
  label: string,
  valuePct: number,
  evaluated: number,
  threshold: number,
): GraduationGate {
  const lowSample = evaluated < GRADUATION_MIN_SAMPLE;
  return {
    id,
    label,
    currentValue: lowSample ? null : valuePct,
    threshold,
    comparator: 'gte',
    unit: 'percent',
    pass: lowSample ? null : compare(valuePct, threshold, 'gte'),
    sampleSize: evaluated,
    lowSample,
    measurable: !lowSample,
  };
}

/**
 * getMetrics 결과 → 졸업 리포트(게이트별 현재값/기준/통과여부/표본수 + LOW_SAMPLE).
 * 순수 함수 — 부수효과·AI 개입 0.
 */
export function buildGraduationReport(metrics: GraduationMetrics): GraduationReport {
  // G1 적중률(D+5) — 표본 기반
  const g1 = buildSampleGate(
    'G1',
    '신호 적중률(D+5)',
    metrics.hitRate.hitRatePct,
    metrics.hitRate.evaluated,
    GRADUATION_THRESHOLDS.hitRatePct,
  );

  // G2 누적 수익률 — 항상 측정 가능
  const g2ret = metrics.cumulativeReturn.returnPct;
  const g2: GraduationGate = {
    id: 'G2',
    label: '모의 누적 수익률',
    currentValue: g2ret,
    threshold: GRADUATION_THRESHOLDS.cumulativeReturnPct,
    comparator: 'gt',
    unit: 'percent',
    pass: compare(g2ret, GRADUATION_THRESHOLDS.cumulativeReturnPct, 'gt'),
    sampleSize: null,
    lowSample: false,
    measurable: true,
  };

  // G3 AI비용/순익 — 순익 ≤ 0 이면 ratio=-1(측정 불가)
  const ratio = metrics.aiCostEfficiency.aiCostToNetPnlRatio;
  const g3measurable = ratio >= 0;
  const g3: GraduationGate = {
    id: 'G3',
    label: 'AI비용/순익 비율',
    currentValue: g3measurable ? ratio : null,
    threshold: GRADUATION_THRESHOLDS.aiCostRatio,
    comparator: 'lte',
    unit: 'ratio',
    pass: g3measurable ? compare(ratio, GRADUATION_THRESHOLDS.aiCostRatio, 'lte') : null,
    sampleSize: null,
    lowSample: false,
    measurable: g3measurable,
  };

  // G5 Exit 정확도(D+3) — 표본 기반
  const g5 = buildSampleGate(
    'G5',
    'Exit 정확도(D+3)',
    metrics.exitAccuracy.accuracyPct,
    metrics.exitAccuracy.evaluated,
    GRADUATION_THRESHOLDS.exitAccuracyPct,
  );

  const gates = [g1, g2, g3, g5];
  const passedCount = gates.filter((g) => g.pass === true).length;
  const totalGates = gates.length;
  const lowSample = gates.some((g) => g.lowSample);

  return {
    portfolioId: metrics.portfolioId,
    asOf: metrics.asOf,
    gates,
    passedCount,
    totalGates,
    allPassed: gates.every((g) => g.pass === true),
    progress: totalGates > 0 ? passedCount / totalGates : 0,
    lowSample,
  };
}
