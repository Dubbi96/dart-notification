// Exit engine domain types — M8 (DAR-12)
// AI 금지영역: Exit Score·트리거·5액션은 순수 Rule. AI 개입 0.

export type CheckTime = 'PRE_MARKET' | 'INTRADAY' | 'POST_MARKET';

export type ExitAction = 'HOLD' | 'WATCH' | 'REDUCE' | 'EXIT' | 'BLOCK_REBUY';

export type ExitTriggerType =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'THESIS_INVALIDATED'
  | 'TIME_LIMIT'
  | 'CHART_BREAKDOWN'
  | 'REBALANCING';

export interface ExitScoreComponents {
  lossRiskScore: number;       // 0~20: 손실 리스크
  thesisBreakScore: number;    // 0~20: 투자논리 훼손
  chartBreakScore: number;     // 0~20: 차트 훼손
  disclosureRiskScore: number; // 0~20: 공시 악재
  overweightScore: number;     // 0~10: 과다 비중
  timeExceededScore: number;   // 0~10: 시간 초과
  positiveMomentumBonus: number; // 0~20: 긍정 모멘텀 (감산)
}

export interface ExitScoreResult {
  components: ExitScoreComponents;
  exitScore: number;
  exitAction: ExitAction;
  triggerTypes: ExitTriggerType[];
  primaryTrigger: ExitTriggerType | null;
}

// Input interfaces for pure Rule computation

export interface PositionSnapshot {
  id: string;
  corpCode: string;
  stockCode: string;
  entryPrice: number;
  quantity: number;
  entryAmount: number;
  currentPrice: number;
  highestPrice: number | null;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxHoldDays: number | null;
  entryDate: Date;
  portfolioTotalValue: number;
  portfolioMaxSinglePositionPct: number;
  portfolioMaxSectorPct: number;
  portfolioMaxDailyLossPct: number;
  portfolioDailyLossPct: number | null;
}

export interface TechnicalSnapshot {
  closePrice: number;
  openPrice: number | null;
  ma5: number | null;
  ma20: number | null;
  low20: number | null;
  vwap: number | null;
  atr14: number | null;
  volumeRatio3d: number | null; // 최근3일 평균 / 20일 평균
  excessReturn5d: number | null; // 5일 초과수익률 %
  avgVolumeRatio5d: number | null; // 최근5일 / D0~D+2 거래량 비율
}

export interface ThesisSnapshot {
  invalidConditions: Array<{ type: string; [key: string]: unknown }>;
  maxHoldDays: number | null;
}

export interface DisclosureEvent {
  type: string;
  rcpNo: string;
}

// 내부자/대량보유 지분변동 요약 (DAR-94)
// engine1 InsiderHoldingChange(DAR-87/88)를 최근 윈도우로 묶은 순매수/매도 흐름.
// engine4 격리 컨텍스트 유지를 위해 buy-signal insider.scorer 입력과 별개로 재정의한다.
// 적재/조회는 DB·큐 경유(provider)로 위임 — engine 직접호출 최소.
export interface InsiderTradeSnapshot {
  source: 'EXECUTIVE' | 'MAJOR_STOCK';
  tradeType: 'BUY' | 'SELL' | 'MIXED' | 'UNKNOWN';
  ratioChange: number | null; // 지분율 증감 %p (부호 포함, 결측 가능)
  isMajorShareholder?: boolean | null;
}

export interface InsiderFlowSnapshot {
  // 최근 윈도우(예: 90일) 내 지분변동 보고 목록. 빈 배열이면 결측(무가점).
  trades: InsiderTradeSnapshot[];
}
