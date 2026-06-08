/**
 * market-regime.ts — 현재 장(시장 레짐) 분류 순수 Rule (DAR-130, P-D)
 *
 * "현재 장에 어떤 persona(철학)가 맞을지"를 판단하기 위한 전제 — 시장 레짐을 결정적 규칙으로
 * 분류한다. 세 축: 추세(trend) · 변동성(volatility) · 이벤트 분포(eventSkew). 모두 side-effect 없는
 * 순수 함수 → 단위 테스트로 검증한다(I/O·prisma·AI 0).
 *
 * ★ AI 금지영역 불가침: 점수/판단은 전부 결정론적 규칙. 외부 fetch·LLM·난수 0.
 * 신뢰 원칙(DataLimitBadge): 표본 < SIGNIFICANT_SAMPLE_THRESHOLD(30) 이면 dataLimited=true 로 미유의 표기.
 *
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md P-D
 */

import { toPeriodReturns } from '../../../common/metrics/risk-metrics';

/** 추세 레짐 — 윈도 기간 지수 변화율 기준. */
export type TrendRegime = 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
/** 변동성 레짐 — 일별 수익률 표준편차 기준. */
export type VolatilityRegime = 'HIGH' | 'NORMAL' | 'LOW';
/** 이벤트 분포 편향 — 공시 극성(polarity) 분포 기준. */
export type EventSkew = 'RISK_HEAVY' | 'OPPORTUNITY' | 'BALANCED';

/** 추세 판정 임계(윈도 기간 지수 누적 변화율 %). */
export const TREND_UP_THRESHOLD_PCT = 3;
export const TREND_DOWN_THRESHOLD_PCT = -3;

/** 변동성 판정 임계(일별 수익률 표준편차 %). */
export const VOL_HIGH_DAILY_STDDEV_PCT = 1.5;
export const VOL_LOW_DAILY_STDDEV_PCT = 0.6;

/** 이벤트 편향 판정 — 우세 극성이 반대 극성의 이 배수 이상이어야 편향으로 본다. */
export const EVENT_SKEW_RATIO = 1.5;

/** 추세·변동성 분류에 필요한 최소 지수 표본(미만이면 분류 불가 → SIDEWAYS/NORMAL 기본값 + classifiable=false). */
export const REGIME_MIN_INDEX_SAMPLE = 5;

/**
 * 통계적 유의 표본 임계 — 표본 < 30 이면 미유의(DataLimitBadge 신뢰 원칙).
 * 추세/변동성은 분류하되 결론 과신을 막기 위해 dataLimited 플래그로 표기한다.
 */
export const SIGNIFICANT_SAMPLE_THRESHOLD = 30;

/** 공시 극성 분포 카운트. */
export interface EventPolarityCounts {
  positive: number;
  negative: number;
  mixed: number;
  unknown: number;
}

/** detectMarketRegime 입력. */
export interface MarketRegimeInput {
  /** 시장지수(KOSPI) 종가 시계열 — 오름차순(과거→현재). */
  indexCloses: number[];
  /** 최근 공시 이벤트 극성 분포. */
  eventPolarity: EventPolarityCounts;
  /** 기준 시각(YYYYMMDD 또는 ISO). 없으면 null. */
  asOf?: string | null;
}

/** 시장 레짐 분류 결과. */
export interface MarketRegime {
  trend: TrendRegime;
  volatility: VolatilityRegime;
  eventSkew: EventSkew;
  /** 윈도 기간 지수 누적 변화율(%) — 표본 부족이면 null. */
  trendChangePct: number | null;
  /** 일별 수익률 표준편차(%) — 표본 부족이면 null. */
  dailyVolatilityPct: number | null;
  /** 사용된 지수 표본 수. */
  indexSampleSize: number;
  /** 사용된 이벤트 표본 수(극성 합). */
  eventSampleSize: number;
  /** 이벤트 극성 분포(원자료). */
  eventPolarity: EventPolarityCounts;
  /** 추세·변동성을 분류할 만큼 지수 표본이 충분한지. */
  classifiable: boolean;
  /** 표본 < 30 → 미유의(과신 금지). 지수·이벤트 중 하나라도 임계 미만이면 true. */
  dataLimited: boolean;
  asOf: string | null;
}

/** 윈도 기간 지수 누적 변화율(%) — 표본 < 2 또는 시작값 ≤ 0 이면 null. */
export function trendChangePct(indexCloses: number[]): number | null {
  if (indexCloses.length < 2) return null;
  const first = indexCloses[0];
  const last = indexCloses[indexCloses.length - 1];
  if (first <= 0) return null;
  return ((last - first) / first) * 100;
}

/** 일별 수익률 표준편차(%) — 수익률 표본 < 2 이면 null. */
export function dailyVolatilityPct(indexCloses: number[]): number | null {
  const returns = toPeriodReturns(indexCloses);
  if (returns.length < 2) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/** 누적 변화율 → 추세 레짐. null(표본부족)이면 SIDEWAYS. */
export function classifyTrend(changePct: number | null): TrendRegime {
  if (changePct === null) return 'SIDEWAYS';
  if (changePct >= TREND_UP_THRESHOLD_PCT) return 'UPTREND';
  if (changePct <= TREND_DOWN_THRESHOLD_PCT) return 'DOWNTREND';
  return 'SIDEWAYS';
}

/** 일별 표준편차 → 변동성 레짐. null(표본부족)이면 NORMAL. */
export function classifyVolatility(volPct: number | null): VolatilityRegime {
  if (volPct === null) return 'NORMAL';
  if (volPct >= VOL_HIGH_DAILY_STDDEV_PCT) return 'HIGH';
  if (volPct <= VOL_LOW_DAILY_STDDEV_PCT) return 'LOW';
  return 'NORMAL';
}

/**
 * 공시 극성 분포 → 이벤트 편향.
 * - 부정이 긍정의 EVENT_SKEW_RATIO 배 이상 → RISK_HEAVY(악재 우세).
 * - 긍정이 부정의 EVENT_SKEW_RATIO 배 이상 → OPPORTUNITY(호재 우세).
 * - 그 외(혼조·표본 0) → BALANCED.
 */
export function classifyEventSkew(counts: EventPolarityCounts): EventSkew {
  const { positive, negative } = counts;
  if (positive === 0 && negative === 0) return 'BALANCED';
  if (negative >= positive * EVENT_SKEW_RATIO) return 'RISK_HEAVY';
  if (positive >= negative * EVENT_SKEW_RATIO) return 'OPPORTUNITY';
  return 'BALANCED';
}

/**
 * 시장 레짐 종합 분류. 지수 표본이 REGIME_MIN_INDEX_SAMPLE 미만이면 추세/변동성은 기본값으로 두되
 * classifiable=false. dataLimited 는 지수·이벤트 표본 중 하나라도 < 30 이면 true(미유의 표기).
 */
export function detectMarketRegime(input: MarketRegimeInput): MarketRegime {
  const indexSampleSize = input.indexCloses.length;
  const eventSampleSize =
    input.eventPolarity.positive +
    input.eventPolarity.negative +
    input.eventPolarity.mixed +
    input.eventPolarity.unknown;

  const classifiable = indexSampleSize >= REGIME_MIN_INDEX_SAMPLE;
  const changePct = classifiable ? trendChangePct(input.indexCloses) : null;
  const volPct = classifiable ? dailyVolatilityPct(input.indexCloses) : null;

  const dataLimited =
    indexSampleSize < SIGNIFICANT_SAMPLE_THRESHOLD ||
    eventSampleSize < SIGNIFICANT_SAMPLE_THRESHOLD;

  return {
    trend: classifyTrend(changePct),
    volatility: classifyVolatility(volPct),
    eventSkew: classifyEventSkew(input.eventPolarity),
    trendChangePct: changePct,
    dailyVolatilityPct: volPct,
    indexSampleSize,
    eventSampleSize,
    eventPolarity: input.eventPolarity,
    classifiable,
    dataLimited,
    asOf: input.asOf ?? null,
  };
}
