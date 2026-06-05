// 모의 운용 시뮬레이션 파라미터 (M10, DAR-40)
// AI 금지영역: 모든 한도/사이징 파라미터는 고정 Rule. AI 개입 0.

export interface SimulationConfig {
  /** 초기 모의 자본금 (KRW) */
  initialCapital: number;
  /** 관심 종목(동시 보유) 상한 */
  maxWatchlistSymbols: number;
  /** 1회 매수 최대 비율 (포지션 사이징) */
  singleBuyMaxPct: number;
  /** 신규 포지션 기본 손절 비율 (%) */
  defaultStopLossPct: number;
  /** 신규 포지션 기본 익절 비율 (%) */
  defaultTakeProfitPct: number;
  /** 신규 포지션 최대 보유일 */
  defaultMaxHoldDays: number;
  /** 적중률(G1) 평가 지평 — 거래일 */
  hitRateHorizonDays: number;
  /** Exit 정확도(G5) 평가 지평 — 거래일 */
  exitAccuracyHorizonDays: number;
  /** AI 비용(USD→KRW) 환산 환율 (G3) */
  usdKrwRate: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  initialCapital: 100_000_000, // 1억
  maxWatchlistSymbols: 50,
  singleBuyMaxPct: 0.03, // 3% (Risk 하드룰 singleBuyMaxPct와 일치)
  defaultStopLossPct: 15.0, // Portfolio.stopLossGlobalPct 기본값과 일치
  defaultTakeProfitPct: 20.0,
  defaultMaxHoldDays: 20,
  hitRateHorizonDays: 5, // D+5
  exitAccuracyHorizonDays: 3, // D+3
  usdKrwRate: 1350,
};
