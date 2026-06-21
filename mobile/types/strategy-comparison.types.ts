// 시스템 트레이딩 전략 변형 비교 도메인 타입 — DAR-405 (BE: DAR-404).
// GET /paper-trading/simulation/strategies/comparison 응답과 1:1.
// GET /paper-trading/simulation/strategies/:key/trade-history 응답과 1:1.
// 거장철학(DAR-76 style)·페르소나 축과 별개의 '트레이딩 로직(진입/청산/사이징 룰)' 축.
// 백엔드 StrategyComparisonService(DAR-404)와 동기화 — 두 이슈 공통 계약.

import type { EquityCurvePoint } from '@app-types/simulation.types';

/** 분기 운용 대상 4개 트레이딩 로직 변형(STRATEGY_PRESETS key). */
export type StrategyKey =
  | 'event-edge'
  | 'short-momentum'
  | 'conservative-value'
  | 'aggressive-diversified';

/**
 * 청산 사유 — BE BacktestTrade.exitReason(ExitReasonType)과 동일 8종.
 * OPEN 포지션은 null.
 */
export type StrategyExitReason =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'THESIS_BREAK'
  | 'MAX_HOLD_DAYS'
  | 'CHART_BREAK'
  | 'LIQUIDITY_EXIT'
  | 'FORCE_EXIT';

/** 전략의 진입/청산 룰 평문 요약(룰 공개용). */
export interface StrategyRules {
  /** 진입 조건 평문(예: '매수점수 70 이상 · 단기 모멘텀 이벤트'). */
  entry: string;
  /** 청산 조건 평문(예: '익절 +10% · 손절 -5% · 최대보유 5일'). */
  exit: string;
}

/** 전략 1종의 성과 비교 행. */
export interface StrategyPerformance {
  key: StrategyKey;
  /** 한글 라벨(이벤트엣지·단기모멘텀·보수가치·공격분산). */
  label: string;
  /** 한 줄 컨셉 설명. */
  tagline: string;
  initialCapital: number;
  /** 일별 자산곡선(오름차순; 0·1개도 정직하게 그대로). */
  equityCurve: EquityCurvePoint[];
  /** 누적수익률(%). */
  cumulativeReturnPct: number;
  /** 승률(0~1 비율) — 청산 표본 0이면 null. */
  winRate: number | null;
  /** 총 트레이드 수(진입 기준). */
  tradeCount: number;
  /** 청산 완료 표본 수. */
  sampleSize: number;
  /** Sharpe(연환산) — 표본 부족이면 null. */
  sharpe: number | null;
  /** 최대낙폭 MDD(%, 0 이하) — 표본 부족이면 null. */
  maxDrawdownPct: number | null;
  /** 벤치마크(KOSPI) 대비 초과수익(%p) — 측정 불가면 null. */
  benchmarkAlphaPct: number | null;
  /** 진입/청산 룰 평문. */
  rules: StrategyRules;
  /** 과신 방지 — 청산 표본 < 임계. */
  lowSample: boolean;
}

/** 전략 비교 랭킹. */
export interface StrategyRanking {
  /** 누적수익률 내림차순 전략 key 목록(전체). */
  ranking: StrategyKey[];
  /** 표본 있는 전략 중 최고 수익률(없으면 null). */
  bestKey: StrategyKey | null;
  /** 표본 있는 전략이 모두 LOW_SAMPLE 이면 true(과신 금지). */
  allLowSample: boolean;
}

/** 전략 비교 응답 — GET /strategies/comparison 와 1:1. */
export interface StrategyComparison {
  initialCapital: number;
  strategies: StrategyPerformance[];
  ranking: StrategyRanking;
  /** 표본 부족 임계. */
  lowSampleThreshold: number;
}

/** 드릴다운 매수/매도 타임라인 1행(BacktestTrade 발췌). */
export interface StrategyTrade {
  /** 행 식별자(BacktestTrade id 또는 rcpNo+stockCode). */
  id: string;
  stockCode: string;
  /** 종목명(없으면 stockCode 폴백). */
  stockName: string;
  /** 공시 이벤트유형 코드(getEventTypeLabel 로 한글화). */
  eventType: string;
  /** 매수 체결일(YYYY-MM-DD). */
  entryDate: string;
  /** 매도 체결일(YYYY-MM-DD) — OPEN 이면 null. */
  exitDate: string | null;
  entryPrice: number;
  /** 매도가 — OPEN 이면 null. */
  exitPrice: number | null;
  /** 실현 수익률(%) — OPEN 이면 null. */
  returnPct: number | null;
  /** 청산 사유 — OPEN 이면 null. */
  exitReason: StrategyExitReason | null;
  /** 보유일 — OPEN 이면 null. */
  holdDays: number | null;
  /** 포지션 상태. */
  status: 'OPEN' | 'CLOSED';
}

/** 전략 매수/매도 타임라인 응답 — GET /strategies/:key/trade-history 와 1:1. */
export interface StrategyTradeHistory {
  key: StrategyKey;
  label: string;
  tagline: string;
  rules: StrategyRules;
  /** 매수/매도 타임라인(최신 진입순). */
  trades: StrategyTrade[];
}
