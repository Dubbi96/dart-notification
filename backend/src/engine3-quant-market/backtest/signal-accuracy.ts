/**
 * signal-accuracy.ts — 신호 사후검증 백테스트: 순수 집계 함수 (M9 백테스트, DAR-73)
 *
 * ★Main Thesis B 검증: 정적 상수인 BUY_SCORE_WEIGHTS·등급 임계값(STRONG_BUY 80/
 *   BUY 60/WATCH 30)·EVENT_BASE_SCORES 가 "실제 미래수익"을 예측하는지 검증한다.
 *   과거 TradingSignal 을 등급(signalGrade)·스코어 구간·eventType 별로 묶어
 *   D+5/D+20 실현 초과수익(시장 대비 AR)을 집계한다.
 *
 * ★ 순수 산술/매핑만 — 신규 수집·외부호출·AI 개입 0. 가중치/임계값 자동변경 금지(read-only).
 *   I/O 는 service 가 담당하고 여기서는 받은 실현수익 값만 통계로 변환한다.
 *   표본<LOW_SAMPLE_THRESHOLD 는 lowSample=true 로 표기하여 과신을 방지한다.
 */

import { mean, tStatistic, tDistPValue, winsorizedMean } from '../event-study/utils/statistics';
import { SIGNAL_GRADE_THRESHOLDS } from '../buy-signal/config/buy-signal.config';

/** 표본이 이 수 미만이면 LOW_SAMPLE 로 표기(과신 방지, 정직 표기). trade-scorecard 와 동일 기준. */
export const LOW_SAMPLE_THRESHOLD = 5;

/** 통계적 유의성(p<0.05) 판단을 위한 최소 표본. 미만이면 isSignificant=false 고정. */
export const SIGNIFICANCE_MIN_SAMPLE = 5;

/**
 * service 가 가격 데이터로 산출해 넘기는 "신호 1건의 실현 초과수익".
 * arD5/arD20 은 시장 대비 누적 초과수익(%) — 데이터 부족 시 null(해당 지평에서 제외).
 */
export interface SignalRealizedReturn {
  signalGrade: string; // SignalGrade enum 값
  buyScore: number; // -100 ~ 100
  eventType: string;
  /** D+5 실현 초과수익(%). 가격 데이터 부족 시 null */
  arD5: number | null;
  /** D+20 실현 초과수익(%). 가격 데이터 부족 시 null */
  arD20: number | null;
}

/** 단일 지평(D+5 또는 D+20)의 실현수익 정밀도 통계 */
export interface HorizonAccuracy {
  /** 해당 지평에서 실현수익을 산출할 수 있었던 표본 수 */
  sampleCount: number;
  /** 평균 초과수익(%). 표본 0이면 null. ★이상치 오염 가능(robustExcessReturn 우선 사용) */
  avgExcessReturn: number | null;
  /** 중앙값 초과수익(%). 표본 0이면 null */
  medianExcessReturn: number | null;
  /** winsorized(5/95) 평균 초과수익(%). 표본 0이면 null — DAR-410(투명성·참고) */
  winsorizedMeanExcessReturn: number | null;
  /**
   * ★강건(robust) 대표 초과수익(%) — DAR-410. **중앙값(median)** 채택.
   * 산술평균(avgExcessReturn)이 소수 극단치(유동성 낮은 소형주 폭등/폭락)에 오염되는 것을
   * 막기 위한 단조성·calibration 의 ★기본 축. 표본 0이면 null.
   * ★winsorizedMean 이 아닌 median 채택 이유: 극단치가 표본의 5% 를 넘으면(예: BLOCKED 등급
   *   상위 10% 폭등) winsorize 5/95 캡으로도 평균이 양(+)으로 잔존한다. 중앙값은 그런 단일·소수
   *   극단치에 불변이라 진짜 전형값을 준다(DAR-402 "median 이 진짜 강건" 교훈 일치).
   */
  robustExcessReturn: number | null;
  /** 승률(초과수익>0 비율, 0~1). 표본 0이면 null */
  winRate: number | null;
  /** t-검정 p<0.05 (표본≥SIGNIFICANCE_MIN_SAMPLE 일 때만 평가) */
  isSignificant: boolean;
  /** t-검정 p-값. 산출 불가 시 null */
  pValue: number | null;
}

/** 한 그룹(등급/구간/eventType)의 D+5·D+20 정밀도 묶음 */
export interface AccuracyBucket {
  /** 그룹 키 (등급명·구간 라벨·eventType) */
  key: string;
  /** 그룹 신호 수(지평 무관 전체 표본) */
  sampleCount: number;
  /** 표본 부족(과신 방지 배지) */
  lowSample: boolean;
  d5: HorizonAccuracy;
  d20: HorizonAccuracy;
}

/** 전체 신호 사후검증 리포트 */
export interface SignalAccuracyReport {
  /** 전체(그룹 무관) 집계 */
  overall: AccuracyBucket;
  /** 신호 등급별 */
  byGrade: AccuracyBucket[];
  /** buyScore 구간별(임계값 정렬) */
  byScoreBand: AccuracyBucket[];
  /** eventType 별 */
  byEventType: AccuracyBucket[];
  /** 집계 대상 신호 총수 */
  totalSignals: number;
  /** D+5/D+20 실현수익 산출 가능 신호 수 */
  realizedD5: number;
  realizedD20: number;
  /**
   * 등급 정밀도 매트릭스 (DAR-80, G1 정량토대):
   * 예측등급 × 실현수익 confusion + 등급 단조성(상위등급일수록 변별력 있는가).
   * 신호 0/실현표본 0 이면 hasData=false 로 graceful 표기.
   */
  gradePrecision: GradePrecisionMatrix;
}

/** 오름차순 정렬 후 중앙값. 빈 배열이면 null */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** 소수 2자리 반올림(표시 안정성). null 보존 */
function round2(v: number | null): number | null {
  if (v === null) return null;
  return Math.round(v * 100) / 100;
}

/** 실현수익 배열 → 단일 지평 정밀도 통계 */
export function computeHorizonAccuracy(values: number[]): HorizonAccuracy {
  const n = values.length;
  if (n === 0) {
    return {
      sampleCount: 0,
      avgExcessReturn: null,
      medianExcessReturn: null,
      winsorizedMeanExcessReturn: null,
      robustExcessReturn: null,
      winRate: null,
      isSignificant: false,
      pValue: null,
    };
  }
  const wins = values.filter((v) => v > 0).length;
  // t-검정: 평균 초과수익이 0과 유의하게 다른지 (표본 충분 시만)
  let pValue: number | null = null;
  let isSignificant = false;
  if (n >= 2) {
    const t = tStatistic(values);
    pValue = tDistPValue(t, n - 1);
    isSignificant = n >= SIGNIFICANCE_MIN_SAMPLE && pValue < 0.05;
  }
  const med = round2(median(values));
  return {
    sampleCount: n,
    avgExcessReturn: round2(mean(values)),
    medianExcessReturn: med,
    winsorizedMeanExcessReturn: round2(winsorizedMean(values)),
    // ★robust 축 = median(단일·소수 극단치에 불변). 단조성·calibration 의 권위 입력.
    robustExcessReturn: med,
    winRate: Math.round((wins / n) * 1000) / 1000,
    isSignificant,
    pValue: pValue === null ? null : Math.round(pValue * 10000) / 10000,
  };
}

/** 한 그룹의 신호 목록 → D+5·D+20 정밀도 버킷 */
export function aggregateBucket(key: string, group: SignalRealizedReturn[]): AccuracyBucket {
  const d5Values = group.map((g) => g.arD5).filter((v): v is number => v !== null);
  const d20Values = group.map((g) => g.arD20).filter((v): v is number => v !== null);
  return {
    key,
    sampleCount: group.length,
    lowSample: group.length < LOW_SAMPLE_THRESHOLD,
    d5: computeHorizonAccuracy(d5Values),
    d20: computeHorizonAccuracy(d20Values),
  };
}

/** keyFn 기준 그룹핑 (삽입 순서 보존) */
function groupBy(
  returns: SignalRealizedReturn[],
  keyFn: (r: SignalRealizedReturn) => string,
): Map<string, SignalRealizedReturn[]> {
  const map = new Map<string, SignalRealizedReturn[]>();
  for (const r of returns) {
    const k = keyFn(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/**
 * buyScore → 등급 임계값에 정렬된 구간 라벨.
 * F9(2026-06-26): 라벨을 SIGNAL_GRADE_THRESHOLDS 에서 파생 — 임계 재보정 시 자동 추종(재발 방지).
 */
const _T = SIGNAL_GRADE_THRESHOLDS;
const STRONG_BAND = `${_T.STRONG_BUY_CANDIDATE}+ (STRONG_BUY)`;
const BUY_BAND = `${_T.BUY_CANDIDATE}-${_T.STRONG_BUY_CANDIDATE - 1} (BUY)`;
const WATCH_BAND = `${_T.WATCH}-${_T.BUY_CANDIDATE - 1} (WATCH)`;
const SUB_WATCH_BAND = `0-${_T.WATCH - 1}`;
export function scoreBandOf(buyScore: number): string {
  if (buyScore >= _T.STRONG_BUY_CANDIDATE) return STRONG_BAND;
  if (buyScore >= _T.BUY_CANDIDATE) return BUY_BAND;
  if (buyScore >= _T.WATCH) return WATCH_BAND;
  if (buyScore >= 0) return SUB_WATCH_BAND;
  return '<0';
}

/** 점수 구간 정렬용 우선순위(높은 점수 구간이 먼저) */
const SCORE_BAND_ORDER = [STRONG_BAND, BUY_BAND, WATCH_BAND, SUB_WATCH_BAND, '<0'];

/**
 * 신호 실현수익 목록 → 등급·구간·eventType 별 정밀도 리포트.
 * ★ read-only 집계 — 가중치/임계값을 변경하지 않는다. 사람의 보정 근거 자료일 뿐.
 */
export function buildSignalAccuracyReport(
  returns: SignalRealizedReturn[],
): SignalAccuracyReport {
  const byGrade = [...groupBy(returns, (r) => r.signalGrade).entries()].map(([k, g]) =>
    aggregateBucket(k, g),
  );

  const byScoreBand = [...groupBy(returns, (r) => scoreBandOf(r.buyScore)).entries()]
    .map(([k, g]) => aggregateBucket(k, g))
    .sort((a, b) => SCORE_BAND_ORDER.indexOf(a.key) - SCORE_BAND_ORDER.indexOf(b.key));

  const byEventType = [...groupBy(returns, (r) => r.eventType).entries()]
    .map(([k, g]) => aggregateBucket(k, g))
    // 표본 많은 eventType 우선 노출
    .sort((a, b) => b.sampleCount - a.sampleCount);

  return {
    overall: aggregateBucket('ALL', returns),
    byGrade,
    byScoreBand,
    byEventType,
    totalSignals: returns.length,
    realizedD5: returns.filter((r) => r.arD5 !== null).length,
    realizedD20: returns.filter((r) => r.arD20 !== null).length,
    gradePrecision: buildGradePrecisionMatrix(returns),
  };
}

// =====================================================================
// DAR-80 — 등급 정밀도 매트릭스: confusion + 등급 단조성 (G1 정량토대)
//
// ★Main Thesis B+ 안전(졸업게이트 G1). 기존 byGrade 버킷은 등급별 '평균AR'만
//   제공할 뿐, "등급이 실제로 변별력이 있는가"(상위등급→양수익 적중·상위등급일수록
//   승률/평균AR 단조 증가)를 정량 검증하지 못한다. 아래 순수함수가 그 공백을 메운다.
// ★ read-only — I/O·AI·가중치 변경 0. service 가 산출한 실현수익만 통계로 변환한다.
// =====================================================================

/**
 * 등급 서열(우수→열위). confusion 의 positive 클래스 판정과 단조성 비교축.
 * SignalGrade enum 순서와 일치. 미등재(unknown) 등급은 최하위로 취급.
 */
export const GRADE_RANK_ORDER: readonly string[] = [
  'STRONG_BUY_CANDIDATE',
  'BUY_CANDIDATE',
  'WATCH',
  'NEUTRAL',
  'AVOID',
  'BLOCKED',
];

/** 매수(양수익 기대) 등급 집합 — confusion 의 'predicted positive' 클래스. */
export const BULLISH_GRADES: ReadonlySet<string> = new Set([
  'STRONG_BUY_CANDIDATE',
  'BUY_CANDIDATE',
]);

/** 등급 서열 인덱스(작을수록 우수). 미등재 등급은 서열 끝으로. */
export function gradeRank(grade: string): number {
  const idx = GRADE_RANK_ORDER.indexOf(grade);
  return idx === -1 ? GRADE_RANK_ORDER.length : idx;
}

/**
 * 단일 지평의 예측등급 × 실현수익 confusion matrix.
 * positive = 매수등급(STRONG_BUY/BUY) & 실현 초과수익>0(상위등급→양수익 적중).
 */
export interface ConfusionMatrix {
  /** 지평 라벨 */
  horizon: 'd5' | 'd20';
  /** 해당 지평에서 실현수익 산출 가능 표본 수 */
  sampleCount: number;
  /** 표본<임계(과신 방지 배지) */
  lowSample: boolean;
  /** 매수등급 & 실현 양수익(적중) */
  truePositive: number;
  /** 매수등급 & 실현 음수익/0(허위 양성) */
  falsePositive: number;
  /** 비매수등급 & 실현 음수익/0(정확히 회피) */
  trueNegative: number;
  /** 비매수등급 & 실현 양수익(놓침) */
  falseNegative: number;
  /** 정밀도 TP/(TP+FP) — 매수등급 적중률. 분모 0이면 null */
  precision: number | null;
  /** 재현율 TP/(TP+FN) — 실제 상승을 매수등급이 포착한 비율. 분모 0이면 null */
  recall: number | null;
  /** 정확도 (TP+TN)/total. 표본 0이면 null */
  accuracy: number | null;
}

/** 단일 지평 등급별 단조성 한 행 */
export interface GradeMonotonicityRow {
  grade: string;
  /** GRADE_RANK_ORDER 서열 인덱스(작을수록 우수) */
  rank: number;
  /** 해당 지평 실현수익 산출 가능 표본 */
  sampleCount: number;
  lowSample: boolean;
  /** 평균 초과수익(%). 표본 0이면 null. ★이상치 오염 가능 */
  avgExcessReturn: number | null;
  /** ★강건 대표 초과수익(%) — median. DAR-410 단조성 판정의 기본 축(이상치 불변). */
  robustExcessReturn: number | null;
  /** 승률(초과수익>0 비율). 표본 0이면 null */
  winRate: number | null;
}

/**
 * 단일 지평 등급 단조성 지표: 상위 등급일수록 평균AR·승률이 단조 증가하는가.
 * 인접 등급쌍(우수→열위) 비교로 단조 위반을 카운트하고 순위상관을 산출한다.
 */
export interface GradeMonotonicity {
  horizon: 'd5' | 'd20';
  /** 서열대로(우수→열위) 정렬된 등급별 평균AR·승률. 실현표본 있는 등급만. */
  orderedGrades: GradeMonotonicityRow[];
  /** 단조성 평가에 쓴 인접 등급쌍 수(양쪽 metric 모두 non-null) */
  comparedPairs: number;
  /** 평균AR 단조 위반 수(열위 등급이 우수 등급보다 평균AR 높음). ★이상치 오염 가능 */
  avgReturnViolations: number;
  /**
   * ★강건AR(robustExcessReturn=winsorizedMean) 단조 위반 수 — DAR-410.
   * 산술평균이 소수 이상치에 오염돼 거짓 역전을 만드는 것을 배제한 권위 지표.
   */
  robustReturnViolations: number;
  /** 승률 단조 위반 수(열위 등급이 우수 등급보다 승률 높음) */
  winRateViolations: number;
  /** 등급우수도 vs 평균AR Spearman 순위상관(+면 우수등급=고수익). 산출불가 null. ★오염 가능 */
  avgReturnRankCorrelation: number | null;
  /** 등급우수도 vs 강건AR Spearman 순위상관(+면 우수등급=고수익) — DAR-410. 산출불가 null */
  robustReturnRankCorrelation: number | null;
  /** 등급우수도 vs 승률 Spearman 순위상관. 산출불가 null */
  winRateRankCorrelation: number | null;
  /** 평균AR 완전 단조(비교쌍≥1 & 평균AR위반 0). ★이상치 오염 가능(참고용). */
  isMonotonic: boolean;
  /**
   * ★강건AR 완전 단조(비교쌍≥1 & robustReturnViolations 0) — DAR-410.
   * 등급 변별력의 **권위 판정**: 이상치 오염을 배제한 단조성. 단조성 성립 DoD 의 기준.
   */
  isRobustMonotonic: boolean;
}

/** 등급 정밀도 매트릭스 묶음(D+5·D+20) */
export interface GradePrecisionMatrix {
  /** 매트릭스 평가 가능 여부 — 실현표본 0(신호 0 포함)이면 false(데이터 없음) */
  hasData: boolean;
  confusionD5: ConfusionMatrix;
  confusionD20: ConfusionMatrix;
  monotonicityD5: GradeMonotonicity;
  monotonicityD20: GradeMonotonicity;
}

/** 한 지평의 실현수익 추출기: arD5 또는 arD20 */
type HorizonPick = (r: SignalRealizedReturn) => number | null;
const PICK_D5: HorizonPick = (r) => r.arD5;
const PICK_D20: HorizonPick = (r) => r.arD20;

/** 단일 지평 confusion matrix(예측등급 × 실현 양/음수익) */
export function computeConfusionMatrix(
  returns: SignalRealizedReturn[],
  horizon: 'd5' | 'd20',
): ConfusionMatrix {
  const pick = horizon === 'd5' ? PICK_D5 : PICK_D20;
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  for (const r of returns) {
    const ar = pick(r);
    if (ar === null) continue; // 해당 지평 미실현 → 제외
    const isBull = BULLISH_GRADES.has(r.signalGrade);
    const isPos = ar > 0;
    if (isBull && isPos) truePositive++;
    else if (isBull && !isPos) falsePositive++;
    else if (!isBull && isPos) falseNegative++;
    else trueNegative++;
  }
  const sampleCount = truePositive + falsePositive + trueNegative + falseNegative;
  const predictedPos = truePositive + falsePositive;
  const actualPos = truePositive + falseNegative;
  return {
    horizon,
    sampleCount,
    lowSample: sampleCount < LOW_SAMPLE_THRESHOLD,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: predictedPos > 0 ? round3(truePositive / predictedPos) : null,
    recall: actualPos > 0 ? round3(truePositive / actualPos) : null,
    accuracy: sampleCount > 0 ? round3((truePositive + trueNegative) / sampleCount) : null,
  };
}

/** 소수 3자리 반올림(비율 표시 안정성). null 보존 */
function round3(v: number | null): number | null {
  if (v === null) return null;
  return Math.round(v * 1000) / 1000;
}

/**
 * Spearman 순위상관(동점은 평균순위). 표본<2 또는 분산 0이면 null.
 * 단조 관계 측정용 — 선형성 가정 없이 순위 일치도만 본다.
 */
export function spearmanRankCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx;
    const dy = ry[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null; // 한 변수가 전부 동점 → 상관 정의불가
  return round3(cov / Math.sqrt(vx * vy));
}

/** 값 배열 → 평균순위(동점 평균). 오름차순 1-base 순위. */
function averageRanks(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 0-base 평균 → 1-base
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/** 단일 지평 등급 단조성 산출 */
export function computeGradeMonotonicity(
  returns: SignalRealizedReturn[],
  horizon: 'd5' | 'd20',
): GradeMonotonicity {
  const pick = horizon === 'd5' ? PICK_D5 : PICK_D20;
  // 등급별 실현수익 모으기
  const byGrade = new Map<string, number[]>();
  for (const r of returns) {
    const ar = pick(r);
    if (ar === null) continue;
    const arr = byGrade.get(r.signalGrade);
    if (arr) arr.push(ar);
    else byGrade.set(r.signalGrade, [ar]);
  }

  const orderedGrades: GradeMonotonicityRow[] = [...byGrade.entries()]
    .map(([grade, vals]) => {
      const wins = vals.filter((v) => v > 0).length;
      return {
        grade,
        rank: gradeRank(grade),
        sampleCount: vals.length,
        lowSample: vals.length < LOW_SAMPLE_THRESHOLD,
        avgExcessReturn: round2(mean(vals)),
        robustExcessReturn: round2(median(vals)), // ★median = 단조성 권위 축(이상치 불변)
        winRate: Math.round((wins / vals.length) * 1000) / 1000,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  // 인접쌍(우수→열위) 단조 위반: 열위 등급 metric > 우수 등급 metric
  let comparedPairs = 0;
  let avgReturnViolations = 0;
  let robustReturnViolations = 0;
  let winRateViolations = 0;
  for (let i = 0; i + 1 < orderedGrades.length; i++) {
    const better = orderedGrades[i];
    const worse = orderedGrades[i + 1];
    if (better.avgExcessReturn !== null && worse.avgExcessReturn !== null) {
      comparedPairs++;
      if (worse.avgExcessReturn > better.avgExcessReturn) avgReturnViolations++;
      if (
        better.robustExcessReturn !== null &&
        worse.robustExcessReturn !== null &&
        worse.robustExcessReturn > better.robustExcessReturn
      ) {
        robustReturnViolations++;
      }
      if (
        better.winRate !== null &&
        worse.winRate !== null &&
        worse.winRate > better.winRate
      ) {
        winRateViolations++;
      }
    }
  }

  // 순위상관: 등급우수도(서열 역순) vs metric. +면 우수등급=고수익.
  const quality = orderedGrades.map((g) => -g.rank);
  const avgs = orderedGrades.map((g) => g.avgExcessReturn);
  const robusts = orderedGrades.map((g) => g.robustExcessReturn);
  const wins = orderedGrades.map((g) => g.winRate);
  const avgReturnRankCorrelation =
    avgs.every((v): v is number => v !== null) && quality.length >= 2
      ? spearmanRankCorrelation(quality, avgs as number[])
      : null;
  const robustReturnRankCorrelation =
    robusts.every((v): v is number => v !== null) && quality.length >= 2
      ? spearmanRankCorrelation(quality, robusts as number[])
      : null;
  const winRateRankCorrelation =
    wins.every((v): v is number => v !== null) && quality.length >= 2
      ? spearmanRankCorrelation(quality, wins as number[])
      : null;

  return {
    horizon,
    orderedGrades,
    comparedPairs,
    avgReturnViolations,
    robustReturnViolations,
    winRateViolations,
    avgReturnRankCorrelation,
    robustReturnRankCorrelation,
    winRateRankCorrelation,
    isMonotonic: comparedPairs >= 1 && avgReturnViolations === 0,
    isRobustMonotonic: comparedPairs >= 1 && robustReturnViolations === 0,
  };
}

/**
 * 등급 정밀도 매트릭스 빌드(confusion + 단조성, D+5·D+20).
 * ★ read-only — 사람의 게이트 보정 근거 자료. 실현표본 0이면 hasData=false.
 */
export function buildGradePrecisionMatrix(
  returns: SignalRealizedReturn[],
): GradePrecisionMatrix {
  const hasData = returns.some((r) => r.arD5 !== null || r.arD20 !== null);
  return {
    hasData,
    confusionD5: computeConfusionMatrix(returns, 'd5'),
    confusionD20: computeConfusionMatrix(returns, 'd20'),
    monotonicityD5: computeGradeMonotonicity(returns, 'd5'),
    monotonicityD20: computeGradeMonotonicity(returns, 'd20'),
  };
}
