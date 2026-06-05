// 모의 운용 시뮬레이션 도메인 타입 (M10, DAR-40)
// AI 금지영역: 후보 선정·사이징·지표 산출은 순수 Rule. AI 개입 0.

/** 당일 모의매수 후보 (TradingSignal grade ≥ BUY_CANDIDATE) */
export interface BuyCandidate {
  tradingSignalId: string;
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  signal: 'STRONG_BUY_CANDIDATE' | 'BUY_CANDIDATE';
  buyScore: number;
  /** 진입가(다음거래일 시가 또는 당일 종가) */
  entryPrice: number;
}

/** 보유 포지션 뷰(오케스트레이터가 평가에 필요한 최소 필드) */
export interface OpenPositionView {
  positionId: string;
  corpCode: string;
  stockCode: string;
  entryPrice: number;
  quantity: number;
  entryDate: Date;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxHoldDays: number | null;
  highestPrice: number | null;
}

/** 모의매수 실행 입력 */
export interface OpenPositionInput {
  candidate: BuyCandidate;
  shares: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldDays: number;
  entryDate: Date;
}

/** 모의매도(청산) 실행 입력 */
export interface ClosePositionInput {
  position: OpenPositionView;
  exitPrice: number;
  exitDate: Date;
  exitScore: number;
  exitAction: string;
  triggerType: string | null;
  triggerTypes: string[];
}

/** 일일 시가평가 스냅샷 입력 (PositionDailySnapshot) */
export interface DailySnapshotInput {
  positionId: string;
  snapshotDate: string; // YYYYMMDD
  closePrice: number;
  quantity: number;
  positionValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  exitScore: number;
  exitAction: string;
}

/** 포트폴리오 리스크 스냅샷 입력 (PortfolioRiskSnapshot) */
export interface RiskSnapshotInput {
  portfolioId: string;
  snapshotDate: string; // YYYYMMDD
  totalValue: number;
  cashAmount: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  topPositionPct: number;
  openPositionCount: number;
}

/** 1일치 시뮬레이션 결과 요약 */
export interface DailySimulationResult {
  tradeDate: string;
  portfolioId: string;
  evaluated: number; // 평가한 보유 포지션 수
  snapshotted: number; // 적재한 일일 스냅샷 수
  exited: number; // 청산한 포지션 수
  bought: number; // 신규 모의매수 수
  skipped: number; // 후보 중 사이징/슬롯/가격 미충족으로 스킵
  openPositionCountAfter: number;
  totalValueAfter: number;
}
