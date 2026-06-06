// 모의 매매 사유 추적 + 성적표 도메인 타입 계약 — DAR-64.
// GET /api/paper-trading/simulation/trade-history 응답과 1:1.
// 백엔드 trade-scorecard.ts (TradeRationale/TradeScorecard) 와 동기화.

/** 매매 사유 카드 1행 (OPEN+CLOSED) */
export interface TradeRationale {
  positionId: string;
  corpCode: string;
  stockCode: string;
  /** 회사명(없으면 null → 종목코드 대체) */
  corpName: string | null;
  status: 'OPEN' | 'CLOSED';
  /** 진입일 ISO */
  entryDate: string;
  entryPrice: number;
  quantity: number;
  /** 청산일 ISO (OPEN 이면 null) */
  exitDate: string | null;
  /** 손익(원) — OPEN=평가, CLOSED=실현 */
  pnl: number;
  /** 수익률(%) — OPEN=평가, CLOSED=실현 */
  pnlPct: number;
  /** 보유일수 (CLOSED 이고 두 일자 있으면, 아니면 null) */
  holdDays: number | null;
  /** 진입 사유 한 문장 (없으면 null → '근거 기록 없음') */
  entryReason: string | null;
  /** 진입 근거 칩(점수버킷·조건충족·룰) */
  entryBasis: string[];
  /** 청산 액션 enum (OPEN 이면 null) */
  exitAction: string | null;
  /** 청산 트리거 enum 배열 */
  exitTriggers: string[];
  /** 진입 신호 eventType (없으면 null) — DAR-73 차원 */
  eventType: string | null;
  /** 진입 신호 등급 SignalGrade (없으면 null) — DAR-73 차원 */
  signalGrade: string | null;
}

/** 차원별(eventType / signalGrade) 성적표 한 행 — DAR-73 */
export interface DimensionScorecard {
  /** 그룹 키 (eventType 값·등급명·또는 'UNKNOWN') */
  key: string;
  scorecard: TradeScorecard;
}

/** 매매 성적표 — CLOSED 누적 집계 */
export interface TradeScorecard {
  closedCount: number;
  winCount: number;
  lossCount: number;
  /** 승률 0~1. 표본 0이면 null */
  winRate: number | null;
  /** 평균 실현손익(원) */
  avgPnl: number;
  /** 평균 실현수익률(%) */
  avgPnlPct: number;
  /** 평균 보유일수. 표본 0이면 null */
  avgHoldDays: number | null;
  /** 누적 실현손익(원) */
  totalNetPnl: number;
  /** 누적 수익률(%) */
  cumulativeReturnPct: number;
  /** 표본 수 */
  sampleSize: number;
  /** 표본 부족(과신방지 배지) */
  lowSample: boolean;
}

/** 매매 사유 추적 + 성적표 응답 */
export interface TradeHistory {
  portfolioId: string;
  initialCapital: number;
  scorecard: TradeScorecard;
  /** eventType 별 성적표(CLOSED, 표본 많은 순) — DAR-73 */
  byEventType: DimensionScorecard[];
  /** signalGrade 별 성적표(CLOSED, 표본 많은 순) — DAR-73 */
  bySignalGrade: DimensionScorecard[];
  /** 진입일 최신순 */
  trades: TradeRationale[];
}
