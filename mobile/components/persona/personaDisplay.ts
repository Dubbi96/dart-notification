// persona·시장 레짐 표시용 한글 라벨/포맷 — DAR-131.
// 백엔드 결정론적 분류값을 화면 카피로 변환(과신 카피 금지·참고 라벨 전제).

import type {
  TrendRegime,
  VolatilityRegime,
  EventSkew,
} from '@app-types/persona.types';
import type { PhilosophyStyle } from '@app-types/style-comparison.types';

// ── 비교 강조 어휘(DAR-205) ───────────────────────────────────────────────
// selectedPersona는 신호 큐레이션/홈/추천을 바꾸지 않는다(소비처가 전부 표시용 하이라이트).
// '선택'이라는 어휘는 "고르면 결과가 바뀐다"는 오약속을 만든다 → 실제 동작(비교 화면에서 해당
// persona를 강조)에 맞춰 '비교 강조' 어휘로 약화한다. (M11+ 정책: 실주문/자동매매 미연동.)
// 이 상수가 persona 강조 카피의 단일 출처다 — 화면들은 여기서만 문구를 가져온다.
export const PERSONA_EMPHASIS = {
  /** 카드 탭 동작 안내(목록 헤더). */
  cardActionHint: '카드를 탭하면 비교에서 강조됩니다',
  /** 강조 중 카드 하단 바 라벨. */
  emphasizedBar: '비교 기준으로 강조 중',
  /** 강조 바 진입 라벨(footer). */
  emphasizedTitle: '비교 기준 persona (모의운용)',
  /** 강조 해제 액션 라벨. */
  clearAction: '강조 해제',
  /** a11y: 카드 동작(강조 토글). */
  a11yAction: '비교 기준으로 강조',
  /** a11y: 현재 강조됨 상태. */
  a11yEmphasized: '비교 기준으로 강조됨',
} as const;

/**
 * persona 비교 강조 토글(순수, DAR-205). 같은 persona 재탭 시 강조 해제, 다르면 강조 전환.
 * 화면들의 handleSelect 중복 분기를 단일 순수 함수로 모은다.
 */
export function nextPersonaEmphasis(
  current: PhilosophyStyle | null,
  tapped: PhilosophyStyle,
): PhilosophyStyle | null {
  return current === tapped ? null : tapped;
}

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
