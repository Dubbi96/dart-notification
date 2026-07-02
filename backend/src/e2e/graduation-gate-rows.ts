// M10 졸업 게이트(G1~G7) 리포트 행 매핑 — DAR-68 재반영 (순수 함수)
//
// 정본: docs/roadmap/cc-mvp-definition.md §9 (G1~G7 + F12 표본하한).
// 산식은 발명하지 않는다 — engine5 `simulation/domain/graduation-gates.ts`
// (buildGraduationReport: 기준치 GRADUATION_THRESHOLDS·비교·LOW_SAMPLE 판정)와
// 공통 `common/metrics/risk-metrics.ts`(MDD·Sharpe 단일 출처)를 재사용하고,
// 이 모듈은 "게이트 판정 → 리포트 행(Criterion)" 표시 매핑만 담당한다.
//
// 정직 표기(과신 방지 — DAR-39/56/86/F12 계승):
//  - 표본 부족(G1·G5 < GRADUATION_MIN_SAMPLE)·평가액 점 부족(G6)·지수 정합 부족(G7)
//    → LOW_SAMPLE + HOLD (통과 위장 금지)
//  - 30일 모의운용 창 미완주 → 측정값은 참고 표기하되 판정은 HOLD (§9 "30일 운용 후 평가")
//  - 창 완주 후 기준 미달 → FAIL(미달)로 정직 표기
// AI 금지영역: 순수 산술·문자열 매핑 — AI 개입 0.

import {
  GraduationGate,
  GraduationReport,
  GRADUATION_BENCHMARK_INDEX_CODE,
  GRADUATION_MIN_SAMPLE,
  GRADUATION_THRESHOLDS,
} from '../engine5-trading-risk/simulation/domain/graduation-gates';
import { RISK_ADJUSTED_MIN_POINTS } from '../engine5-trading-risk/simulation/domain/graduation-metrics.calculator';
import type { GraduationMetrics } from '../engine5-trading-risk/simulation/graduation-metrics.service';

// ─── 리포트 행 공통 타입 ────────────────────────────────────────────────────

export type GradeStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'HOLD';

export interface Criterion {
  id: string;
  name: string;
  target: string;
  measured: string;
  status: GradeStatus;
  evidence: string;
}

export const STATUS_LABEL: Record<GradeStatus, string> = {
  PASS: '✅ 통과',
  PARTIAL: '🟡 부분',
  FAIL: '❌ 미달',
  HOLD: '⏸ 보류',
};

/** graduation-metrics 로 측정하는 게이트(G4 수집성공률은 CollectionLog 기반 — 별도) */
export type GraduationGateRowId = 'G1' | 'G2' | 'G3' | 'G5' | 'G6' | 'G7';
export type GraduationGateRows = Record<GraduationGateRowId, Criterion>;

// ─── 게이트명·목표 (cc-mvp-definition §9 — 기준치는 GRADUATION_THRESHOLDS 단일 출처) ──

const GATE_META: Record<GraduationGateRowId, { name: string; target: string }> = {
  G1: {
    name: `신호 적중률 ≥${GRADUATION_THRESHOLDS.hitRatePct}% (D+5)`,
    target: `≥${GRADUATION_THRESHOLDS.hitRatePct}%`,
  },
  G2: {
    name: `모의 누적 수익률 >${GRADUATION_THRESHOLDS.cumulativeReturnPct}%`,
    target: `>${GRADUATION_THRESHOLDS.cumulativeReturnPct}%`,
  },
  G3: {
    name: `AI비용/모의순익 ≤${GRADUATION_THRESHOLDS.aiCostRatio * 100}%`,
    target: `≤${GRADUATION_THRESHOLDS.aiCostRatio * 100}%`,
  },
  G5: {
    name: `Exit 정확도 ≥${GRADUATION_THRESHOLDS.exitAccuracyPct}% (D+3)`,
    target: `≥${GRADUATION_THRESHOLDS.exitAccuracyPct}%`,
  },
  G6: {
    name: `최대낙폭(MDD) ≥${GRADUATION_THRESHOLDS.mddLimitPct}%`,
    target: `≥${GRADUATION_THRESHOLDS.mddLimitPct}%`,
  },
  G7: {
    name: `KOSPI 대비 초과수익(alpha) >${GRADUATION_THRESHOLDS.benchmarkAlphaPct}%`,
    target: `>${GRADUATION_THRESHOLDS.benchmarkAlphaPct}%`,
  },
};

// ─── 상태 매핑 ─────────────────────────────────────────────────────────────

/**
 * 게이트 판정 → 리포트 상태.
 * - 30일 창 미완주: 무조건 HOLD (§9 go/no-go 는 "30일 운용 후 평가")
 * - 창 완주: pass=true→PASS · pass=false→FAIL(미달) · pass=null(LOW_SAMPLE/측정불가)→HOLD
 */
export function gateStatusOf(pass: boolean | null, windowComplete: boolean): GradeStatus {
  if (!windowComplete) return 'HOLD';
  if (pass === true) return 'PASS';
  if (pass === false) return 'FAIL';
  return 'HOLD';
}

// ─── 내부 유틸 ─────────────────────────────────────────────────────────────

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function findGate(report: GraduationReport, id: GraduationGateRowId): GraduationGate {
  const gate = report.gates.find((g) => g.id === id);
  if (!gate) {
    throw new Error(`졸업 리포트에 게이트 ${id} 없음 — buildGraduationReport 계약 위반`);
  }
  return gate;
}

// ─── 측정 행 빌더 ──────────────────────────────────────────────────────────

/**
 * GraduationMetricsService.getMetrics + buildGraduationReport 결과 → 리포트 행 6개
 * (G1·G2·G3·G5·G6·G7). G4(수집 성공률)는 DisclosureCollectionLog 기반이라 호출부가 별도 구성.
 */
export function buildGraduationGateRows(
  metrics: GraduationMetrics,
  report: GraduationReport,
): GraduationGateRows {
  const progress = metrics.simulationProgress;
  const windowComplete = progress.windowComplete;
  const windowNote = progress.awaitingMeasurement
    ? '운용 시작 전(측정 대기)'
    : `30일 창 미완주 — 경과 ${progress.elapsedDays ?? 0}/${progress.windowDays}일`;
  const suffix = windowComplete ? '' : ` · ${windowNote}`;

  const g1 = findGate(report, 'G1');
  const g2 = findGate(report, 'G2');
  const g3 = findGate(report, 'G3');
  const g5 = findGate(report, 'G5');
  const g6 = findGate(report, 'G6');
  const g7 = findGate(report, 'G7');

  // G1 신호 적중률(D+5) — F12 표본하한(GRADUATION_MIN_SAMPLE) 적용
  const g1Measured = g1.lowSample
    ? `LOW_SAMPLE — 표본 ${g1.sampleSize ?? 0}건 < ${GRADUATION_MIN_SAMPLE}건(F12) → 측정 불가${suffix}`
    : `${metrics.hitRate.hitRatePct.toFixed(1)}% (표본 ${g1.sampleSize ?? 0}건)${suffix}`;

  // G2 모의 누적 수익률
  const cum = metrics.cumulativeReturn;
  const g2Measured = `${cum.returnPct.toFixed(2)}% (평가액 ${fmtKrw(cum.currentValue)} / 원금 ${fmtKrw(cum.initialCapital)})${suffix}`;

  // G3 AI비용/모의순익 — 순익 ≤ 0 이면 측정 불가
  const eff = metrics.aiCostEfficiency;
  const g3Measured = g3.measurable
    ? `${(eff.aiCostToNetPnlRatio * 100).toFixed(1)}% (AI비용 ${fmtKrw(eff.aiCostKrw)} / 순익 ${fmtKrw(eff.netPnlKrw)})${suffix}`
    : `측정 불가 — 모의순익 ≤ 0 (AI비용 ${fmtKrw(eff.aiCostKrw)})${suffix}`;

  // G5 Exit 정확도(D+3) — F12 표본하한 적용
  const g5Measured = g5.lowSample
    ? `LOW_SAMPLE — 표본 ${g5.sampleSize ?? 0}건 < ${GRADUATION_MIN_SAMPLE}건(F12) → 측정 불가${suffix}`
    : `${metrics.exitAccuracy.accuracyPct.toFixed(1)}% (표본 ${g5.sampleSize ?? 0}건)${suffix}`;

  // G6 최대낙폭(MDD) — 평가액 시계열(PortfolioRiskSnapshot) 점 부족이면 LOW_SAMPLE
  const ra = metrics.riskAdjusted;
  const g6Measured =
    ra.measurable && ra.mddPct !== null
      ? `MDD ${ra.mddPct.toFixed(2)}% (평가액 ${ra.observations}점)${suffix}`
      : `LOW_SAMPLE — 평가액 스냅샷 ${ra.observations}점 < ${RISK_ADJUSTED_MIN_POINTS}점 → 측정 불가${suffix}`;

  // G7 벤치마크(KOSPI 0001) 대비 초과수익 alpha — 지수 정합 부족이면 측정 불가
  const ba = metrics.benchmarkAlpha;
  const g7Measured =
    ba.measurable && ba.alphaPct !== null && ba.benchmarkReturnPct !== null
      ? `${ba.alphaPct >= 0 ? '+' : ''}${ba.alphaPct.toFixed(2)}%p (포트 ${ba.portfolioReturnPct.toFixed(2)}% − KOSPI ${ba.benchmarkReturnPct.toFixed(2)}%, ${ba.fromDate}~${ba.toDate})${suffix}`
      : `LOW_SAMPLE — KOSPI(${GRADUATION_BENCHMARK_INDEX_CODE}) 지수·운용기간 정합 부족 → 측정 불가${suffix}`;

  return {
    G1: {
      id: 'G1',
      ...GATE_META.G1,
      measured: g1Measured,
      status: gateStatusOf(g1.pass, windowComplete),
      evidence: `GraduationMetricsService G1 · F12 표본하한 ${GRADUATION_MIN_SAMPLE}건`,
    },
    G2: {
      id: 'G2',
      ...GATE_META.G2,
      measured: g2Measured,
      status: gateStatusOf(g2.pass, windowComplete),
      evidence: 'GraduationMetricsService G2 (실현+미실현 손익)',
    },
    G3: {
      id: 'G3',
      ...GATE_META.G3,
      measured: g3Measured,
      status: gateStatusOf(g3.pass, windowComplete),
      evidence: 'GraduationMetricsService G3 (AIUsageLog×환율 / 모의순익)',
    },
    G5: {
      id: 'G5',
      ...GATE_META.G5,
      measured: g5Measured,
      status: gateStatusOf(g5.pass, windowComplete),
      evidence: `GraduationMetricsService G5 · F12 표본하한 ${GRADUATION_MIN_SAMPLE}건`,
    },
    G6: {
      id: 'G6',
      ...GATE_META.G6,
      measured: g6Measured,
      status: gateStatusOf(g6.pass, windowComplete),
      evidence: 'DAR-68 · risk-metrics.calcMaxDrawdownPct (PortfolioRiskSnapshot)',
    },
    G7: {
      id: 'G7',
      ...GATE_META.G7,
      measured: g7Measured,
      status: gateStatusOf(g7.pass, windowComplete),
      evidence: `DAR-68 · calcBenchmarkAlpha (MarketIndex ${GRADUATION_BENCHMARK_INDEX_CODE})`,
    },
  };
}

// ─── 폴백 행 빌더 (모의 포트폴리오 없음/지표 조회 실패 — HOLD 정직 표기) ──────

/** 측정 자체가 불가할 때(모의 포트폴리오 부재·조회 오류) — 전 게이트 HOLD */
export function buildGraduationGateFallbackRows(): GraduationGateRows {
  const hold = (id: GraduationGateRowId, measured: string, evidence: string): Criterion => ({
    id,
    ...GATE_META[id],
    measured,
    status: 'HOLD',
    evidence,
  });
  return {
    G1: hold('G1', '30일+ 운용 데이터 부족 → 측정 불가', '캘린더 시간 필요 — 미측정'),
    G2: hold('G2', '30일+ 모의운용 미충족 → 측정 불가', '캘린더 시간 필요 — 미측정'),
    G3: hold('G3', '순익≤0·AIUsageLog 부족 → 측정 불가', '데이터 부족 — 미측정'),
    G5: hold('G5', '운용 데이터 부족 → 측정 불가', '캘린더 시간 필요 — 미측정'),
    G6: hold('G6', '평가액 스냅샷 부족 → 측정 불가(LOW_SAMPLE)', 'DAR-68 — 캘린더 시간 필요'),
    G7: hold('G7', '30일+ 모의운용·시장지수 정합 필요 → 측정 불가', 'DAR-68 — 데이터 부족'),
  };
}
