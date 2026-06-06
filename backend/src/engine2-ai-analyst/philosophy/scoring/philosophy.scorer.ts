/**
 * Persona 철학 엔진 P-B — 철학별 종목 Rule 스코어러 (DAR-53)
 *
 * 각 InvestorPhilosophy 의 PhilosophyMetric(버핏 ROE≥15·부채비율≤50·PER≤20 등)
 * 기준으로 CompanyFinancial 스냅샷을 평가해 **철학별 종목 적합도(0~100)** + 항목별
 * 통과/미달 분해를 산출한다.
 *
 * 순수 Rule — AI/LLM 절대 미개입(철학 기준·재무지표 대조만).
 *
 * 결측 지표 처리: 단일 재무 스냅샷만으로는 산출 불가한 지표(FCF·해자점수·성장률·
 * 시가총액·매직포뮬러 순위·모멘텀 등)는 분모(가중치 합)에서 제외하고, 가용 지표의
 * 가중치를 합=1.0 으로 재정규화한다 — DAR-49 버킷 재정규화 패턴 재사용.
 *
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §2-2, §4 P-B
 */
import { PhilosophyMetricView } from '../ports/philosophy.repository';
import { FinancialSnapshot } from '../../../engine1-disclosure/financials/financial-query.service';

/** 단일 지표 평가 결과(통과/미달 분해 단위) */
export interface MetricEvaluation {
  metricKey: string;
  operator: PhilosophyMetricView['operator'];
  threshold: number;
  thresholdMax: number | null;
  /** 시드에 정의된 원 가중치(재정규화 전) */
  weight: number;
  description: string;
  /** 재무에서 해석한 실제 값(결측 시 null) */
  value: number | null;
  /** 값이 존재(평가 가능)한가 */
  available: boolean;
  /** 기준 통과 여부(결측이면 null) */
  passed: boolean | null;
  /** 0~1 달성도(결측이면 null). 부분 점수 포함 — 총점 가중합에 사용 */
  achievement: number | null;
}

/** 종목 × 철학 적합도 결과 */
export interface PhilosophyFitScore {
  philosophyId: string;
  investorName: string;
  /** 가용 지표가 1개 이상 → true. false면 score=null(재무만으로 평가 불가한 철학) */
  computable: boolean;
  /** 적합도 0~100(가용 지표 가중평균 × 100). computable=false면 null */
  score: number | null;
  /** 철학이 정의한 전체 지표 수 */
  totalMetrics: number;
  /** 실제 평가된(가용) 지표 수 */
  evaluatedCount: number;
  /** 결측으로 분모에서 제외된 지표 키 */
  omittedMetricKeys: string[];
  /** 통과한 지표 키 */
  passedMetricKeys: string[];
  /** 미달한 지표 키 */
  failedMetricKeys: string[];
  /** 항목별 상세(근거) */
  breakdown: MetricEvaluation[];
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * 철학 지표 키 → 재무 스냅샷 파생값 해석.
 *
 * 단일 CompanyFinancial 스냅샷으로 산출 가능한 지표 + 다년 시계열에서 사전 산출·영속된
 * 성장률(DAR-93)을 매핑한다.
 * 여기에 없는 키(FCF_POSITIVE·MOAT_SCORE·PEG·MARKET_CAP_TIER·ROC·EARNINGS_YIELD·
 * 모멘텀/수급 지표 등)는 null → 결측 처리되어 분모에서 제외된다(시세 확보 후 보강).
 *
 * EPS_GROWTH_YOY·REVENUE_GROWTH_YOY 는 DAR-93 으로 다년 재무 시계열에서 성장률을
 * 산출·영속해 스냅샷에 실린다. 직전 연도 데이터가 없으면 여전히 null(결측 폴백 유지).
 */
export function resolveFinancialMetric(
  metricKey: string,
  snap: FinancialSnapshot,
): number | null {
  switch (metricKey) {
    case 'ROE':
      return snap.roe;
    case 'ROA':
      return snap.roa;
    case 'DEBT_RATIO':
      return snap.debtRatio;
    case 'PER':
      return snap.per;
    case 'PBR':
      return snap.pbr;
    case 'EPS_GROWTH_YOY':
      // DAR-93: 다년 시계열 산출 성장률. 직전 연도 결측 시 null.
      return snap.epsGrowthYoY;
    case 'REVENUE_GROWTH_YOY':
      return snap.revenueGrowthYoY;
    case 'OPERATING_PROFIT_GROWTH_YOY':
      return snap.operatingProfitGrowthYoY;
    case 'OPERATING_MARGIN': {
      // 영업이익률(%) = 영업이익 / 매출 × 100 (재무제표만으로 파생)
      if (
        snap.operatingProfit == null ||
        snap.revenue == null ||
        snap.revenue === 0
      ) {
        return null;
      }
      return (snap.operatingProfit / snap.revenue) * 100;
    }
    default:
      // 단일 재무 스냅샷으로 산출 불가 → 결측
      return null;
  }
}

/**
 * 단일 지표 평가 — 연산자별 통과/미달 + 0~1 달성도.
 *
 * - GT(높을수록 좋음): value ≥ threshold → 통과(1.0). 미달 시 부분점수 value/threshold.
 *   threshold ≤ 0(예: 양수 여부)인 지표는 이분 평가(value > threshold ? 1 : 0).
 * - LT(낮을수록 좋음, PER·PBR·부채비율 등 양수 도메인 비율): 0 < value ≤ threshold →
 *   통과(1.0). 초과 시 부분점수 threshold/value. value ≤ 0(적자로 PER 음수 등)은 미달 0.
 * - RANGE: threshold ≤ value ≤ thresholdMax → 통과(1.0), 아니면 0.
 * - EQ: value === threshold → 통과(1.0), 아니면 0.
 */
export function evaluateMetricValue(
  metric: PhilosophyMetricView,
  value: number,
): { passed: boolean; achievement: number } {
  const { operator, threshold, thresholdMax } = metric;
  switch (operator) {
    case 'GT': {
      const passed = value >= threshold;
      if (passed) return { passed, achievement: 1 };
      if (threshold > 0) {
        return { passed, achievement: clamp01(value / threshold) };
      }
      // threshold ≤ 0: 양수/임계 초과 여부 이분 평가
      return { passed, achievement: value > threshold ? 1 : 0 };
    }
    case 'LT': {
      // 양수 도메인 비율 전제: value ≤ 0 (적자 PER 등)은 "싸다"가 아니라 미달.
      if (threshold > 0 && value <= 0) {
        return { passed: false, achievement: 0 };
      }
      const passed = value <= threshold;
      if (passed) return { passed, achievement: 1 };
      if (value > 0 && threshold > 0) {
        return { passed, achievement: clamp01(threshold / value) };
      }
      return { passed, achievement: 0 };
    }
    case 'RANGE': {
      const upper = thresholdMax ?? threshold;
      const passed = value >= threshold && value <= upper;
      return { passed, achievement: passed ? 1 : 0 };
    }
    case 'EQ': {
      const passed = value === threshold;
      return { passed, achievement: passed ? 1 : 0 };
    }
    default:
      return { passed: false, achievement: 0 };
  }
}

/**
 * 철학 1종 × 재무 스냅샷 → 적합도 점수.
 *
 * 가용 지표만으로 가중평균(가중치 합=1.0 재정규화) × 100 = 0~100.
 * 가용 지표 0개면 computable=false, score=null(거짓 0점 방지).
 */
export function scorePhilosophyFit(
  philosophy: {
    philosophyId: string;
    investorName: string;
    metrics: PhilosophyMetricView[];
  },
  snap: FinancialSnapshot,
): PhilosophyFitScore {
  const breakdown: MetricEvaluation[] = philosophy.metrics.map((m) => {
    const value = resolveFinancialMetric(m.metricKey, snap);
    if (value == null) {
      return {
        metricKey: m.metricKey,
        operator: m.operator,
        threshold: m.threshold,
        thresholdMax: m.thresholdMax,
        weight: m.weight,
        description: m.description,
        value: null,
        available: false,
        passed: null,
        achievement: null,
      };
    }
    const { passed, achievement } = evaluateMetricValue(m, value);
    return {
      metricKey: m.metricKey,
      operator: m.operator,
      threshold: m.threshold,
      thresholdMax: m.thresholdMax,
      weight: m.weight,
      description: m.description,
      value,
      available: true,
      passed,
      achievement,
    };
  });

  const available = breakdown.filter((b) => b.available);
  const omittedMetricKeys = breakdown
    .filter((b) => !b.available)
    .map((b) => b.metricKey);

  if (available.length === 0) {
    return {
      philosophyId: philosophy.philosophyId,
      investorName: philosophy.investorName,
      computable: false,
      score: null,
      totalMetrics: philosophy.metrics.length,
      evaluatedCount: 0,
      omittedMetricKeys,
      passedMetricKeys: [],
      failedMetricKeys: [],
      breakdown,
    };
  }

  // DAR-49 재정규화: 가용 지표 가중치 합으로 나눠 합=1.0 으로 스케일.
  const weightSum = available.reduce((s, b) => s + b.weight, 0);
  const weighted =
    weightSum > 0
      ? available.reduce((s, b) => s + (b.achievement as number) * b.weight, 0) /
        weightSum
      : available.reduce((s, b) => s + (b.achievement as number), 0) /
        available.length;

  const score = Math.round(clamp01(weighted) * 100 * 100) / 100; // 소수 2자리

  return {
    philosophyId: philosophy.philosophyId,
    investorName: philosophy.investorName,
    computable: true,
    score,
    totalMetrics: philosophy.metrics.length,
    evaluatedCount: available.length,
    omittedMetricKeys,
    passedMetricKeys: available.filter((b) => b.passed).map((b) => b.metricKey),
    failedMetricKeys: available.filter((b) => !b.passed).map((b) => b.metricKey),
    breakdown,
  };
}
