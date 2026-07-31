/**
 * M9-A 백테스트 엔진 — 공유 타입 정의
 * AI 금지영역: 이 파일의 모든 로직은 순수 Rule. AI 개입 0.
 */

export interface DailyPrice {
  date: string; // YYYY-MM-DD
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
  disclosureAt: Date; // 공시 접수 시각
  buyScore: number;
  /** AOS evaluator 기반 신호일 때 고정된 결정·귀속 정보. Legacy 신호는 생략한다. */
  signalDecisionId?: string;
  regimeKey?: string;
  passedRuleKeys?: string[];
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
  entryRule: 'NEXT_OPEN'; // lookahead bias 방지: 다음 거래일 시가 진입만 허용
  exitRules: {
    takeProfitPct: number;
    stopLossPct: number;
    trailingStopPct?: number;
    maxHoldDays: number;
  };
  sizeRule: 'EQUAL_WEIGHT' | 'SCORE_WEIGHT';
  maxPositions: number;
  initialCapital: number;
  /**
   * DAR-486: 백테스트 종료 시점에 가격이 소멸(상폐 proxy)해 청산 불가한 미청산 포지션 처리 옵션.
   * 생존편향(delisted-to-worthless 포지션이 손실로 잡히지 않아 수익률이 낙관 편향) 처리용.
   *  - 'PRESERVE'(기본·미지정): 기존 동작 — 미실현으로 보존(청산 미기록). 생존편향 잔존.
   *  - 'ZERO': 상폐 감액 — 0원 청산(전액손실 가정, 정리매매 최악 근사). 생존편향 제거(보수적).
   *  - 'LAST_PRICE': 마지막 관측 종가(정리매매 근사)로 청산. 관측 종가 전무 시 0원 폴백.
   * 기본값 미지정 = 'PRESERVE' 로 기존 백테스트 결과 무변경(측정 트랙 무영향).
   */
  delistingLiquidation?: 'PRESERVE' | 'ZERO' | 'LAST_PRICE';
}

export interface BacktestCostParams {
  commissionRate: number; // 매수·매도 각각 적용 (예: 0.00015)
  taxRate: number; // 매도 시만 (예: 0.0018)
  slippagePct: number; // 진입·청산 각각 (예: 0.003)
}

export interface SimulatedTrade {
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  eventType: string;
  persona: string;
  buyScore: number;
  signalDecisionId?: string;
  regimeKey?: string;
  passedRuleKeys?: string[];

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
  /** 진입 이후 일봉 저가/고가 기준 최대 불리·유리 변동률. */
  maxAdverseExcursionPct?: number;
  maxFavorableExcursionPct?: number;

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
  | 'FORCE_EXIT'
  // DAR-486: 상폐(가격 소멸) 확정 감액 청산 — delistingLiquidation 옵션(ZERO/LAST_PRICE) 활성 시.
  | 'DELISTED';

export interface PerformanceMetrics {
  totalReturn: number; // %
  annualizedReturn: number; // %
  winRate: number; // % — 승률 = 순손익>0 거래 / 전체 청산 거래(본전 0원은 분모에만 포함)
  avgWin: number; // %
  avgLoss: number; // % — 순손익<0 거래 평균(본전 제외)
  profitFactor: number;
  mdd: number; // % (음수)
  sharpe: number;
  totalTrades: number;
  wonTrades: number; // 순손익 > 0
  lostTrades: number; // 순손익 < 0 (본전 0원은 승·패 어느 쪽도 아님 — engine5 성적표와 통일)
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
  allMarketConditions: boolean; // 상승·하락·횡보 3구간 모두 포함
  netPositiveAfterCost: boolean; // 비용 반영 후 수익 > 0
  diversified: boolean; // 한두 종목 의존 아님
  sufficientSamples: boolean; // 이벤트별 표본 충분 (≥10)
  mddAcceptable: boolean; // MDD ≤ -15%
  recentPeriodConsistent: boolean; // 최근 구간도 일관성
}
