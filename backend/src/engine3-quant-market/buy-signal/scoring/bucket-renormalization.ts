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
import { InsiderInput } from './insider.scorer';
import { FundamentalInput, hasFundamentalData } from './fundamental.scorer';
import { KeyMetricInput, hasKeyMetricRule } from './key-metric.scorer';

export type BucketKey =
  | 'disclosureEvent'
  | 'keyMetric'
  | 'personaFit'
  | 'historicalEvent'
  | 'chart'
  | 'volumeLiquidity'
  | 'marketSector'
  | 'insider'
  | 'fundamental';

export type BucketAvailability = Record<BucketKey, boolean>;

/**
 * F10(2026-06-26): 동일 공시 1건에서 파생돼 강상관인 버킷 그룹.
 * disclosureEvent(이벤트 기본점수)·keyMetric(이벤트 추출수치)·personaFit(이벤트×polarity 파생)·
 * fundamental(공시 본문 정량값)은 사실상 같은 신호 → 서로의 '독립 교차검증(corroboration)'이 아니다.
 */
export const CORRELATED_DISCLOSURE_BUCKETS: BucketKey[] = [
  'disclosureEvent',
  'keyMetric',
  'personaFit',
  'fundamental',
];

/** F10: 가격·과거통계·수급·지분 등 공시와 독립된 증거 버킷(진짜 corroboration 출처). */
export const INDEPENDENT_EVIDENCE_BUCKETS: BucketKey[] = [
  'historicalEvent',
  'chart',
  'volumeLiquidity',
  'marketSector',
  'insider',
];

/**
 * F10: 독립 corroboration 0건일 때 상관그룹 effective 가중치 합의 상한 배수.
 * 1.0 = 중립(그룹 base 합 유지). <1.0 이면 더 강한 보수화. (백테스트 튜닝 대상)
 */
export const NO_CORROBORATION_GROUP_FACTOR = 1.0;

/** 재정규화 입력: 가용 판별에 필요한 버킷 입력만 추린 형태 */
export interface BucketAvailabilityInput {
  chart: ChartInput;
  historicalEvent: HistoricalEventInput;
  volumeLiquidity: VolumeLiquidityInput;
  marketSector: MarketSectorInput;
  personaFit: PersonaFitInput;
  insider: InsiderInput;
  fundamental: FundamentalInput;
  /** DAR-321: keyMetric 채점 규칙 존재 여부 판별용(eventType). 점수 산출엔 무관. */
  keyMetric: KeyMetricInput;
}

/**
 * personaFit 가 방향 정보를 담고 있는지 판별 (DAR-321).
 *
 * persona-view.rule 은 polarity 가 UNKNOWN 이면 4 persona 전부에 NEUTRAL 을 부여한다
 * (= 방향 정보 없음). 한 persona 라도 비중립 view(POSITIVE/WATCH/NEGATIVE)가 있으면
 * 실제 방향 판단이 존재하므로 가용 유지. 전부 NEUTRAL(또는 비어있음)이면 scorePersonaFit 의
 * 0 은 "정보 없음" 기본값이므로 재정규화 분모에서 제외(omit)한다.
 *
 * 주의: 사용자 persona 만 NEUTRAL 이고 다른 persona 가 비중립이면 "실제 중립 판정"이므로
 * 가용 유지(some 가 true) — 사용자에겐 0점이되 분모엔 정당히 남는다.
 */
function hasInformativePersonaView(input: PersonaFitInput): boolean {
  return input.personaViews.some((v) => v.view !== 'NEUTRAL');
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
    // DAR-321: 핵심 수치는 "규칙이 있고 값이 중립/저점"이면 실제 평가(가용 유지)지만,
    // 규칙 자체가 없는(미모델) 이벤트의 default→0 은 "데이터 없음"이므로 분모에서 제외.
    // (insider/fundamental 의 기존 omit 패턴과 동일. scoreKeyMetric 로직은 불변.)
    keyMetric: hasKeyMetricRule(input.keyMetric.eventType),
    // DAR-321: persona 적합도 — polarity UNKNOWN 으로 전 persona NEUTRAL=0("정보 없음")이면
    // 분모에서 제외. 한 persona 라도 비중립 view 가 있으면 방향 정보 존재 → 가용 유지.
    personaFit: hasInformativePersonaView(input.personaFit),
    // 과거 유사 공시 성과: EventStudyResult 미산출 시 avgArD5=null.
    historicalEvent: input.historicalEvent.avgArD5 != null,
    chart: chartAvailable,
    volumeLiquidity: volumeLiquidityAvailable,
    marketSector: marketSectorAvailable,
    // 내부자/대량보유: 최근 윈도우에 지분변동 보고가 1건이라도 있어야 가용(DAR-88).
    // 보고가 0건이면 scorer 의 0점은 "데이터 없음" 기본값 → 분모에서 제외.
    insider: (input.insider?.trades?.length ?? 0) > 0,
    // 펀더멘털: 재무 성장률·본문 정량값 중 하나라도 유효 수치가 있어야 가용(DAR-100).
    // 전무하면 scorer 의 0점은 "데이터 없음" 기본값 → 분모에서 제외(기존 8버킷 가중치 복원).
    fundamental: hasFundamentalData(input.fundamental),
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

  // F10(2026-06-26): 독립 증거(가격·과거통계·수급·지분)가 하나라도 있으면 기존 재정규화(합=1.0).
  // 전무하면 상관그룹(동일 공시 파생)을 1.0 으로 부풀려 '거짓 corroboration'을 만들지 않는다.
  const hasIndependent = INDEPENDENT_EVIDENCE_BUCKETS.some((k) => availability[k]);

  const effectiveWeights = {} as Record<BucketKey, number>;

  if (hasIndependent) {
    // ── 기존 경로(회귀 0): 가용 버킷 가중치를 합=1.0 으로 재정규화 ──
    const availableSum = keys
      .filter((k) => availability[k])
      .reduce((sum, k) => sum + baseWeights[k], 0);
    for (const k of keys) {
      effectiveWeights[k] =
        availability[k] && availableSum > 0 ? baseWeights[k] / availableSum : 0;
    }
  } else {
    // ── F10 게이트: 독립 corroboration 0 → 상관그룹 내부에서만 재정규화하되 ──
    //   그룹 effective 합을 그룹 base 합(×FACTOR)으로 캡. 빠진 독립 가중치는 분모에
    //   채우지 않고 중립 drag 로 남겨 buyScore 를 0 쪽으로 축소(합 < 1.0).
    const groupBaseSum = CORRELATED_DISCLOSURE_BUCKETS.reduce(
      (sum, k) => sum + baseWeights[k],
      0,
    );
    const availGroupSum = CORRELATED_DISCLOSURE_BUCKETS.filter(
      (k) => availability[k],
    ).reduce((sum, k) => sum + baseWeights[k], 0);
    const cap = groupBaseSum * NO_CORROBORATION_GROUP_FACTOR;
    for (const k of keys) {
      effectiveWeights[k] =
        CORRELATED_DISCLOSURE_BUCKETS.includes(k) &&
        availability[k] &&
        availGroupSum > 0
          ? (cap * baseWeights[k]) / availGroupSum
          : 0;
    }
  }

  return { effectiveWeights, omittedBuckets };
}
