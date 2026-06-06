// 모의 운용 영속 포트 (M10, DAR-40)
// 오케스트레이터는 이 포트만 의존 → 결정론적 in-memory 테스트와 Prisma 운영 어댑터 분리.

import {
  BuyCandidate,
  ClosePositionInput,
  DailySnapshotInput,
  OpenPositionInput,
  OpenPositionView,
  RiskSnapshotInput,
} from '../domain/simulation.types';
import {
  BenchmarkPoint,
  EquityPoint,
  ExitAccuracySample,
  HitRateSample,
} from '../domain/graduation-metrics.calculator';

export interface CumulativeState {
  initialCapital: number;
  currentValue: number; // 현금 + 보유 평가액
  cash: number;
  netPnlKrw: number; // 실현손익(청산 PaperTrade netPnl 합)
}

export const SIMULATION_PORT = 'SIMULATION_PORT';

export interface ISimulationPort {
  /** 시뮬 대상 포트폴리오 id 확보(없으면 생성) */
  resolveSimPortfolioId(): Promise<string>;

  /** 당일 신규 BUY 후보 수집 (grade ≥ BUY_CANDIDATE) */
  getBuyCandidates(tradeDate: string): Promise<BuyCandidate[]>;

  /** 보유(OPEN) 포지션 조회 */
  getOpenPositions(portfolioId: string): Promise<OpenPositionView[]>;

  /** 종목의 tradeDate 시점(이하 최신) 종가 — 없으면 null */
  getLatestClose(stockCode: string, tradeDate: string): Promise<number | null>;

  /** 모의매수: Position(OPEN) + PaperTrade(BUY) 영속 */
  openPosition(portfolioId: string, input: OpenPositionInput): Promise<void>;

  /** 모의매도: Position CLOSED + PaperTrade(SELL, netPnl) + ExitSignal 영속 */
  closePosition(input: ClosePositionInput): Promise<void>;

  /** 일일 시가평가 스냅샷 적재 */
  saveDailySnapshot(input: DailySnapshotInput): Promise<void>;

  /** 포트폴리오 리스크 스냅샷 적재 */
  saveRiskSnapshot(input: RiskSnapshotInput): Promise<void>;

  // ── 졸업지표 산출용 누적 데이터 ──
  getCumulativeState(portfolioId: string): Promise<CumulativeState>;
  getHitRateSamples(portfolioId: string, horizonDays: number): Promise<HitRateSample[]>;
  getExitAccuracySamples(portfolioId: string, horizonDays: number): Promise<ExitAccuracySample[]>;
  /** 누적 AI 비용(KRW 환산) */
  getAiCostKrw(usdKrwRate: number): Promise<number>;

  // ── DAR-68: 위험조정·벤치마크 산출용 ──
  /** 일별 포트폴리오 평가액 시계열(PortfolioRiskSnapshot.totalValue) — Sharpe·MDD 산출용 */
  getEquityCurve(portfolioId: string): Promise<EquityPoint[]>;
  /** 동일 기간 시장지수(KOSPI/KOSDAQ) 종가지수 표본 — 벤치마크 alpha 산출용 */
  getBenchmarkSeries(
    indexCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<BenchmarkPoint[]>;
}
