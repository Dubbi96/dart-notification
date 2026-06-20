// 1년 자동매매 백테스트 트랙레코드 응답 계약 — DAR-388 / 백엔드 DAR-385.
// 정본: backend/src/engine3-quant-market/backtest/replay/backtest-replay.service.ts
//        (BacktestTrackRecord) + ports/backtest.types.ts(PerformanceMetrics 등).
// GET /api/backtest/track-record 가 { success, data: BacktestTrackRecord | null } 를 반환.
// ★ 모든 %는 0~100 스케일(예: 승률 23.3 = 23.3%, mdd 는 음수). 비율(0~1) 아님.

/** 이벤트유형·페르소나 별 성과 묶음(byEventType / byPersona 값). */
export interface BacktestGroupMetrics {
  /** 청산 완료 거래 수 */
  trades: number;
  /** 승률 % (0~100) */
  winRate: number;
  /** 평균 실현 수익률 % */
  avgReturn: number;
  /** 누적 실현 수익률 % */
  totalReturn: number;
}

/** 실전 적용 게이트(체리피킹 방지용 자기검증 플래그). */
export interface BacktestRealWorldGate {
  allMarketConditions: boolean;
  netPositiveAfterCost: boolean;
  diversified: boolean;
  sufficientSamples: boolean;
  mddAcceptable: boolean;
  recentPeriodConsistent: boolean;
}

/** 성과 지표(PerformanceMetrics). */
export interface BacktestMetrics {
  totalReturn: number; // %
  annualizedReturn: number; // %
  winRate: number; // %
  avgWin: number; // %
  avgLoss: number; // %
  profitFactor: number;
  mdd: number; // % (음수)
  sharpe: number;
  totalTrades: number;
  wonTrades: number;
  lostTrades: number;
  avgHoldDays: number;
  monthlyReturns: Record<string, number>;
  byEventType: Record<string, BacktestGroupMetrics>;
  byPersona: Record<string, BacktestGroupMetrics>;
  realWorldGate?: BacktestRealWorldGate;
  passedGate?: boolean;
}

/** 자산곡선 1점(청산일 기준 누적 평가액). */
export interface BacktestEquityPoint {
  /** 청산일 YYYY-MM-DD */
  date: string;
  /** 해당 시점 누적 평가액(원) */
  equity: number;
  /** 초기자본 대비 누적 수익률 % */
  returnPct: number;
  /** 직전 최고점 대비 낙폭 % (0 이하) */
  drawdownPct: number;
}

/** 트랙레코드 전체. */
export interface BacktestTrackRecord {
  runId: string;
  name: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  initialCapital: number;
  status: string;
  /** 리플레이에 동원된 신호 수(커버리지 정직 표기용) */
  totalSignals: number;
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  completedAt: string | null;
}
