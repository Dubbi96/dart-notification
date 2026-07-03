// Engine3 — 2단 자본 프레임 백테스트 공용 타입 (DAR-493 [견고화 W1·P16])
//
// 신규 2트랙(코어 듀얼모멘텀 월단위 / 위성 변동성돌파 일단위) 백테스트 순수 함수의 입출력 계약.
// 측정 트랙(BacktestRun) 무접촉 — 이 결과는 게이트 리포트용 휘발 산출물이다.

/** 일봉 1개(날짜 포함). date 는 YYYYMMDD(KRX·P09 market-calendar 정합). 가격은 원(KRW). */
export interface DatedBar {
  /** 거래일 YYYYMMDD (예: '20260731'). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 체결 1건(진입~청산). 비용은 수수료+거래세+슬리피지 총합(원). */
export interface BacktestTrade {
  assetCode: string;
  entryDate: string;
  entryPrice: number; // 슬리피지 반영 체결가
  shares: number;
  exitDate: string | null;
  exitPrice: number | null; // 슬리피지 반영 청산가
  costs: number; // 총 비용(진입+청산 수수료·세금·슬리피지)
  grossPnl: number | null;
  netPnl: number | null; // 비용 차감 후
  returnPct: number | null; // netPnl / 진입원금 × 100
  holdDays: number | null;
  reason: string; // 진입/청산 사유(SWITCH·BREAKOUT·NEXT_OPEN_EXIT 등)
}

/** 자산곡선 1점. */
export interface EquityPoint {
  date: string;
  equity: number;
}

/** 트랙 1개 백테스트 결과. */
export interface TrackBacktestResult {
  /** 트랙 식별(styleTag). */
  styleTag: string;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  /** 표본수 — 코어: 월말 판정 횟수 / 위성: 진입 판정한 거래일 수. */
  sampleCount: number;
  initialCapital: number;
  finalEquity: number;
}
