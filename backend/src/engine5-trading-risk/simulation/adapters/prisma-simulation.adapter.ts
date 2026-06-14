// 모의운용 Prisma 어댑터 (M10 졸업 측정 DAR-67 / write 실구현 DAR-109)
//
// SimulationOrchestratorService + GraduationMetricsService(SIMULATION_PORT 의존)를 실제
// 모의운용 데이터에 배선한다. paper-simulation(DAR-40)이 영속화한 동일 테이블
// (Portfolio·Position·PositionDailySnapshot·PaperTrade·ExitSignal·PortfolioRiskSnapshot·
//  StockDailyPrice·TradingSignal·AIUsageLog)을 재사용한다.
//
// DAR-109: 졸업 표본(G1/G2/G5)을 막던 write/read 메서드(getBuyCandidates·getOpenPositions·
//   getLatestClose·openPosition·closePosition·saveDailySnapshot·saveRiskSnapshot)를 실구현.
//   신호→진입 퍼널(SignalEntryFunnelDaily)을 일별 누적 기록·조회한다.
// ★ 모의 전용 — 실주문 절대 금지(OrderRequest/OrderExecution 미사용). AI 개입 0(순수 Rule·
//   체결은 fill-simulator). 멱등(중복 진입 방지, 멱등 upsert). Engine5 Risk 독립.

import { Injectable } from '@nestjs/common';
import {
  ExitAction as PrismaExitAction,
  ExitTriggerType as PrismaExitTriggerType,
  Prisma,
  SignalGrade as PrismaSignalGrade,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaperSimulationService } from '../../paper-simulation/paper-simulation.service';
import {
  DEFAULT_FILL_PARAMS,
  simulateFill,
} from '../../domain/fill-simulator';
import {
  BenchmarkPoint,
  EquityPoint,
  ExitAccuracySample,
  HitRateSample,
} from '../domain/graduation-metrics.calculator';
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
import { CumulativeState, ISimulationPort } from '../ports/simulation.port';

/** 모의 포트폴리오가 아직 없을 때 사용하는 비존재 sentinel id(하위 조회는 빈 결과 → 0 지표) */
const NO_PORTFOLIO = '__no_sim_portfolio__';

/** 매수 후보 등급(STRONG_BUY_CANDIDATE/BUY_CANDIDATE) — getBuyCandidates 필터 */
const BUY_CANDIDATE_GRADES: PrismaSignalGrade[] = [
  'STRONG_BUY_CANDIDATE',
  'BUY_CANDIDATE',
];

@Injectable()
export class PrismaSimulationAdapter implements ISimulationPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 모의 포트폴리오 id 확보 — find-or-create(포트 계약 "없으면 생성").
   * 단일 시스템 모의 포트폴리오(고정 유저). write 경로(orchestrator)가 실제 포트폴리오를
   * 필요로 하므로 생성한다. 빈 포트폴리오 = 포지션 0 → 졸업지표는 sentinel 과 동일(0) 산출.
   */
  async resolveSimPortfolioId(): Promise<string> {
    let user = await this.prisma.user.findFirst({
      where: { email: PaperSimulationService.SIM_USER_EMAIL },
      select: { id: true },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: PaperSimulationService.SIM_USER_EMAIL, provider: 'system' },
        select: { id: true },
      });
    }
    let pf = await this.prisma.portfolio.findFirst({
      where: { userId: user.id, name: PaperSimulationService.SIM_PORTFOLIO_NAME },
      select: { id: true },
    });
    if (!pf) {
      pf = await this.prisma.portfolio.create({
        data: {
          userId: user.id,
          name: PaperSimulationService.SIM_PORTFOLIO_NAME,
          maxSinglePositionPct: 10,
        },
        select: { id: true },
      });
    }
    return pf.id;
  }

  /** 모의운용 시작일 — 가장 이른 포지션 진입일(entryDate). 포지션 없으면 null(운용 시작 전) (DAR-86) */
  async getSimulationStartDate(portfolioId: string): Promise<string | null> {
    if (portfolioId === NO_PORTFOLIO) return null;
    const first = await this.prisma.position.findFirst({
      where: { portfolioId },
      orderBy: { entryDate: 'asc' },
      select: { entryDate: true },
    });
    return first?.entryDate ? first.entryDate.toISOString() : null;
  }

  /** G2/G3 누적 상태 — 초기원금 + 실현/미실현 손익으로 평가자산·순익 산출 */
  async getCumulativeState(portfolioId: string): Promise<CumulativeState> {
    const initialCapital = PaperSimulationService.INITIAL_CAPITAL;
    if (portfolioId === NO_PORTFOLIO) {
      return { initialCapital, currentValue: initialCapital, cash: initialCapital, netPnlKrw: 0 };
    }
    const [open, closed] = await Promise.all([
      this.prisma.position.findMany({
        where: { portfolioId, status: 'OPEN' },
        select: { entryPrice: true, quantity: true, unrealizedPnl: true, currentValue: true },
      }),
      this.prisma.position.findMany({
        where: { portfolioId, status: 'CLOSED' },
        select: { unrealizedPnl: true },
      }),
    ]);
    const unrealizedPnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const realizedNetPnl = closed.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const holdingsValue = open.reduce(
      (s, p) => s + (p.currentValue ?? p.entryPrice * p.quantity),
      0,
    );
    const currentValue = initialCapital + realizedNetPnl + unrealizedPnl;
    return {
      initialCapital,
      currentValue,
      cash: currentValue - holdingsValue,
      netPnlKrw: realizedNetPnl,
    };
  }

  /** G1 적중률(D+N) — 포지션별 일일 스냅샷 D0..D+N 의 진입가 대비 D+N 수익률 표본 */
  async getHitRateSamples(
    portfolioId: string,
    horizonDays: number,
  ): Promise<HitRateSample[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const positions = await this.prisma.position.findMany({
      where: { portfolioId },
      select: { id: true, entryPrice: true },
    });
    // DAR-206: 포지션별 스냅샷 findMany(N+1) → positionId in(...) 단일 조회 후 메모리 그룹핑.
    const eligible = positions.filter((p) => p.entryPrice > 0);
    const take = horizonDays + 1;
    const snapsByPosition = new Map<string, Array<number | null>>();
    if (eligible.length > 0) {
      const rows = await this.prisma.positionDailySnapshot.findMany({
        where: { positionId: { in: eligible.map((p) => p.id) } },
        orderBy: [{ positionId: 'asc' }, { snapshotDate: 'asc' }],
        select: { positionId: true, closePrice: true },
      });
      for (const row of rows) {
        const arr = snapsByPosition.get(row.positionId) ?? [];
        if (arr.length < take) {
          arr.push(row.closePrice);
          snapsByPosition.set(row.positionId, arr);
        }
      }
    }
    const samples: HitRateSample[] = [];
    for (const p of eligible) {
      const snaps = snapsByPosition.get(p.id) ?? [];
      const dn = snaps.length >= take ? snaps[horizonDays] : null;
      if (dn !== null && dn !== undefined) {
        samples.push({ returnPct: ((dn - p.entryPrice) / p.entryPrice) * 100 });
      }
    }
    return samples;
  }

  /** G5 Exit 정확도(D+N) — 청산 포지션의 청산가 vs 청산 후 D+N 종가 표본 */
  async getExitAccuracySamples(
    portfolioId: string,
    horizonDays: number,
  ): Promise<ExitAccuracySample[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const closed = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED', closedAt: { not: null } },
      select: { corpCode: true, currentPrice: true, closedAt: true },
    });
    // DAR-206: 청산 포지션별 stockDailyPrice findMany(N+1) → corpCode in(...) 단일 조회 후 메모리 그룹핑.
    const eligible = closed
      .filter((p) => p.currentPrice != null && p.currentPrice > 0 && p.closedAt != null)
      .map((p) => ({
        priceAtExit: p.currentPrice as number,
        closeDate: this.toBasDd(p.closedAt as Date),
        corpCode: p.corpCode,
      }));
    const samples: ExitAccuracySample[] = [];
    if (eligible.length === 0) return samples;

    const corpCodes = [...new Set(eligible.map((e) => e.corpCode))];
    const minAfter = eligible.reduce(
      (m, e) => (e.closeDate < m ? e.closeDate : m),
      eligible[0].closeDate,
    );
    const rows = await this.prisma.stockDailyPrice.findMany({
      where: { corpCode: { in: corpCodes }, tradeDate: { gt: minAfter } },
      orderBy: [{ corpCode: 'asc' }, { tradeDate: 'asc' }],
      select: { corpCode: true, tradeDate: true, closePrice: true },
    });
    const byCorp = new Map<string, Array<{ tradeDate: string; closePrice: number }>>();
    for (const row of rows) {
      const arr = byCorp.get(row.corpCode) ?? [];
      arr.push({ tradeDate: row.tradeDate, closePrice: row.closePrice });
      byCorp.set(row.corpCode, arr);
    }
    for (const e of eligible) {
      const after = (byCorp.get(e.corpCode) ?? [])
        .filter((x) => x.tradeDate > e.closeDate)
        .slice(0, horizonDays);
      if (after.length >= horizonDays) {
        samples.push({
          priceAtExit: e.priceAtExit,
          priceAfterHorizon: after[horizonDays - 1].closePrice,
        });
      }
    }
    return samples;
  }

  /** G3 누적 AI 비용(KRW 환산) — AIUsageLog 전체 costUsd 합 × 환율 */
  async getAiCostKrw(usdKrwRate: number): Promise<number> {
    const agg = await this.prisma.aIUsageLog.aggregate({ _sum: { costUsd: true } });
    return (agg._sum.costUsd ?? 0) * usdKrwRate;
  }

  /** G6 위험조정 — 일별 포트폴리오 평가액 시계열(PortfolioRiskSnapshot.totalValue) */
  async getEquityCurve(portfolioId: string): Promise<EquityPoint[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const snaps = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    return snaps.map((s) => ({
      snapshotDate: s.snapshotDate,
      totalValue: s.totalValue,
    }));
  }

  /** G7 벤치마크 — 운용 기간 시장지수(KOSPI/KOSDAQ) 종가지수 표본(MarketIndex) */
  async getBenchmarkSeries(
    indexCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<BenchmarkPoint[]> {
    const rows = await this.prisma.marketIndex.findMany({
      where: { indexCode, tradeDate: { gte: fromDate, lte: toDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, closeIndex: true },
    });
    return rows.map((r) => ({ tradeDate: r.tradeDate, closeIndex: r.closeIndex }));
  }

  // ── 쓰기/오케스트레이션 경로 (DAR-109 실구현) ──

  /**
   * 당일 모의매수 후보 — BUY 등급(STRONG_BUY_CANDIDATE/BUY_CANDIDATE)·entryReady 신호.
   * 진입가는 tradeDate 시점(이하 최신) 종가. 가격 미존재 종목은 후보에서 제외(체결 불가).
   * paper-simulation 의 standing 후보 풀과 동일 의미(누적된 유효 신호) — buyScore 내림차순.
   */
  async getBuyCandidates(tradeDate: string): Promise<BuyCandidate[]> {
    const signals = await this.prisma.tradingSignal.findMany({
      where: {
        signal: { in: BUY_CANDIDATE_GRADES },
        entryReady: true,
      },
      orderBy: { buyScore: 'desc' },
      select: {
        id: true,
        rcpNo: true,
        corpCode: true,
        stockCode: true,
        signal: true,
        buyScore: true,
      },
    });
    const candidates: BuyCandidate[] = [];
    for (const s of signals) {
      const entryPrice = await this.getLatestClose(s.stockCode, tradeDate);
      if (entryPrice === null || entryPrice <= 0) continue;
      candidates.push({
        tradingSignalId: s.id,
        rcpNo: s.rcpNo,
        corpCode: s.corpCode,
        stockCode: s.stockCode,
        signal: s.signal as BuyCandidate['signal'],
        buyScore: s.buyScore,
        entryPrice,
      });
    }
    return candidates;
  }

  /** 보유(OPEN) 포지션 조회 → OpenPositionView 매핑 */
  async getOpenPositions(portfolioId: string): Promise<OpenPositionView[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const rows = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: {
        id: true,
        corpCode: true,
        stockCode: true,
        entryPrice: true,
        quantity: true,
        entryDate: true,
        stopLossPct: true,
        takeProfitPct: true,
        maxHoldDays: true,
        highestPrice: true,
      },
      orderBy: { entryDate: 'asc' },
    });
    return rows.map((r) => ({
      positionId: r.id,
      corpCode: r.corpCode,
      stockCode: r.stockCode,
      entryPrice: r.entryPrice,
      quantity: r.quantity,
      entryDate: r.entryDate,
      stopLossPct: r.stopLossPct,
      takeProfitPct: r.takeProfitPct,
      maxHoldDays: r.maxHoldDays,
      highestPrice: r.highestPrice,
    }));
  }

  /** 종목의 tradeDate 시점(이하 최신) 종가 — 없으면 null */
  async getLatestClose(
    stockCode: string,
    tradeDate: string,
  ): Promise<number | null> {
    const row = await this.prisma.stockDailyPrice.findFirst({
      where: { stockCode, tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: { closePrice: true },
    });
    return row ? row.closePrice : null;
  }

  /**
   * 모의매수 — Position(OPEN) + PaperTrade(BUY) 영속. 체결은 fill-simulator(슬리피지·수수료).
   * ★멱등(중복 진입 방지): 동일 신호의 thesis 가 이미 포지션에 연결됐거나(@unique),
   *   동일 종목 OPEN 보유 시 재진입하지 않는다(같은 거래일 재실행 안전).
   */
  async openPosition(
    portfolioId: string,
    input: OpenPositionInput,
  ): Promise<void> {
    if (portfolioId === NO_PORTFOLIO) return;
    const { candidate } = input;

    const thesis = await this.prisma.positionThesis.findUnique({
      where: { tradingSignalId: candidate.tradingSignalId },
      select: { id: true },
    });
    const duplicate = await this.prisma.position.findFirst({
      where: {
        portfolioId,
        OR: [
          ...(thesis ? [{ positionThesisId: thesis.id }] : []),
          { corpCode: candidate.corpCode, status: 'OPEN' as const },
        ],
      },
      select: { id: true },
    });
    if (duplicate) return; // 이미 진입 — 멱등 보장

    const fill = simulateFill(
      {
        direction: 'BUY',
        orderedShares: input.shares,
        entryPrice: candidate.entryPrice,
      },
      DEFAULT_FILL_PARAMS,
    );
    if (fill.filledShares <= 0) return;

    await this.prisma.paperTrade.create({
      data: {
        corpCode: candidate.corpCode,
        stockCode: candidate.stockCode,
        direction: 'BUY',
        orderedShares: input.shares,
        filledShares: fill.filledShares,
        fillRate: fill.fillRate,
        entryPrice: candidate.entryPrice,
        filledPrice: fill.filledPrice,
        commission: fill.commission,
        tax: fill.tax,
        slippage: fill.slippageCost,
        status: fill.status === 'FILLED' ? 'FILLED' : 'PARTIAL',
        entryDate: input.entryDate,
        filledAt: input.entryDate,
        tradingSignalId: candidate.tradingSignalId,
        positionThesisId: thesis?.id ?? null,
      },
    });

    const entryAmount = fill.filledPrice * fill.filledShares;
    await this.prisma.position.create({
      data: {
        portfolioId,
        corpCode: candidate.corpCode,
        stockCode: candidate.stockCode,
        positionThesisId: thesis?.id ?? null,
        entryDate: input.entryDate,
        entryPrice: fill.filledPrice,
        quantity: fill.filledShares,
        entryAmount,
        currentPrice: fill.filledPrice,
        currentValue: entryAmount,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
        highestPrice: fill.filledPrice,
        highestAt: input.entryDate,
        stopLossPct: input.stopLossPct,
        takeProfitPct: input.takeProfitPct,
        maxHoldDays: input.maxHoldDays,
        status: 'OPEN',
      },
    });
  }

  /**
   * 모의매도(청산) — Position CLOSED + PaperTrade(SELL, netPnl) + ExitSignal 영속.
   * ★멱등: 대상 포지션이 이미 청산됐거나 없으면 no-op.
   */
  async closePosition(input: ClosePositionInput): Promise<void> {
    const pos = await this.prisma.position.findFirst({
      where: { id: input.position.positionId, status: 'OPEN' },
      select: {
        id: true,
        corpCode: true,
        stockCode: true,
        entryPrice: true,
        quantity: true,
        positionThesisId: true,
      },
    });
    if (!pos) return; // 멱등 — 이미 청산되었거나 존재하지 않음

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
    const netPnl = proceeds - entryCost;
    const grossPnl = (fill.filledPrice - pos.entryPrice) * fill.filledShares;
    const returnPct =
      pos.entryPrice > 0
        ? ((fill.filledPrice - pos.entryPrice) / pos.entryPrice) * 100
        : 0;

    await this.prisma.paperTrade.create({
      data: {
        corpCode: pos.corpCode,
        stockCode: pos.stockCode,
        direction: 'SELL',
        orderedShares: pos.quantity,
        filledShares: fill.filledShares,
        fillRate: fill.fillRate,
        entryPrice: input.exitPrice,
        filledPrice: fill.filledPrice,
        commission: fill.commission,
        tax: fill.tax,
        slippage: fill.slippageCost,
        grossPnl,
        netPnl,
        returnPct,
        status: fill.status === 'FILLED' ? 'FILLED' : 'PARTIAL',
        entryDate: input.exitDate,
        filledAt: input.exitDate,
        positionThesisId: pos.positionThesisId ?? null,
      },
    });

    await this.prisma.exitSignal.create({
      data: {
        positionId: pos.id,
        checkTime: 'POST_MARKET',
        exitScore: input.exitScore,
        exitAction: input.exitAction as PrismaExitAction,
        triggerType: input.triggerType
          ? (input.triggerType as PrismaExitTriggerType)
          : null,
        triggerTypes: input.triggerTypes,
        scoreDetail: {
          source: 'DAR-109 sim-orchestrator',
          exitAction: input.exitAction,
          triggers: input.triggerTypes,
        } as unknown as Prisma.InputJsonValue,
        aiUsed: false,
      },
    });

    await this.prisma.position.update({
      where: { id: pos.id },
      data: {
        status: 'CLOSED',
        closedAt: input.exitDate,
        currentPrice: fill.filledPrice,
        currentValue: fill.filledPrice * fill.filledShares,
        unrealizedPnl: netPnl,
        unrealizedPnlPct: returnPct,
      },
    });
  }

  /** 일일 시가평가 스냅샷 적재 — 멱등 upsert(positionId,snapshotDate) */
  async saveDailySnapshot(input: DailySnapshotInput): Promise<void> {
    await this.prisma.positionDailySnapshot.upsert({
      where: {
        positionId_snapshotDate: {
          positionId: input.positionId,
          snapshotDate: input.snapshotDate,
        },
      },
      create: {
        positionId: input.positionId,
        snapshotDate: input.snapshotDate,
        closePrice: input.closePrice,
        quantity: input.quantity,
        positionValue: input.positionValue,
        unrealizedPnl: input.unrealizedPnl,
        unrealizedPnlPct: input.unrealizedPnlPct,
        exitScore: input.exitScore,
        exitAction: input.exitAction,
      },
      update: {
        closePrice: input.closePrice,
        quantity: input.quantity,
        positionValue: input.positionValue,
        unrealizedPnl: input.unrealizedPnl,
        unrealizedPnlPct: input.unrealizedPnlPct,
        exitScore: input.exitScore,
        exitAction: input.exitAction,
      },
    });
  }

  /** 포트폴리오 리스크 스냅샷 적재 — 멱등 upsert(portfolioId,snapshotDate) */
  async saveRiskSnapshot(input: RiskSnapshotInput): Promise<void> {
    if (input.portfolioId === NO_PORTFOLIO) return;
    await this.prisma.portfolioRiskSnapshot.upsert({
      where: {
        portfolioId_snapshotDate: {
          portfolioId: input.portfolioId,
          snapshotDate: input.snapshotDate,
        },
      },
      create: {
        portfolioId: input.portfolioId,
        snapshotDate: input.snapshotDate,
        totalValue: input.totalValue,
        cashAmount: input.cashAmount,
        unrealizedPnl: input.unrealizedPnl,
        unrealizedPnlPct: input.unrealizedPnlPct,
        topPositionPct: input.topPositionPct,
        openPositionCount: input.openPositionCount,
      },
      update: {
        totalValue: input.totalValue,
        cashAmount: input.cashAmount,
        unrealizedPnl: input.unrealizedPnl,
        unrealizedPnlPct: input.unrealizedPnlPct,
        topPositionPct: input.topPositionPct,
        openPositionCount: input.openPositionCount,
      },
    });
  }

  // ── DAR-109: 신호→진입 퍼널 계측 ──

  /** 당일(tradeDate, YYYYMMDD) 생성된 매수 신호 수 — TradingSignal.createdAt 기준 */
  async getDailySignalCount(tradeDate: string): Promise<number> {
    const { start, end } = this.dayBounds(tradeDate);
    if (!start || !end) return 0;
    return this.prisma.tradingSignal.count({
      where: { createdAt: { gte: start, lt: end } },
    });
  }

  /** 신호→진입 퍼널 일별 스냅샷 적재 — 멱등 upsert(portfolioId,tradeDate) */
  async saveFunnelSnapshot(input: FunnelSnapshotInput): Promise<void> {
    if (input.portfolioId === NO_PORTFOLIO) return;
    await this.prisma.signalEntryFunnelDaily.upsert({
      where: {
        portfolioId_tradeDate: {
          portfolioId: input.portfolioId,
          tradeDate: input.tradeDate,
        },
      },
      create: {
        portfolioId: input.portfolioId,
        tradeDate: input.tradeDate,
        signalsGenerated: input.signalsGenerated,
        candidatesPassed: input.candidatesPassed,
        filled: input.filled,
      },
      update: {
        signalsGenerated: input.signalsGenerated,
        candidatesPassed: input.candidatesPassed,
        filled: input.filled,
      },
    });
  }

  /** 신호→진입 퍼널 일별 이력(거래일 오름차순) — graduation/health 노출 */
  async getFunnelHistory(portfolioId: string): Promise<FunnelDaily[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const rows = await this.prisma.signalEntryFunnelDaily.findMany({
      where: { portfolioId },
      orderBy: { tradeDate: 'asc' },
      select: {
        tradeDate: true,
        signalsGenerated: true,
        candidatesPassed: true,
        filled: true,
      },
    });
    return rows.map((r) => ({
      tradeDate: r.tradeDate,
      signalsGenerated: r.signalsGenerated,
      candidatesPassed: r.candidatesPassed,
      filled: r.filled,
    }));
  }

  /** YYYYMMDD → [당일 00:00, 익일 00:00) 로컬 경계. 형식 불량이면 null. */
  private dayBounds(tradeDate: string): { start: Date | null; end: Date | null } {
    if (!/^\d{8}$/.test(tradeDate)) return { start: null, end: null };
    const y = Number(tradeDate.slice(0, 4));
    const m = Number(tradeDate.slice(4, 6));
    const d = Number(tradeDate.slice(6, 8));
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 1);
    return { start, end };
  }

  private toBasDd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
