/**
 * 결측 버킷 제외 가중치 재정규화 — DAR-49 (BUY 신호 0 근본 해소)
 *
 * 문제: weightedSum 은 7버킷 가중합. chart(0.15)+historicalEvent(0.10)=25% 가
 *       technical_indicators/event_study 미산출 시 null→0점으로 강제 0 처리되어,
 *       강한 공시조차 60 임계에 영구 미달 → BUY_CANDIDATE 가 0건이 된다.
 *
 * 해법: 입력 데이터 소스가 "부재(미산출)"한 버킷을 분모(가중치 합)에서 제외하고,
 *       가용 버킷의 가중치를 합=1.0 으로 재정규화한 뒤 weightedSum 을 계산한다.
 *       임계값(SIGNAL_GRADE_THRESHOLDS)은 불변 — 점수 의미를 보존하며 정당한
 *       신호가 자연히 임계 위로 올라오게 한다.
 *
 * AI 금지영역: 재정규화도 순수 Rule. AI/LLM 개입 절대 금지.
 */

import { ChartInput } from './chart.scorer';
import { HistoricalEventInput } from './historical-event.scorer';
import { VolumeLiquidityInput } from './volume-liquidity.scorer';
import { MarketSectorInput } from './market-sector.scorer';
import { PersonaFitInput } from './persona-fit.scorer';

export type BucketKey =
  | 'disclosureEvent'
  | 'keyMetric'
  | 'personaFit'
  | 'historicalEvent'
  | 'chart'
  | 'volumeLiquidity'
  | 'marketSector';

export type BucketAvailability = Record<BucketKey, boolean>;

/** 재정규화 입력: 가용 판별에 필요한 버킷 입력만 추린 형태 */
export interface BucketAvailabilityInput {
  chart: ChartInput;
  historicalEvent: HistoricalEventInput;
  volumeLiquidity: VolumeLiquidityInput;
  marketSector: MarketSectorInput;
  personaFit: PersonaFitInput;
}

/**
 * 버킷별 데이터 가용 여부 판별.
 *
 * "결측"의 정의 = 해당 버킷의 데이터 소스가 통째로 부재/미산출이라
 * scorer 의 0점이 "중립 평가"가 아니라 "데이터 없음" 기본값인 경우.
 * 각 scorer 의 null-가드 기준과 일치시켜 의미를 보존한다.
 */
export function detectBucketAvailability(
  input: BucketAvailabilityInput,
): BucketAvailability {
  const c = input.chart;
  // chart: TechnicalIndicator 지표가 하나라도 있으면 가용.
  // preDsclReturn 은 공시(disclosure)에서 파생되는 패널티 전용 신호라 제외 —
  // 기술적 지표 산출 여부의 판별 기준이 아니다.
  const chartAvailable =
    c.closePrice != null ||
    c.ma5 != null ||
    c.ma20 != null ||
    c.ma60 != null ||
    c.rsi14 != null ||
    c.macdLine != null ||
    c.macdSignal != null ||
    c.bollingerMid != null;

  const v = input.volumeLiquidity;
  // volume·liquidity: scorer 와 동일하게 필수 4필드 모두 있어야 가용.
  const volumeLiquidityAvailable =
    v.volume != null &&
    v.avgVolume20 != null &&
    v.tradingValue != null &&
    v.avgValue20 != null;

  const m = input.marketSector;
  // market·sector: scorer 와 동일하게 시장 지표 중 하나라도 있으면 가용.
  const marketSectorAvailable =
    m.kospiChange1d != null ||
    m.kosdaqChange1d != null ||
    m.sectorChange1d != null;

  return {
    // 공시 이벤트는 시그널의 트리거 자체 → 항상 존재.
    disclosureEvent: true,
    // 핵심 수치는 공시에서 추출 → 공시가 있는 한 존재(빈 추출은 "결측"이 아닌 실제 중립).
    keyMetric: true,
    // persona 적합도: AI Phase 4 의 personaViews 가 있어야 평가 가능.
    personaFit: input.personaFit.personaViews.length > 0,
    // 과거 유사 공시 성과: EventStudyResult 미산출 시 avgArD5=null.
    historicalEvent: input.historicalEvent.avgArD5 != null,
    chart: chartAvailable,
    volumeLiquidity: volumeLiquidityAvailable,
    marketSector: marketSectorAvailable,
  };
}

export interface RenormalizationResult {
  /** 가용 버킷 가중치 합이 1.0 이 되도록 재정규화된 가중치(결측 버킷=0) */
  effectiveWeights: Record<BucketKey, number>;
  /** 재정규화에서 제외된 결측 버킷 목록 */
  omittedBuckets: BucketKey[];
}

/**
 * 결측 버킷을 분모에서 제외하고 가용 버킷 가중치를 합=1.0 으로 재정규화한다.
 *
 * - 전버킷 가용(결측 0개): 기존 가중치를 그대로 반환 → 산식 의미 비트단위 보존(회귀 0).
 * - 일부 결측: 가용 가중치를 (가용 가중치 합)으로 나눠 합=1.0 으로 스케일.
 * - 전부 결측(방어): 모든 가중치 0 → weightedSum 0 으로 안전 처리.
 */
export function renormalizeWeights(
  baseWeights: Record<BucketKey, number>,
  availability: BucketAvailability,
): RenormalizationResult {
  const keys = Object.keys(baseWeights) as BucketKey[];
  const omittedBuckets = keys.filter((k) => !availability[k]);

  // 결측이 없으면 기존 가중치 그대로(부동소수 재나눗셈 회피 → 기존 점수 정확히 보존).
  if (omittedBuckets.length === 0) {
    return { effectiveWeights: { ...baseWeights }, omittedBuckets };
  }

  const availableSum = keys
    .filter((k) => availability[k])
    .reduce((sum, k) => sum + baseWeights[k], 0);

  const effectiveWeights = {} as Record<BucketKey, number>;
  for (const k of keys) {
    effectiveWeights[k] =
      availability[k] && availableSum > 0 ? baseWeights[k] / availableSum : 0;
  }

  return { effectiveWeights, omittedBuckets };
}
