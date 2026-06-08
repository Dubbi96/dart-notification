// persona별 모의운용 성과 + 현재 장 적합 persona 추천 도메인 타입 — DAR-131 (P-D).
// GET /api/paper-trading/personas 응답과 1:1.
// 백엔드 PersonaTradingService.getOverview / PersonaOverview(DAR-130)와 동기화.

import type {
  PhilosophyStyle,
  StylePerformance,
} from '@app-types/style-comparison.types';

/** 추세 레짐 — 윈도 기간 지수 변화율 기준(백엔드 TrendRegime와 1:1). */
export type TrendRegime = 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
/** 변동성 레짐 — 일별 수익률 표준편차 기준. */
export type VolatilityRegime = 'HIGH' | 'NORMAL' | 'LOW';
/** 이벤트 분포 편향 — 공시 극성 분포 기준. */
export type EventSkew = 'RISK_HEAVY' | 'OPPORTUNITY' | 'BALANCED';

/** 공시 극성 분포 카운트. */
export interface EventPolarityCounts {
  positive: number;
  negative: number;
  mixed: number;
  unknown: number;
}

/** 현재 시장 레짐(추세·변동성·이벤트분포) — 백엔드 MarketRegime와 1:1. */
export interface MarketRegime {
  trend: TrendRegime;
  volatility: VolatilityRegime;
  eventSkew: EventSkew;
  /** 윈도 기간 지수 누적 변화율(%) — 표본 부족이면 null. */
  trendChangePct: number | null;
  /** 일별 수익률 표준편차(%) — 표본 부족이면 null. */
  dailyVolatilityPct: number | null;
  indexSampleSize: number;
  eventSampleSize: number;
  eventPolarity: EventPolarityCounts;
  /** 추세·변동성을 분류할 만큼 지수 표본이 충분한지. */
  classifiable: boolean;
  /** 표본 < 30 → 미유의(과신 금지). */
  dataLimited: boolean;
  asOf: string | null;
}

/** persona 1종의 성과 + 추천 정보 결합 행. */
export interface PersonaOverviewRow {
  /** 기반 스타일 성과(자산곡선·성적표·졸업지표·lowSample). */
  performance: StylePerformance;
  /** 투자 아키타입(VALUE·GROWTH·QUANTITATIVE·MACRO). */
  archetype: string;
  /** 현재 장 적합도(0~100, 순수 Rule). */
  regimeFitScore: number;
  /** 레짐 적합도 + 성과 복합점수(0~100). */
  compositeScore: number;
  /** 현재 장 추천 대상 여부(1~2순위). */
  recommended: boolean;
  /** 추천/판단 근거(결정론적 텍스트, 참고용). */
  rationale: string;
}

/** persona별 모의운용 종합 응답 — GET /paper-trading/personas 와 1:1. */
export interface PersonaOverview {
  initialCapital: number;
  /** 현재 시장 레짐. */
  regime: MarketRegime;
  /** 복합점수 내림차순 정렬된 persona 행(추천우선). */
  personas: PersonaOverviewRow[];
  /** 추천 persona(1~2개) style 목록. */
  recommended: PhilosophyStyle[];
  /** 표본<30 미유의 — 결론 과신 금지. */
  dataLimited: boolean;
  significantSampleThreshold: number;
  /** 스타일 성과 표본 부족 임계. */
  lowSampleThreshold: number;
  /** 스타일 진입 최소 적합도(0~100). */
  minEntryFit: number;
}
