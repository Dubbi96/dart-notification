// 포트폴리오·포지션·Thesis·모의투자 도메인 타입 계약.
// ⚠️ 포지션/포트폴리오/모의투자 엔드포인트는 아직 미존재(DAR-22).
// 계약을 고정하고, 실제 응답이 생기면 그대로 연동한다.

export type ThesisStatus = 'ACTIVE' | 'WATCHING' | 'VIOLATED' | 'EXPIRED';

/** 보유 포지션 */
export interface Position {
  id: string;
  portfolioId: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  /** 손익률(%) */
  pnlPercent: number;
  thesisStatus: ThesisStatus;
  quantity?: number;
  avgPrice?: number;
  currentPrice?: number;
}

/** 포트폴리오 요약(실전) */
export interface PortfolioSummary {
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  mddPercent?: number;
  /** 오늘 손실 한도 잔여(%) */
  dailyLossLimitRemaining?: number;
  /** MDD/손실 한도 초과 경고 */
  mddBreached?: boolean;
}

/** Thesis 진입 논리 / 훼손 조건 항목 */
export interface ThesisCondition {
  id: string;
  label: string;
  /** 훼손 조건의 경우 위반 여부, 진입 논리의 경우 충족 여부 */
  violated: boolean;
}

/** 청산 룰(읽기 전용 — 시스템 관리 안전 한도) */
export interface ExitRule {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  maxHoldingDays: number;
}

/** Position Thesis 상세 */
export interface PositionThesis {
  positionId: string;
  corpName: string;
  personaType?: string;
  status: ThesisStatus;
  entryLogic: ThesisCondition[];
  violationConditions: ThesisCondition[];
  exitRules: ExitRule;
  triggerDisclosureRcpNo?: string;
}

/** 모의투자 체결 이력 */
export interface PaperTrade {
  id: string;
  /** ISO 8601 */
  date: string;
  corpName: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
}

/** 모의투자 포트폴리오 */
export interface PaperPortfolio {
  totalAsset: number;
  totalPnl: number;
  totalPnlPercent: number;
  /** ISO 8601 — 시작일 */
  startedAt: string;
  elapsedDays: number;
  /** 신호 적중률 0~1 */
  signalHitRate?: number;
  signalHitCount?: number;
  signalTotalCount?: number;
  avgHoldingDays?: number;
  positions: Position[];
  trades: PaperTrade[];
  /** 모의투자 시작 여부 */
  started: boolean;
}
