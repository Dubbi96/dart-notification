// 분봉 단타(intraday scalp) 모의전략 도메인 타입 — DAR-416 (BE: DAR-411 / DAR-416).
// GET /paper-trading/simulation/intraday-scalp/status 응답과 1:1.
// GET /paper-trading/simulation/intraday-scalp/trade-history 응답과 1:1.
// ★ 일봉 4종 전략(DAR-404/405)과 별개 축 — forward-only(당일 진입·당일 청산, 백테스트 불가).
//   화면은 backtestable:false 를 '실시간 모의·당일청산·백테스트 불가'로 명확히 고지한다.

/** 단타 자산곡선 1점 — forward 누적(tradeDate·실현손익·누적수익률). */
export interface ScalpEquityPoint {
  /** 거래일(YYYYMMDD). DAR-412 flat-fill 앵커일 포함. */
  tradeDate: string;
  /** 해당 거래일 실현손익 합(원). 앵커일은 0. */
  realizedPnl: number;
  /** 초기자본 대비 누적 수익률(%). */
  cumulativeReturnPct: number;
}

/** 단타 트랙 현황 — GET /intraday-scalp/status 와 1:1. */
export interface ScalpStatus {
  /** 트랙 식별 태그(intraday-scalp). */
  styleTag: string;
  strategyKey: string;
  /** 한 줄 컨셉(거래량 폭발+돌파+VWAP 진입·당일 청산). */
  tagline: string;
  initialCapital: number;
  /** 현재 보유(OPEN) 포지션 수. */
  openPositions: number;
  /** 청산 완료 거래 수(승률·누적의 표본). */
  closedTrades: number;
  /** 실현손익 합(원). */
  realizedPnl: number;
  /** 승률(0~1 비율, closedTrades 기준). */
  winRate: number;
  /** 초기자본 대비 누적 수익률(%). */
  cumulativeReturnPct: number;
  /** 청산 표본 < 임계 — 과신 방지. */
  lowSample: boolean;
  /** 저표본 임계(거래 수). */
  lowSampleThreshold: number;
  /** ★항상 false — 분봉 단타는 백테스트 불가(forward-only). */
  backtestable: false;
  /** forward 자산곡선(오름차순; 0·1개도 정직하게). */
  equityCurve: ScalpEquityPoint[];
}

/** 단타 청산 사유 — BE ScalpExitReason 3종. OPEN 이면 null. */
export type ScalpExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'FORCE_CLOSE_EOD';

/** 단타 거래 1행(드릴다운 타임라인) — BE ScalpTradeRow 와 1:1. */
export interface ScalpTrade {
  /** 행 식별자(IntradayScalpTrade id). */
  id: string;
  stockCode: string;
  /** 종목명(없으면 stockCode 폴백). */
  corpName: string;
  /** 거래일(YYYYMMDD). */
  tradeDate: string;
  /** 진입 시각(ISO 8601). */
  entryTs: string;
  /** 청산 시각(ISO 8601) — OPEN 이면 null. */
  exitTs: string | null;
  /** 진입 사유 태그(VOLUME_BREAKOUT_VWAP). */
  entryReason: string;
  /** 청산 사유 — OPEN 이면 null. */
  exitReason: ScalpExitReason | null;
  entryPrice: number;
  /** 청산가 — OPEN 이면 null. */
  exitPrice: number | null;
  /** 순수익률(%) — OPEN 이면 null. */
  returnPct: number | null;
  /** 순손익(원) — OPEN 이면 null. */
  netPnl: number | null;
  /** 포지션 상태. */
  status: 'OPEN' | 'CLOSED';
}

/** 단타 거래 타임라인 응답 — GET /intraday-scalp/trade-history 와 1:1. */
export interface ScalpTradeHistory {
  styleTag: string;
  strategyKey: string;
  tagline: string;
  /** 거래 타임라인(최신 진입순). */
  trades: ScalpTrade[];
}
