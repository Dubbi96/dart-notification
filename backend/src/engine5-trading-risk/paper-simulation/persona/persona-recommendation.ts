/**
 * persona-recommendation.ts — '현재 장 적합 persona' 추천 순수 Rule (DAR-130, P-D)
 *
 * persona(거장 철학) 4종을 현재 시장 레짐 적합도 + 최근 모의운용 성과(수익률·MDD·적중률)로
 * 결정적 규칙에 따라 점수화해 1~2개를 추천한다. 근거(rationale)를 함께 노출한다.
 *
 * ★ AI 금지영역 불가침: 모든 점수/판단은 결정론적 규칙. 외부 fetch·LLM·난수 0 → 단위 테스트로 검증.
 * 신뢰 원칙(DataLimitBadge): 성과 표본 < 30 이면 미유의 → 성과 가중을 줄이고 레짐 적합도에 의존,
 *   persona별 lowSample · 전체 dataLimited 플래그로 표기한다.
 */

import {
  PHILOSOPHY_STYLES,
  PhilosophyStyle,
  STYLE_LABELS,
} from '../philosophy-style';
import {
  MarketRegime,
  TrendRegime,
  VolatilityRegime,
  EventSkew,
  SIGNIFICANT_SAMPLE_THRESHOLD,
} from './market-regime';

/** persona ↔ 투자 아키타입(styleTags 기반) 매핑. */
export const PERSONA_ARCHETYPE: Record<PhilosophyStyle, string> = {
  BUFFETT: 'VALUE',
  LYNCH: 'GROWTH',
  GREENBLATT: 'QUANTITATIVE',
  DRUCKENMILLER: 'MACRO',
};

/** 추천에 충분한 성과 유의 표본 — 미만이면 성과 신호를 약하게 반영. */
export const PERF_RELIABLE_SAMPLE = SIGNIFICANT_SAMPLE_THRESHOLD;

/** 2순위까지 추천하는 복합점수 격차 — 1순위와 이 값 이내면 함께 추천(1~2 persona). */
export const SECOND_PICK_MARGIN = 8;

/** persona별 레짐 적합도 룰 — 축별 가감점(기준 50). 합산 후 0~100 클램프. */
interface RegimeAffinity {
  trend: Record<TrendRegime, number>;
  volatility: Record<VolatilityRegime, number>;
  eventSkew: Record<EventSkew, number>;
}

const AFFINITY: Record<PhilosophyStyle, RegimeAffinity> = {
  // 버핏(VALUE): 횡보·하락장의 저평가 매수, 저변동 선호. 고변동·과열 상승장 비선호.
  BUFFETT: {
    trend: { UPTREND: -5, SIDEWAYS: 10, DOWNTREND: 15 },
    volatility: { HIGH: -10, NORMAL: 5, LOW: 10 },
    eventSkew: { RISK_HEAVY: 10, OPPORTUNITY: 0, BALANCED: 5 },
  },
  // 린치(GROWTH): 상승장·호재 우세에서 성장주 강점. 하락·악재장 비선호.
  LYNCH: {
    trend: { UPTREND: 15, SIDEWAYS: 0, DOWNTREND: -10 },
    volatility: { HIGH: -5, NORMAL: 10, LOW: 5 },
    eventSkew: { RISK_HEAVY: -5, OPPORTUNITY: 10, BALANCED: 5 },
  },
  // 그린블라트(QUANTITATIVE): 체계적·레짐 중립, 변동성에 강건. 횡보장 소폭 우위.
  GREENBLATT: {
    trend: { UPTREND: 5, SIDEWAYS: 10, DOWNTREND: 5 },
    volatility: { HIGH: 0, NORMAL: 5, LOW: 5 },
    eventSkew: { RISK_HEAVY: 3, OPPORTUNITY: 3, BALANCED: 5 },
  },
  // 드러켄밀러(MACRO/MOMENTUM): 강한 추세·고변동·이벤트 편향장 강점. 저변동 횡보장 비선호.
  DRUCKENMILLER: {
    trend: { UPTREND: 15, SIDEWAYS: -10, DOWNTREND: 10 },
    volatility: { HIGH: 12, NORMAL: 0, LOW: -10 },
    eventSkew: { RISK_HEAVY: 10, OPPORTUNITY: 10, BALANCED: -5 },
  },
};

const clamp01to100 = (v: number): number => Math.max(0, Math.min(100, v));

/** persona × 시장 레짐 → 적합도 점수(0~100). 결정론적 룰. */
export function regimeFitScore(
  style: PhilosophyStyle,
  regime: MarketRegime,
): number {
  const a = AFFINITY[style];
  const raw =
    50 +
    a.trend[regime.trend] +
    a.volatility[regime.volatility] +
    a.eventSkew[regime.eventSkew];
  return clamp01to100(raw);
}

/** persona 1종의 최근 성과 입력 행. */
export interface PersonaPerformanceRow {
  style: PhilosophyStyle;
  /** 누적 수익률(%) — 데이터 없으면 0. */
  cumulativeReturnPct: number;
  /** 최대낙폭(%, ≤0) — 측정 불가면 null. */
  mddPct: number | null;
  /** 신호 적중률(%, 0~100) — 표본 0이면 0. */
  hitRatePct: number;
  /** 청산 표본 수(성과 신뢰도 판단용). */
  sampleSize: number;
}

/**
 * 최근 성과 → 0~100 성과 점수(결정론적).
 * - 수익률(40%): 50 + cumReturn%×2 (±25% → 0~100).
 * - MDD(30%): 100 + mdd%×2.5 (0% → 100, -40% → 0). 측정 불가면 중립 50.
 * - 적중률(30%): hitRate% 직접.
 */
export function performanceScore(row: PersonaPerformanceRow): number {
  const returnScore = clamp01to100(50 + row.cumulativeReturnPct * 2);
  const mddScore =
    row.mddPct === null ? 50 : clamp01to100(100 + row.mddPct * 2.5);
  const hitScore = clamp01to100(row.hitRatePct);
  return 0.4 * returnScore + 0.3 * mddScore + 0.3 * hitScore;
}

/** 추천 결과 — persona 1종. */
export interface RankedPersona {
  style: PhilosophyStyle;
  label: string;
  archetype: string;
  regimeFitScore: number;
  performanceScore: number;
  /** 레짐 적합도 + 성과의 가중 복합점수(0~100). */
  compositeScore: number;
  /** 성과 표본 < 30 → 미유의(과신 금지). */
  lowSample: boolean;
  sampleSize: number;
  /** 추천 대상 여부(1~2순위). */
  recommended: boolean;
  /** 추천 근거(결정론적 텍스트). */
  rationale: string;
}

/** '현재 장 적합 persona' 추천 응답. */
export interface PersonaRecommendation {
  /** 복합점수 내림차순 정렬된 4 persona. */
  ranked: RankedPersona[];
  /** 추천 persona(1~2개) style 목록. */
  recommended: PhilosophyStyle[];
  /** 전체 결론 과신 금지 — 레짐 미유의 또는 모든 persona 성과 표본 < 30. */
  dataLimited: boolean;
  /** 유의 표본 임계(표기용). */
  significantSampleThreshold: number;
}

const TREND_KO: Record<TrendRegime, string> = {
  UPTREND: '상승추세',
  DOWNTREND: '하락추세',
  SIDEWAYS: '횡보',
};
const VOL_KO: Record<VolatilityRegime, string> = {
  HIGH: '고변동성',
  NORMAL: '보통변동성',
  LOW: '저변동성',
};
const SKEW_KO: Record<EventSkew, string> = {
  RISK_HEAVY: '악재 우세',
  OPPORTUNITY: '호재 우세',
  BALANCED: '균형',
};

function buildRationale(
  style: PhilosophyStyle,
  regime: MarketRegime,
  regimeFit: number,
  perfReliable: boolean,
  row: PersonaPerformanceRow,
): string {
  const regimeText = `현재 장(${TREND_KO[regime.trend]}·${VOL_KO[regime.volatility]}·${SKEW_KO[regime.eventSkew]}) 적합도 ${Math.round(
    regimeFit,
  )}점`;
  const perfText = perfReliable
    ? `최근 성과 누적수익률 ${row.cumulativeReturnPct.toFixed(1)}%·적중률 ${row.hitRatePct.toFixed(0)}%(표본 ${row.sampleSize})`
    : `성과 표본 ${row.sampleSize} < ${PERF_RELIABLE_SAMPLE}로 미유의 — 레짐 적합도 위주 판단`;
  return `${STYLE_LABELS[style]}(${PERSONA_ARCHETYPE[style]}): ${regimeText}, ${perfText}.`;
}

/**
 * persona 추천 — 레짐 적합도 + 최근 성과를 결정적으로 결합해 복합점수 산출·정렬·1~2 추천.
 * - 성과 표본 ≥ 30(신뢰): 복합 = 0.5×레짐 + 0.5×성과.
 * - 성과 표본 < 30(미유의): 복합 = 0.75×레짐 + 0.25×성과(약한 신호만 반영).
 * - 추천: 1순위 + (2순위 복합점수가 1순위와 SECOND_PICK_MARGIN 이내면) 2순위.
 * - 동률 정렬은 PHILOSOPHY_STYLES 순서로 안정화.
 */
export function recommendPersonas(
  rows: PersonaPerformanceRow[],
  regime: MarketRegime,
): PersonaRecommendation {
  const order = new Map<PhilosophyStyle, number>();
  PHILOSOPHY_STYLES.forEach((s, i) => order.set(s, i));
  const byStyle = new Map<PhilosophyStyle, PersonaPerformanceRow>();
  for (const r of rows) byStyle.set(r.style, r);

  const ranked: RankedPersona[] = PHILOSOPHY_STYLES.map((style) => {
    const row =
      byStyle.get(style) ??
      ({
        style,
        cumulativeReturnPct: 0,
        mddPct: null,
        hitRatePct: 0,
        sampleSize: 0,
      } as PersonaPerformanceRow);
    const regimeFit = regimeFitScore(style, regime);
    const perf = performanceScore(row);
    const perfReliable = row.sampleSize >= PERF_RELIABLE_SAMPLE;
    const composite = perfReliable
      ? 0.5 * regimeFit + 0.5 * perf
      : 0.75 * regimeFit + 0.25 * perf;
    return {
      style,
      label: STYLE_LABELS[style],
      archetype: PERSONA_ARCHETYPE[style],
      regimeFitScore: regimeFit,
      performanceScore: perf,
      compositeScore: composite,
      lowSample: !perfReliable,
      sampleSize: row.sampleSize,
      recommended: false,
      rationale: buildRationale(style, regime, regimeFit, perfReliable, row),
    };
  });

  ranked.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) {
      return b.compositeScore - a.compositeScore;
    }
    return (order.get(a.style) ?? 0) - (order.get(b.style) ?? 0);
  });

  const recommended: PhilosophyStyle[] = [];
  if (ranked.length > 0) {
    ranked[0].recommended = true;
    recommended.push(ranked[0].style);
    if (
      ranked.length > 1 &&
      ranked[0].compositeScore - ranked[1].compositeScore <= SECOND_PICK_MARGIN
    ) {
      ranked[1].recommended = true;
      recommended.push(ranked[1].style);
    }
  }

  const allLowSample = ranked.every((r) => r.lowSample);
  return {
    ranked,
    recommended,
    dataLimited: regime.dataLimited || allLowSample,
    significantSampleThreshold: SIGNIFICANT_SAMPLE_THRESHOLD,
  };
}
