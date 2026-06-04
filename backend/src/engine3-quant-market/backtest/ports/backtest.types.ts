/**
 * M9-A 백테스트 엔진 — 공유 타입 정의
 * AI 금지영역: 이 파일의 모든 로직은 순수 Rule. AI 개입 0.
 */

export interface DailyPrice {
  date: string;        // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isLimitUp?: boolean;
  isLimitDown?: boolean;
  isTradingSuspended?: boolean;
  isAdminStock?: boolean;
}

export interface DisclosureSignal {
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  eventType: string;
  persona: string;
  disclosureAt: Date;   // 공시 접수 시각
  buyScore: number;
  exitRules?: {
    takeProfitPct?: number;
    stopLossPct?: number;
    trailingStopPct?: number;
    maxHoldDays?: number;
  };
}

export interface StrategyParams {
  eventTypes?: string[];
  personas?: string[];
  minBuyScore: number;
  entryRule: 'NEXT_OPEN';  // lookahead bias 방지: 다음 거래일 시가 진입만 허용
  exitRules: {
    takeProfitPct: number;
    stopLossPct: number;
    trailingStopPct?: number;
    maxHoldDays: number;
  };
  sizeRule: 'EQUAL_WEIGHT' | 'SCORE_WEIGHT';
  maxPositions: number;
  initialCapital: number;
}

export interface BacktestCostParams {
  commissionRate: number;  // 매수·매도 각각 적용 (예: 0.00015)
  taxRate: number;         // 매도 시만 (예: 0.0018)
  slippagePct: number;     // 진입·청산 각각 (예: 0.003)
}

export interface SimulatedTrade {
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  eventType: string;
  persona: string;
  buyScore: number;

  disclosureAt: Date;
  isAfterMarket: boolean;
  entryDate: Date;
  entryPrice: number;
  entryShares: number;
  entryValue: number;

  exitDate?: Date;
  exitPrice?: number;
  exitShares?: number;
  exitValue?: number;
  exitReason?: ExitReasonType;

  commission: number;
  tax: number;
  slippage: number;

  grossPnl?: number;
  netPnl?: number;
  returnPct?: number;
  holdDays?: number;

  wasLimitUp: boolean;
  wasLimitDown: boolean;
  wasTradingSuspended: boolean;
  wasAdminStock: boolean;
  isPartialFill: boolean;
  fillRate?: number;
  lowLiquidityFlag: boolean;
}

export type ExitReasonType =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'THESIS_BREAK'
  | 'MAX_HOLD_DAYS'
  | 'CHART_BREAK'
  | 'LIQUIDITY_EXIT'
  | 'FORCE_EXIT';

export interface PerformanceMetrics {
  totalReturn: number;          // %
  annualizedReturn: number;     // %
  winRate: number;              // %
  avgWin: number;               // %
  avgLoss: number;              // %
  profitFactor: number;
  mdd: number;                  // % (음수)
  sharpe: number;
  totalTrades: number;
  wonTrades: number;
  lostTrades: number;
  avgHoldDays: number;
  monthlyReturns: Record<string, number>;
  byEventType: Record<string, EventTypeMetrics>;
  byPersona: Record<string, EventTypeMetrics>;
  worstTrades: WorstTrade[];
  realWorldGate: RealWorldGate;
  passedGate: boolean;
}

export interface EventTypeMetrics {
  trades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
}

export interface WorstTrade {
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  netPnl: number;
  returnPct: number;
  entryDate: string;
  exitDate?: string;
  exitReason?: ExitReasonType;
}

export interface RealWorldGate {
  allMarketConditions: boolean;   // 상승·하락·횡보 3구간 모두 포함
  netPositiveAfterCost: boolean;  // 비용 반영 후 수익 > 0
  diversified: boolean;           // 한두 종목 의존 아님
  sufficientSamples: boolean;     // 이벤트별 표본 충분 (≥10)
  mddAcceptable: boolean;         // MDD ≤ -15%
  recentPeriodConsistent: boolean; // 최근 구간도 일관성
}
