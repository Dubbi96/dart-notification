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

import { mean, tStatistic, tDistPValue } from '../event-study/utils/statistics';
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
  /** 평균 초과수익(%). 표본 0이면 null */
  avgExcessReturn: number | null;
  /** 중앙값 초과수익(%). 표본 0이면 null */
  medianExcessReturn: number | null;
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
  return {
    sampleCount: n,
    avgExcessReturn: round2(mean(values)),
    medianExcessReturn: round2(median(values)),
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

/** buyScore → 등급 임계값에 정렬된 구간 라벨(STRONG_BUY 80/BUY 60/WATCH 30 검증축) */
export function scoreBandOf(buyScore: number): string {
  if (buyScore >= SIGNAL_GRADE_THRESHOLDS.STRONG_BUY_CANDIDATE) return '80+ (STRONG_BUY)';
  if (buyScore >= SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE) return '60-79 (BUY)';
  if (buyScore >= SIGNAL_GRADE_THRESHOLDS.WATCH) return '30-59 (WATCH)';
  if (buyScore >= 0) return '0-29';
  return '<0';
}

/** 점수 구간 정렬용 우선순위(높은 점수 구간이 먼저) */
const SCORE_BAND_ORDER = ['80+ (STRONG_BUY)', '60-79 (BUY)', '30-59 (WATCH)', '0-29', '<0'];

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
  };
}
