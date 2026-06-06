// 인메모리 시뮬레이션 포트 어댑터 (테스트용, M10 DAR-40)
// 결정론적 단위 테스트에서 buy→snapshot→exit→metrics 한 사이클을 DB 없이 재현.

import { simulateFill, DEFAULT_FILL_PARAMS } from '../../domain/fill-simulator';
import {
  BuyCandidate,
  ClosePositionInput,
  DailySnapshotInput,
  FunnelDaily,
  FunnelSnapshotInput,
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
import { CumulativeState, ISimulationPort } from '../ports/simulation.port';

interface MemPosition extends OpenPositionView {
  status: 'OPEN' | 'CLOSED';
}

export interface InMemorySeed {
  portfolioId?: string;
  initialCapital: number;
  /** tradeDate → 후보 목록 */
  candidatesByDate?: Record<string, BuyCandidate[]>;
  /** stockCode → 평가 종가 (getLatestClose 응답) */
  closeByStock?: Record<string, number>;
  aiCostKrw?: number;
  /** 모의운용 시작일(ISO) — 미지정이면 null(운용 시작 전) (DAR-86) */
  startDate?: string | null;
  /** tradeDate → 당일 생성 신호 수 (DAR-109 퍼널 최상단). 미지정 시 후보 수로 폴백 */
  signalCountByDate?: Record<string, number>;
}

let SEQ = 0;

export class InMemorySimulationAdapter implements ISimulationPort {
  readonly portfolioId: string;
  private readonly initialCapital: number;
  private cash: number;
  private realizedPnl = 0;
  private positions: MemPosition[] = [];
  private candidatesByDate: Record<string, BuyCandidate[]>;
  private closeByStock: Record<string, number>;
  private aiCostKrw: number;

  // 기록(검증용)
  readonly dailySnapshots: DailySnapshotInput[] = [];
  readonly riskSnapshots: RiskSnapshotInput[] = [];
  readonly closes: ClosePositionInput[] = [];
  private hitSamples: HitRateSample[] = [];
  private exitSamples: ExitAccuracySample[] = [];
  private equityCurve: EquityPoint[] = [];
  private benchmarkByCode: Record<string, BenchmarkPoint[]> = {};
  private startDate: string | null;
  private signalCountByDate: Record<string, number>;
  // DAR-109: 퍼널 일별 스냅샷(멱등 — tradeDate 키 upsert, 검증용 노출)
  private readonly funnelByDate = new Map<string, FunnelSnapshotInput>();

  constructor(seed: InMemorySeed) {
    this.portfolioId = seed.portfolioId ?? 'sim-portfolio';
    this.initialCapital = seed.initialCapital;
    this.cash = seed.initialCapital;
    this.candidatesByDate = seed.candidatesByDate ?? {};
    this.closeByStock = seed.closeByStock ?? {};
    this.aiCostKrw = seed.aiCostKrw ?? 0;
    this.startDate = seed.startDate ?? null;
    this.signalCountByDate = seed.signalCountByDate ?? {};
  }

  setStartDate(startDate: string | null): void {
    this.startDate = startDate;
  }

  /** 종목 평가가 설정(테스트에서 가격 변동 주입) */
  setClose(stockCode: string, price: number): void {
    this.closeByStock[stockCode] = price;
  }

  setHitRateSamples(samples: HitRateSample[]): void {
    this.hitSamples = samples;
  }

  setExitAccuracySamples(samples: ExitAccuracySample[]): void {
    this.exitSamples = samples;
  }

  setEquityCurve(points: EquityPoint[]): void {
    this.equityCurve = points;
  }

  setBenchmarkSeries(indexCode: string, points: BenchmarkPoint[]): void {
    this.benchmarkByCode[indexCode] = points;
  }

  async resolveSimPortfolioId(): Promise<string> {
    return this.portfolioId;
  }

  async getBuyCandidates(tradeDate: string): Promise<BuyCandidate[]> {
    return this.candidatesByDate[tradeDate] ?? [];
  }

  async getOpenPositions(_portfolioId: string): Promise<OpenPositionView[]> {
    return this.positions
      .filter((p) => p.status === 'OPEN')
      .map(({ status: _status, ...view }) => ({ ...view }));
  }

  async getLatestClose(
    stockCode: string,
    _tradeDate: string,
  ): Promise<number | null> {
    return this.closeByStock[stockCode] ?? null;
  }

  async openPosition(
    _portfolioId: string,
    input: OpenPositionInput,
  ): Promise<void> {
    const fill = simulateFill(
      {
        direction: 'BUY',
        orderedShares: input.shares,
        entryPrice: input.candidate.entryPrice,
      },
      DEFAULT_FILL_PARAMS,
    );
    if (fill.filledShares <= 0) return;
    const cost =
      fill.filledPrice * fill.filledShares + fill.commission + fill.tax;
    this.cash -= cost;
    this.positions.push({
      positionId: `pos-${++SEQ}`,
      corpCode: input.candidate.corpCode,
      stockCode: input.candidate.stockCode,
      entryPrice: fill.filledPrice,
      quantity: fill.filledShares,
      entryDate: input.entryDate,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
      maxHoldDays: input.maxHoldDays,
      highestPrice: fill.filledPrice,
      status: 'OPEN',
    });
  }

  async closePosition(input: ClosePositionInput): Promise<void> {
    const pos = this.positions.find(
      (p) => p.positionId === input.position.positionId && p.status === 'OPEN',
    );
    if (!pos) return;
    const fill = simulateFill(
      {
        direction: 'SELL',
        orderedShares: pos.quantity,
        entryPrice: input.exitPrice,
      },
      DEFAULT_FILL_PARAMS,
    );
    const proceeds =
      fill.filledPrice * fill.filledShares - fill.commission - fill.tax;
    const entryCost = pos.entryPrice * fill.filledShares;
    this.realizedPnl += proceeds - entryCost;
    this.cash += proceeds;
    pos.status = 'CLOSED';
    this.closes.push(input);
  }

  async saveDailySnapshot(input: DailySnapshotInput): Promise<void> {
    this.dailySnapshots.push(input);
  }

  async saveRiskSnapshot(input: RiskSnapshotInput): Promise<void> {
    this.riskSnapshots.push(input);
  }

  // ── DAR-109: 신호→진입 퍼널 ──
  async getDailySignalCount(tradeDate: string): Promise<number> {
    // 명시 시드 우선, 없으면 당일 후보 수로 폴백(테스트 결정론 유지).
    return (
      this.signalCountByDate[tradeDate] ??
      (this.candidatesByDate[tradeDate]?.length ?? 0)
    );
  }

  async saveFunnelSnapshot(input: FunnelSnapshotInput): Promise<void> {
    // 멱등: 동일 거래일 재실행은 덮어쓴다(중복 없음).
    this.funnelByDate.set(input.tradeDate, { ...input });
  }

  async getFunnelHistory(_portfolioId: string): Promise<FunnelDaily[]> {
    return [...this.funnelByDate.values()]
      .map((f) => ({
        tradeDate: f.tradeDate,
        signalsGenerated: f.signalsGenerated,
        candidatesPassed: f.candidatesPassed,
        filled: f.filled,
      }))
      .sort((a, b) =>
        a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0,
      );
  }

  async getSimulationStartDate(_portfolioId: string): Promise<string | null> {
    return this.startDate;
  }

  async getCumulativeState(_portfolioId: string): Promise<CumulativeState> {
    let holdingsValue = 0;
    for (const p of this.positions.filter((x) => x.status === 'OPEN')) {
      const price = this.closeByStock[p.stockCode] ?? p.entryPrice;
      holdingsValue += price * p.quantity;
    }
    return {
      initialCapital: this.initialCapital,
      currentValue: this.cash + holdingsValue,
      cash: this.cash,
      netPnlKrw: this.realizedPnl,
    };
  }

  async getHitRateSamples(
    _portfolioId: string,
    _horizonDays: number,
  ): Promise<HitRateSample[]> {
    return this.hitSamples;
  }

  async getExitAccuracySamples(
    _portfolioId: string,
    _horizonDays: number,
  ): Promise<ExitAccuracySample[]> {
    return this.exitSamples;
  }

  async getAiCostKrw(_usdKrwRate: number): Promise<number> {
    return this.aiCostKrw;
  }

  async getEquityCurve(_portfolioId: string): Promise<EquityPoint[]> {
    return this.equityCurve;
  }

  async getBenchmarkSeries(
    indexCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<BenchmarkPoint[]> {
    return (this.benchmarkByCode[indexCode] ?? [])
      .filter((p) => p.tradeDate >= fromDate && p.tradeDate <= toDate)
      .sort((a, b) =>
        a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0,
      );
  }
}
