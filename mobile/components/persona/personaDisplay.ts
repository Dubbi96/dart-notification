// persona·시장 레짐 표시용 한글 라벨/포맷 — DAR-131.
// 백엔드 결정론적 분류값을 화면 카피로 변환(과신 카피 금지·참고 라벨 전제).

import type {
  TrendRegime,
  VolatilityRegime,
  EventSkew,
} from '@app-types/persona.types';

export const TREND_LABEL: Record<TrendRegime, string> = {
  UPTREND: '상승추세',
  DOWNTREND: '하락추세',
  SIDEWAYS: '횡보',
};

export const VOLATILITY_LABEL: Record<VolatilityRegime, string> = {
  HIGH: '고변동성',
  NORMAL: '보통변동성',
  LOW: '저변동성',
};

export const EVENT_SKEW_LABEL: Record<EventSkew, string> = {
  RISK_HEAVY: '악재 우세',
  OPPORTUNITY: '호재 우세',
  BALANCED: '균형',
};

/** 투자 아키타입 한 줄 설명(스타일 카피, 단정 금지). */
export const ARCHETYPE_DESC: Record<string, string> = {
  VALUE: '저평가 가치주를 길게 — 횡보·하락장에서 강점',
  GROWTH: '성장주 우상향 — 상승장·호재 우세에서 강점',
  QUANTITATIVE: '체계적 정량 기준 — 레짐 중립·변동성에 강건',
  MACRO: '거시 추세 추종 — 강한 추세·고변동장에서 강점',
};

/** 적합도 점수(0~100) 정수 표기. */
export function formatFitScore(score: number): string {
  return `${Math.round(score)}점`;
}

/** 수익률(%) 부호 포함 표기. */
export function formatSignedPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
