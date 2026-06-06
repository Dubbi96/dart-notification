// 철학 스타일별 모의운용 성과 비교 도메인 타입 — DAR-76 (P-D).
// GET /api/paper-trading/simulation/styles/comparison 응답과 1:1.
// 백엔드 PhilosophyStyleSimulationService.getStyleComparison / StyleComparison 과 동기화.

import type { EquityCurvePoint } from '@app-types/simulation.types';
import type { TradeScorecard } from '@app-types/trade-rationale.types';

/** 분기 운용 대상 4개 거장 스타일(philosophyId). */
export type PhilosophyStyle = 'BUFFETT' | 'LYNCH' | 'GREENBLATT' | 'DRUCKENMILLER';

/** 졸업지표 비교 요약(스타일 비교용 핵심 발췌). */
export interface StyleGraduationSummary {
  /** 신호 적중률(D+5, 0~100%) — 표본 0이면 0 */
  hitRatePct: number;
  hitRateSampleSize: number;
  /** Sharpe(연환산) — 표본 부족이면 null */
  sharpe: number | null;
  /** 최대낙폭 MDD(%, 0 이하) — 표본 부족이면 null */
  mddPct: number | null;
  /** 벤치마크(KOSPI) 대비 초과수익 alpha(%p) — 측정 불가면 null */
  benchmarkAlphaPct: number | null;
}

/** 스타일 1종의 성과 비교 행. */
export interface StylePerformance {
  style: PhilosophyStyle;
  /** 한글 라벨(버핏·린치·그린블라트·드러켄밀러) */
  label: string;
  portfolioId: string;
  initialCapital: number;
  /** 일별 자산곡선(오름차순; 0·1개도 정직하게 그대로) */
  equityCurve: EquityCurvePoint[];
  latestSnapshotDate: string | null;
  /** 청산 성적표(승률·평균손익·누적수익률·표본) */
  scorecard: TradeScorecard;
  /** 졸업지표 요약 */
  graduation: StyleGraduationSummary;
  /** 보유(OPEN) 포지션 수 */
  openPositions: number;
  /** 과신 방지 — 청산 표본 < 임계 */
  lowSample: boolean;
}

/** 스타일 비교 랭킹. */
export interface StyleRanking {
  /** 누적수익률 내림차순 스타일 목록(전체) */
  ranking: PhilosophyStyle[];
  /** 표본 있는 스타일 중 최고 수익률(없으면 null) */
  bestStyle: PhilosophyStyle | null;
  /** 표본 있는 스타일이 모두 LOW_SAMPLE 이면 true(과신 금지) */
  allLowSample: boolean;
}

/** 스타일 비교 응답 — GET /paper-trading/simulation/styles/comparison 와 1:1. */
export interface StyleComparison {
  initialCapital: number;
  styles: StylePerformance[];
  ranking: StyleRanking;
  /** 표본 부족 임계 */
  lowSampleThreshold: number;
  /** 스타일 진입 최소 적합도(0~100) */
  minEntryFit: number;
}
