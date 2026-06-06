/**
 * signal-feature-ab.ts — 피처 A/B 백테스트: 순수 재채점·delta 함수 (DAR-101)
 *
 * ★Main Thesis B(신호품질 측정)의 폐루프 환류. DAR-100 이 연결한 펀더멘털(재무 성장률·
 *   DartFiledFact 본문 정량값)·내부자(insider) 피처가 실제로 적중률을 올리는지 증거 없이
 *   가중치를 키우는 것을 막는다.
 *
 * 방법: 동일 과거 신호셋을 "피처 포함 vs 미포함" 두 가중치 구성으로 **재채점**(저장된
 *   scoreBreakdown 을 재정규화 가중치로 재조합)하고, 매수등급(STRONG_BUY/BUY)으로 플래그된
 *   부분집합의 D+5/D+20 실현 적중률·median AR·등급별 정밀도를 비교한다. 피처별 delta 로
 *   "어떤 피처가 적중률을 올리는지" 수치 증거를 낸다.
 *
 * ★ read-only — I/O·외부호출·AI·가중치 자동변경 0. service 가 넘긴 breakdown/실현수익만
 *   순수 산술로 변환한다. 가중치 조정은 휴먼 PR 의 몫(증거 리포트만 제공).
 *
 * 실험 설계(교란 통제):
 *   - 레거시 7버킷은 양 구성에서 동일하게 '가용' 취급 → 피처 on/off 만 처치(treatment)로 격리.
 *   - 피처 버킷은 저장 breakdown 점수가 0이 아닐 때만 '가용'(영속된 availability 부재로 인한
 *     휴리스틱). 0점이면 양 구성이 동일 → 등급 불변(불필요한 희석 회피).
 *   - 등급을 실제로 뒤집은 신호(changed)만 피처의 관측 가능한 효과 → 그 실현표본이
 *     LOW_SAMPLE_THRESHOLD 미만이면 verdict=HOLD(과적합 경계).
 */

import { BUY_SCORE_WEIGHTS } from '../buy-signal/config/buy-signal.config';
import {
  BucketAvailability,
  BucketKey,
  renormalizeWeights,
} from '../buy-signal/scoring/bucket-renormalization';
import { mapScoreToGrade } from '../buy-signal/buy-signal.service';
import {
  AccuracyBucket,
  aggregateBucket,
  BULLISH_GRADES,
  computeConfusionMatrix,
  computeHorizonAccuracy,
  ConfusionMatrix,
  HorizonAccuracy,
  LOW_SAMPLE_THRESHOLD,
  SignalRealizedReturn,
} from './signal-accuracy';

/** A/B 대상 피처 버킷(DAR-100 연결분). insider=내부자, fundamental=성장률+DartFiledFact. */
export type FeatureBucket = 'insider' | 'fundamental';
export const FEATURE_BUCKETS: readonly FeatureBucket[] = ['insider', 'fundamental'];

/** 승률 delta 가 이 절대값 미만이면 NEUTRAL(잡음 구분). 0~1 척도(0.005=0.5%p). */
export const VERDICT_WINRATE_EPSILON = 0.005;

/** A/B 판정. HOLD=관측표본 부족(과적합 경계). */
export type AbVerdict = 'IMPROVES' | 'DEGRADES' | 'NEUTRAL' | 'HOLD';

/** 9버킷 컴포넌트 점수(저장 scoreBreakdown 의 형상) */
export interface ScoreBreakdownLike {
  disclosureEvent: number;
  keyMetric: number;
  personaFit: number;
  historicalEvent: number;
  chart: number;
  volumeLiquidity: number;
  marketSector: number;
  insider: number;
  fundamental: number;
}

/** 재채점 입력: 신호 1건의 저장 breakdown + 패널티 + 원등급 + 실현 초과수익 */
export interface FeatureAbInput {
  /** 저장된 컴포넌트별 점수(scoreBreakdown) */
  breakdown: ScoreBreakdownLike;
  /** 차감 패널티(riskPenalty, 양수) */
  riskPenalty: number;
  /** 원본 signalGrade — BLOCKED 보존용(하드 차단은 가중치 무관) */
  originalGrade: string;
  eventType: string;
  /** D+5 실현 초과수익(%). 부족 시 null */
  arD5: number | null;
  /** D+20 실현 초과수익(%). 부족 시 null */
  arD20: number | null;
}

/** 한 가중치 구성의 정밀도 묶음 */
export interface ConfigAccuracy {
  label: string;
  enabledFeatures: FeatureBucket[];
  /** 전체 신호 수 */
  totalSignals: number;
  /** 이 구성에서 매수등급(STRONG_BUY/BUY)으로 플래그된 신호 수 */
  bullishCount: number;
  /** 매수등급 부분집합의 D+5 실현 적중률·median AR */
  d5: HorizonAccuracy;
  /** 매수등급 부분집합의 D+20 실현 적중률·median AR */
  d20: HorizonAccuracy;
  /** 전체 신호 예측등급×실현수익 confusion(precision=매수등급 적중률) */
  confusionD5: ConfusionMatrix;
  confusionD20: ConfusionMatrix;
  /** 등급별 정밀도(재채점 등급 기준) */
  byGrade: AccuracyBucket[];
}

/** 두 구성 간 정밀도 차이(with − without) */
export interface AccuracyDelta {
  /** 매수등급 플래그 수 변화 */
  bullishCountDelta: number;
  /** 등급이 뒤집힌 신호 수(피처의 관측 가능한 효과 모집단) */
  changedCount: number;
  /** 뒤집힌 신호 중 D+5/D+20 실현표본 수 */
  changedRealizedD5: number;
  changedRealizedD20: number;
  /** 매수등급 부분집합 D+5 적중률·평균AR·중앙값AR delta */
  d5WinRateDelta: number | null;
  d5AvgReturnDelta: number | null;
  d5MedianReturnDelta: number | null;
  /** 매수등급 부분집합 D+20 delta */
  d20WinRateDelta: number | null;
  d20AvgReturnDelta: number | null;
  d20MedianReturnDelta: number | null;
  /** confusion precision(매수등급 적중률) delta */
  d5PrecisionDelta: number | null;
  d20PrecisionDelta: number | null;
  /** 관측표본 부족(과적합 경계 → HOLD) */
  lowSample: boolean;
  verdict: AbVerdict;
}

/** 피처별 단독 추가 효과 */
export interface FeatureDelta {
  feature: FeatureBucket;
  /** 이 피처가 0이 아닌 점수를 실은 신호 수(유효 A/B 모집단) */
  featureActiveCount: number;
  /** baseline(피처 없음) 대비 이 피처만 추가했을 때의 delta */
  delta: AccuracyDelta;
}

/** 피처 A/B 백테스트 리포트 */
export interface FeatureAbReport {
  /** A/B 대상 피처 목록 */
  features: FeatureBucket[];
  totalSignals: number;
  /** D+5/D+20 실현수익 산출 가능 신호 수 */
  realizedD5: number;
  realizedD20: number;
  /** 실현표본 존재 여부(없으면 비교 무의미 → graceful) */
  hasData: boolean;
  /** 피처 미포함(레거시 7버킷) 구성 */
  withoutFeatures: ConfigAccuracy;
  /** 피처 전부 포함 구성 */
  withFeatures: ConfigAccuracy;
  /** 전체 피처 효과(with − without) */
  overall: AccuracyDelta;
  /** 피처별 단독 효과(baseline 대비) */
  perFeature: FeatureDelta[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 소수 3자리 반올림. null 보존 */
function round3(v: number | null): number | null {
  if (v === null) return null;
  return Math.round(v * 1000) / 1000;
}

/** null-안전 뺄셈(a−b). 한쪽이라도 null 이면 null */
function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return round3(a - b);
}

/**
 * 활성 피처 집합으로 버킷 가용맵 구성.
 * 레거시 7버킷은 항상 가용(교란 통제) — 피처 버킷만 처치 변수.
 * 피처 버킷은 enabled 이고 저장 점수가 0이 아닐 때만 가용(영속 availability 부재 휴리스틱).
 */
function buildAvailability(
  breakdown: ScoreBreakdownLike,
  enabled: ReadonlySet<FeatureBucket>,
): BucketAvailability {
  return {
    disclosureEvent: true,
    keyMetric: true,
    personaFit: true,
    historicalEvent: true,
    chart: true,
    volumeLiquidity: true,
    marketSector: true,
    insider: enabled.has('insider') && breakdown.insider !== 0,
    fundamental: enabled.has('fundamental') && breakdown.fundamental !== 0,
  };
}

const BUCKET_KEYS = Object.keys(BUY_SCORE_WEIGHTS) as BucketKey[];

/**
 * 단일 신호를 주어진 활성 피처 구성으로 재채점.
 * BLOCKED 원등급은 하드 차단(가중치 무관)이므로 그대로 보존한다.
 */
export function rescoreSignal(
  input: FeatureAbInput,
  enabled: ReadonlySet<FeatureBucket>,
): { buyScore: number; grade: string } {
  if (input.originalGrade === 'BLOCKED') {
    return { buyScore: -100, grade: 'BLOCKED' };
  }
  const availability = buildAvailability(input.breakdown, enabled);
  const { effectiveWeights } = renormalizeWeights({ ...BUY_SCORE_WEIGHTS }, availability);
  let weightedSum = 0;
  for (const k of BUCKET_KEYS) {
    weightedSum += effectiveWeights[k] * input.breakdown[k];
  }
  const buyScore = Math.round(clamp(weightedSum - input.riskPenalty, -100, 100));
  return { buyScore, grade: mapScoreToGrade(buyScore) };
}

/** 재채점 1패스 결과: 신호별 등급 + 정밀도 묶음 */
interface ConfigPass {
  grades: string[];
  config: ConfigAccuracy;
}

/** 입력 + 활성 피처 → 신호별 재채점 등급 및 ConfigAccuracy 산출 */
function runConfig(
  inputs: FeatureAbInput[],
  enabled: FeatureBucket[],
  label: string,
): ConfigPass {
  const enabledSet = new Set(enabled);
  const grades: string[] = [];
  const rescored: SignalRealizedReturn[] = [];
  for (const input of inputs) {
    const { buyScore, grade } = rescoreSignal(input, enabledSet);
    grades.push(grade);
    rescored.push({
      signalGrade: grade,
      buyScore,
      eventType: input.eventType,
      arD5: input.arD5,
      arD20: input.arD20,
    });
  }

  const bullish = rescored.filter((r) => BULLISH_GRADES.has(r.signalGrade));
  const d5Values = bullish.map((r) => r.arD5).filter((v): v is number => v !== null);
  const d20Values = bullish.map((r) => r.arD20).filter((v): v is number => v !== null);

  // 등급별 정밀도(재채점 등급 기준, 삽입 순서 보존)
  const byGradeMap = new Map<string, SignalRealizedReturn[]>();
  for (const r of rescored) {
    const arr = byGradeMap.get(r.signalGrade);
    if (arr) arr.push(r);
    else byGradeMap.set(r.signalGrade, [r]);
  }

  const config: ConfigAccuracy = {
    label,
    enabledFeatures: enabled,
    totalSignals: rescored.length,
    bullishCount: bullish.length,
    d5: computeHorizonAccuracy(d5Values),
    d20: computeHorizonAccuracy(d20Values),
    confusionD5: computeConfusionMatrix(rescored, 'd5'),
    confusionD20: computeConfusionMatrix(rescored, 'd20'),
    byGrade: [...byGradeMap.entries()].map(([k, g]) => aggregateBucket(k, g)),
  };
  return { grades, config };
}

/**
 * 두 구성(without→with)의 delta 산출. 등급이 뒤집힌 신호(changed)의 실현표본이
 * LOW_SAMPLE_THRESHOLD 미만이면 verdict=HOLD(과적합 경계).
 */
function computeDelta(
  inputs: FeatureAbInput[],
  withoutPass: ConfigPass,
  withPass: ConfigPass,
): AccuracyDelta {
  let changedCount = 0;
  let changedRealizedD5 = 0;
  let changedRealizedD20 = 0;
  for (let i = 0; i < inputs.length; i++) {
    if (withoutPass.grades[i] !== withPass.grades[i]) {
      changedCount++;
      if (inputs[i].arD5 !== null) changedRealizedD5++;
      if (inputs[i].arD20 !== null) changedRealizedD20++;
    }
  }

  const a = withPass.config;
  const b = withoutPass.config;

  // 관측 가능한 효과(등급 flip)의 실현표본이 양 지평 모두 임계 미만이면 증거 부족 → HOLD.
  const lowSample =
    changedRealizedD5 < LOW_SAMPLE_THRESHOLD && changedRealizedD20 < LOW_SAMPLE_THRESHOLD;

  const d5WinRateDelta = diff(a.d5.winRate, b.d5.winRate);
  const d20WinRateDelta = diff(a.d20.winRate, b.d20.winRate);

  let verdict: AbVerdict;
  if (lowSample) {
    verdict = 'HOLD';
  } else {
    // 장기(D+20) 적중률 우선, 없으면 단기(D+5).
    const primary = d20WinRateDelta ?? d5WinRateDelta;
    if (primary === null) verdict = 'NEUTRAL';
    else if (primary > VERDICT_WINRATE_EPSILON) verdict = 'IMPROVES';
    else if (primary < -VERDICT_WINRATE_EPSILON) verdict = 'DEGRADES';
    else verdict = 'NEUTRAL';
  }

  return {
    bullishCountDelta: a.bullishCount - b.bullishCount,
    changedCount,
    changedRealizedD5,
    changedRealizedD20,
    d5WinRateDelta,
    d5AvgReturnDelta: diff(a.d5.avgExcessReturn, b.d5.avgExcessReturn),
    d5MedianReturnDelta: diff(a.d5.medianExcessReturn, b.d5.medianExcessReturn),
    d20WinRateDelta,
    d20AvgReturnDelta: diff(a.d20.avgExcessReturn, b.d20.avgExcessReturn),
    d20MedianReturnDelta: diff(a.d20.medianExcessReturn, b.d20.medianExcessReturn),
    d5PrecisionDelta: diff(a.confusionD5.precision, b.confusionD5.precision),
    d20PrecisionDelta: diff(a.confusionD20.precision, b.confusionD20.precision),
    lowSample,
    verdict,
  };
}

/**
 * 피처 A/B 백테스트 리포트 빌드.
 * ★ read-only — 가중치를 변경하지 않는다. 휴먼 PR 의 보정 근거 자료.
 */
export function buildFeatureAbReport(inputs: FeatureAbInput[]): FeatureAbReport {
  const withoutPass = runConfig(inputs, [], '피처 미포함 (레거시 7버킷)');
  const withPass = runConfig(inputs, [...FEATURE_BUCKETS], '피처 전부 포함 (9버킷)');

  const overall = computeDelta(inputs, withoutPass, withPass);

  const perFeature: FeatureDelta[] = FEATURE_BUCKETS.map((feature) => {
    const onePass = runConfig(inputs, [feature], `피처 +${feature} 단독`);
    const featureActiveCount = inputs.filter(
      (i) => i.originalGrade !== 'BLOCKED' && i.breakdown[feature] !== 0,
    ).length;
    return {
      feature,
      featureActiveCount,
      delta: computeDelta(inputs, withoutPass, onePass),
    };
  });

  return {
    features: [...FEATURE_BUCKETS],
    totalSignals: inputs.length,
    realizedD5: inputs.filter((i) => i.arD5 !== null).length,
    realizedD20: inputs.filter((i) => i.arD20 !== null).length,
    hasData: inputs.some((i) => i.arD5 !== null || i.arD20 !== null),
    withoutFeatures: withoutPass.config,
    withFeatures: withPass.config,
    overall,
    perFeature,
  };
}
