/**
 * PaperSimulationService — 일일 모의운용 오케스트레이터 (M10 모의운용, DAR-40)
 *
 * 한 사이클(장마감 후):
 *   1) 신규 BUY 후보 → 모의 매수(Position/PaperTrade open, 슬리피지/부분체결 반영)
 *   2) 보유 포지션 일일 시가평가 → PositionDailySnapshot 적재
 *   3) 보유 포지션 Exit Score 평가 → 트리거 시 모의 매도(close) + ExitSignal
 *   4) 누적 졸업지표 산출(적중률 D+5·누적수익·Exit정확도 D+3·AI비용/순익) → PortfolioRiskSnapshot
 *
 * ★ 모의 전용 — 실주문 절대 금지(OrderRequest/OrderExecution 미사용, M11 미진입).
 * AI 금지영역: 매수점수·Exit·체결은 순수 Rule(engine3/4 + fill-simulator). engine2/AI import 0.
 * 스키마 변경 0 — 기존 모델(Portfolio·Position·PositionDailySnapshot·PaperTrade·ExitSignal·
 *   PortfolioRiskSnapshot) 재사용.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradeService } from '../services/paper-trade.service';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import { PrismaExitSignalRepository } from '../../engine4-portfolio-exit/repositories/prisma-exit-signal.repository';
import { calculateExitScore } from '../../engine4-portfolio-exit/domain/exit-score.calculator';
import {
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
} from '../../engine4-portfolio-exit/domain/exit-engine.types';
import {
  calculateSimulationMetrics,
  SimulationMetrics,
  SignalOutcome,
  ExitOutcome,
} from './simulation-metrics';
import {
  toSimPositionDetail,
  SimPositionDetail,
} from './simulation-positions';
import {
  SIM_MIN_ENTRY_GRADE,
  entryEligibleGrades,
  entryBudget,
  buildEntryMeta,
} from './simulation-entry';
import { buildEquityCurve, EquityCurvePoint } from './equity-curve';
import {
  buildTradeRationale,
  calculateTradeScorecard,
  calculateScorecardByDimension,
  DimensionScorecard,
  TradeRationale,
  TradeRationaleInput,
  TradeScorecard,
} from './trade-scorecard';

export interface DailyCycleResult {
  tradeDate: string;
  bought: number;
  snapshotted: number;
  exited: number;
  openPositions: number;
  equity: number;
  metrics: SimulationMetrics;
  message?: string;
}

const EXIT_ACTIONS = new Set(['EXIT', 'BLOCK_REBUY']);

@Injectable()
export class PaperSimulationService {
  private readonly logger = new Logger(PaperSimulationService.name);
  private isRunning = false;

  static readonly SIM_USER_EMAIL = 'paper-sim@system.local';
  static readonly SIM_PORTFOLIO_NAME = '모의운용 포트폴리오';
  static readonly INITIAL_CAPITAL = 10_000_000; // 초기 가상원금 1천만원
  static readonly MAX_HOLDINGS = 50;
  static readonly USD_TO_KRW = 1380;
  static readonly DEFAULT_STOP_LOSS_PCT = 8;
  static readonly DEFAULT_TAKE_PROFIT_PCT = 20;
  static readonly DEFAULT_MAX_HOLD_DAYS = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paperTrade: PaperTradeService,
    // DAR-85: 청산 권고 시점에 NOTIFY 큐로 enqueue(엔진 직접 발송 금지).
    // @Optional — 큐/모듈 미주입 환경에서도 안전. ★권고일 뿐 실주문 직결 아님.
    @Optional()
    private readonly notifyProducer?: NotificationProducerService,
  ) {}

  /** 모의운용 전용 포트폴리오 find-or-create (고정 시스템 유저) */
  async getOrCreateSimPortfolio(): Promise<{ id: string; maxSinglePositionPct: number }> {
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
      select: { id: true, maxSinglePositionPct: true },
    });
    if (!pf) {
      pf = await this.prisma.portfolio.create({
        data: {
          userId: user.id,
          name: PaperSimulationService.SIM_PORTFOLIO_NAME,
          maxSinglePositionPct: 10,
        },
        select: { id: true, maxSinglePositionPct: true },
      });
    }
    return pf;
  }

  /** 한 사이클 실행 (수동 run-once / Cron 공통 진입점) */
  async runDailyCycle(tradeDate: string): Promise<DailyCycleResult> {
    if (this.isRunning) {
      this.logger.warn('[PaperSim] 이전 사이클 진행 중 — 스킵');
      return this.emptyResult(tradeDate, '이전 사이클 진행 중');
    }
    this.isRunning = true;
    try {
      this.logger.log(`[PaperSim] 일일 사이클 시작 tradeDate=${tradeDate}`);
      const pf = await this.getOrCreateSimPortfolio();

      const bought = await this.openNewPositions(pf, tradeDate);
      const snapshotted = await this.snapshotOpenPositions(pf.id, tradeDate);
      const exited = await this.evaluateExits(pf.id, tradeDate);
      const { metrics, equity, openPositions } = await this.computeMetrics(pf.id);
      await this.savePortfolioSnapshot(pf.id, tradeDate, equity, metrics, openPositions);

      this.logger.log(
        `[PaperSim] 사이클 완료 매수=${bought} 스냅샷=${snapshotted} 매도=${exited} 보유=${openPositions} 평가자산=${equity}`,
      );
      return { tradeDate, bought, snapshotted, exited, openPositions, equity, metrics };
    } catch (e) {
      this.logger.error(`[PaperSim] 사이클 오류: ${(e as Error).message}`);
      return this.emptyResult(tradeDate, (e as Error).message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 진척 조회 — 최신 누적지표 + 포트폴리오 현황 + 보유 포지션 상세 (실주문 없음)
   *
   * 모바일 포트폴리오 화면용(DAR-42): 평가금액·초기원금·보유 포지션[종목·수량·평가손익]·
   * 청산 건수·누적 졸업지표·최신 스냅샷일을 한 번에 반환한다.
   */
  async getSimulationStatus(): Promise<{
    portfolioId: string;
    initialCapital: number;
    equity: number;
    /** 보유 포지션 수 */
    openPositionCount: number;
    /** 보유 포지션 상세(종목·수량·평가손익) */
    positions: SimPositionDetail[];
    closedPositions: number;
    latestSnapshotDate: string | null;
    metrics: SimulationMetrics;
  }> {
    const pf = await this.getOrCreateSimPortfolio();
    const { metrics, equity, openPositions } = await this.computeMetrics(pf.id);
    const positions = await this.getOpenPositionDetails(pf.id);
    const closedPositions = await this.prisma.position.count({
      where: { portfolioId: pf.id, status: 'CLOSED' },
    });
    const latest = await this.prisma.portfolioRiskSnapshot.findFirst({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    });
    return {
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      equity,
      openPositionCount: openPositions,
      positions,
      closedPositions,
      latestSnapshotDate: latest?.snapshotDate ?? null,
      metrics,
    };
  }

  /**
   * 모의 자산곡선 + 졸업 진척(DAR-60).
   * PortfolioRiskSnapshot 의 일별 totalValue 시계열을 초기원금 기준 수익률과 함께 반환하고,
   * getSimulationStatus 와 동일한 누적 졸업지표(gates 포함)를 재사용해 스코어보드 데이터로 제공한다.
   * 스냅샷이 없으면 points=[](점 0개), 1개면 점 1개 — 추세를 가공하지 않는다(가짜 추세선 금지).
   */
  async getEquityCurve(): Promise<{
    portfolioId: string;
    initialCapital: number;
    /** 일별 자산곡선 점(오름차순). 0개·1개도 정직하게 그대로 반환 */
    points: EquityCurvePoint[];
    latestSnapshotDate: string | null;
    /** 누적 졸업지표(gates 포함) — getSimulationStatus 재사용 */
    metrics: SimulationMetrics;
  }> {
    const pf = await this.getOrCreateSimPortfolio();
    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    const { metrics } = await this.computeMetrics(pf.id);
    const points = buildEquityCurve(snapshots, PaperSimulationService.INITIAL_CAPITAL);
    return {
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      points,
      latestSnapshotDate: points.length > 0 ? points[points.length - 1].snapshotDate : null,
      metrics,
    };
  }

  /**
   * 매매 사유 추적 + 성적표(DAR-64).
   * 모의 포지션(OPEN+CLOSED)의 진입 사유(PositionThesis)·청산 사유(ExitSignal)를 기존 저장값에서
   * 추출하고, CLOSED 포지션을 매매 성적표(승률·평균손익·평균보유기간·누적수익률)로 집계한다.
   * ★ read-only — 신규 수집·외부호출·AI 개입 0. 기존 모델 조합만(스키마 변경 0).
   */
  async getTradeHistory(): Promise<{
    portfolioId: string;
    initialCapital: number;
    scorecard: TradeScorecard;
    /** eventType 별 성적표(CLOSED, 표본 많은 순) — DAR-73 */
    byEventType: DimensionScorecard[];
    /** signalGrade 별 성적표(CLOSED, 표본 많은 순) — DAR-73 */
    bySignalGrade: DimensionScorecard[];
    /** 진입일 최신순 매매 사유 목록(OPEN+CLOSED) */
    trades: TradeRationale[];
  }> {
    const pf = await this.getOrCreateSimPortfolio();
    const rows = await this.prisma.position.findMany({
      where: { portfolioId: pf.id },
      orderBy: { entryDate: 'desc' },
      select: {
        id: true,
        corpCode: true,
        stockCode: true,
        status: true,
        entryDate: true,
        entryPrice: true,
        quantity: true,
        closedAt: true,
        unrealizedPnl: true,
        unrealizedPnlPct: true,
        stopLossPct: true,
        takeProfitPct: true,
        maxHoldDays: true,
        positionThesis: {
          select: {
            entryReason: true,
            initialThesis: true,
            // DAR-73: 진입 신호의 eventType·등급을 성적표 차원으로 노출(기존 링크 재사용)
            tradingSignal: { select: { eventType: true, signal: true } },
          },
        },
      },
    });

    if (rows.length === 0) {
      return {
        portfolioId: pf.id,
        initialCapital: PaperSimulationService.INITIAL_CAPITAL,
        scorecard: calculateTradeScorecard([], PaperSimulationService.INITIAL_CAPITAL),
        byEventType: [],
        bySignalGrade: [],
        trades: [],
      };
    }

    // 회사명 보강
    const corpCodes = Array.from(new Set(rows.map((r) => r.corpCode)));
    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: corpCodes } },
      select: { corpCode: true, corpName: true },
    });
    const corpNameByCode: Record<string, string> = {};
    for (const c of companies) corpNameByCode[c.corpCode] = c.corpName;

    // CLOSED 포지션의 청산 트리거(ExitSignal) — 포지션별 최신 1건 매핑
    const closedIds = rows.filter((r) => r.status === 'CLOSED').map((r) => r.id);
    const exitByPosition = await this.loadExitSignals(closedIds);

    const trades = rows.map((r) => {
      const exit = exitByPosition[r.id];
      const input: TradeRationaleInput = {
        positionId: r.id,
        corpCode: r.corpCode,
        stockCode: r.stockCode,
        corpName: corpNameByCode[r.corpCode] ?? null,
        status: r.status,
        entryDate: r.entryDate,
        entryPrice: r.entryPrice,
        quantity: r.quantity,
        closedAt: r.closedAt,
        pnl: r.unrealizedPnl,
        pnlPct: r.unrealizedPnlPct,
        stopLossPct: r.stopLossPct,
        takeProfitPct: r.takeProfitPct,
        maxHoldDays: r.maxHoldDays,
        entryReason: r.positionThesis?.entryReason ?? null,
        initialThesis: r.positionThesis?.initialThesis ?? null,
        exitAction: exit?.exitAction ?? null,
        exitTriggers: exit?.triggerTypes ?? [],
        eventType: r.positionThesis?.tradingSignal?.eventType ?? null,
        signalGrade: r.positionThesis?.tradingSignal?.signal ?? null,
      };
      return buildTradeRationale(input);
    });

    const closed = trades.filter((t) => t.status === 'CLOSED');
    return {
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      scorecard: calculateTradeScorecard(closed, PaperSimulationService.INITIAL_CAPITAL),
      byEventType: calculateScorecardByDimension(
        closed,
        PaperSimulationService.INITIAL_CAPITAL,
        'eventType',
      ),
      bySignalGrade: calculateScorecardByDimension(
        closed,
        PaperSimulationService.INITIAL_CAPITAL,
        'signalGrade',
      ),
      trades,
    };
  }

  /** 청산 포지션별 최신 ExitSignal(청산 액션·트리거) 매핑 — read-only */
  private async loadExitSignals(
    positionIds: string[],
  ): Promise<Record<string, { exitAction: string; triggerTypes: string[] }>> {
    if (positionIds.length === 0) return {};
    const signals = await this.prisma.exitSignal.findMany({
      where: { positionId: { in: positionIds } },
      orderBy: { checkedAt: 'desc' },
      select: { positionId: true, exitAction: true, triggerTypes: true },
    });
    const map: Record<string, { exitAction: string; triggerTypes: string[] }> = {};
    for (const s of signals) {
      // findMany 가 checkedAt desc 이므로 최초 등장이 최신 — 이미 있으면 건너뜀.
      if (!map[s.positionId]) {
        map[s.positionId] = { exitAction: s.exitAction, triggerTypes: s.triggerTypes };
      }
    }
    return map;
  }

  /** 보유(OPEN) 포지션을 모바일 표시용으로 매핑 — 회사명 보강, 평가손익 큰 순 정렬 */
  private async getOpenPositionDetails(portfolioId: string): Promise<SimPositionDetail[]> {
    const rows = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: {
        corpCode: true,
        stockCode: true,
        quantity: true,
        entryPrice: true,
        currentPrice: true,
        currentValue: true,
        unrealizedPnl: true,
        unrealizedPnlPct: true,
      },
      orderBy: { currentValue: 'desc' },
    });
    if (rows.length === 0) return [];

    const corpCodes = Array.from(new Set(rows.map((r) => r.corpCode)));
    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: corpCodes } },
      select: { corpCode: true, corpName: true },
    });
    const corpNameByCode: Record<string, string> = {};
    for (const c of companies) corpNameByCode[c.corpCode] = c.corpName;

    return rows.map((r) => toSimPositionDetail(r, corpNameByCode));
  }

  // ─── 1) 신규 매수 ─────────────────────────────────────────────────────
  private async openNewPositions(
    pf: { id: string; maxSinglePositionPct: number },
    tradeDate: string,
  ): Promise<number> {
    const holdings = await this.prisma.position.count({
      where: { portfolioId: pf.id, status: 'OPEN' },
    });
    const available = PaperSimulationService.MAX_HOLDINGS - holdings;
    if (available <= 0) return 0;

    // 이미 보유 중인 종목 제외
    const openCorpCodes = (
      await this.prisma.position.findMany({
        where: { portfolioId: pf.id, status: 'OPEN' },
        select: { corpCode: true },
      })
    ).map((p) => p.corpCode);

    // DAR-51: 진입 기준 확장 — grade≥BUY → 설정 최소등급(기본 WATCH) AND entryReady.
    // BUY 0·WATCH만 쌓이는 현 데이터에서 P/L 검증 데이터를 모으기 위해 가용 최선 후보를 모의매수.
    const candidates = await this.prisma.tradingSignal.findMany({
      where: {
        signal: { in: entryEligibleGrades(SIM_MIN_ENTRY_GRADE) as never },
        entryReady: true,
        corpCode: { notIn: openCorpCodes.length ? openCorpCodes : ['__none__'] },
      },
      orderBy: { buyScore: 'desc' },
      take: available,
    });

    // 종목별 기본 배분 예산(가상원금 × 단일종목 최대비중). 등급별 차등 사이징은 entryBudget 적용.
    const baseBudget =
      PaperSimulationService.INITIAL_CAPITAL * (pf.maxSinglePositionPct / 100);

    let opened = 0;
    for (const sig of candidates) {
      const price = await this.latestClose(sig.corpCode, tradeDate);
      if (price === null || price <= 0) continue;
      // DAR-51: 등급별 차등 사이징(WATCH는 작게)
      const budget = entryBudget(baseBudget, sig.signal as string);
      const shares = Math.floor(budget / price);
      if (shares <= 0) continue;

      const thesis = await this.prisma.positionThesis.findUnique({
        where: { tradingSignalId: sig.id },
        select: { id: true, exitRules: true },
      });
      const { stopLossPct, maxHoldDays } = this.deriveExitParams(thesis?.exitRules);

      const trade = await this.paperTrade.placeOrder({
        corpCode: sig.corpCode,
        stockCode: sig.stockCode,
        direction: 'BUY',
        orderedShares: shares,
        entryPrice: price,
        entryDate: new Date(),
        liquidityRatio: 1.0,
        tradingSignalId: sig.id,
        positionThesisId: thesis?.id,
      });
      if (trade.filledShares <= 0) continue;

      const fillPrice = trade.filledPrice ?? price;
      await this.prisma.position.create({
        data: {
          portfolioId: pf.id,
          corpCode: sig.corpCode,
          stockCode: sig.stockCode,
          positionThesisId: thesis?.id ?? null,
          entryDate: new Date(),
          entryPrice: fillPrice,
          quantity: trade.filledShares,
          entryAmount: fillPrice * trade.filledShares,
          currentPrice: fillPrice,
          currentValue: fillPrice * trade.filledShares,
          unrealizedPnl: 0,
          unrealizedPnlPct: 0,
          highestPrice: fillPrice,
          highestAt: new Date(),
          stopLossPct,
          takeProfitPct: PaperSimulationService.DEFAULT_TAKE_PROFIT_PCT,
          maxHoldDays,
          status: 'OPEN',
        },
      });
      opened++;
    }
    return opened;
  }

  // ─── 2) 일일 시가평가 ─────────────────────────────────────────────────
  private async snapshotOpenPositions(portfolioId: string, tradeDate: string): Promise<number> {
    const positions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
    });
    let n = 0;
    for (const p of positions) {
      const day = await this.latestPriceRow(p.corpCode, tradeDate);
      if (!day) continue;
      const close = day.closePrice;
      const positionValue = close * p.quantity;
      const unrealizedPnl = (close - p.entryPrice) * p.quantity;
      const unrealizedPnlPct =
        p.entryPrice > 0 ? ((close - p.entryPrice) / p.entryPrice) * 100 : 0;
      const highest = Math.max(p.highestPrice ?? p.entryPrice, close);

      await this.prisma.positionDailySnapshot.upsert({
        where: { positionId_snapshotDate: { positionId: p.id, snapshotDate: tradeDate } },
        create: {
          positionId: p.id,
          snapshotDate: tradeDate,
          openPrice: day.openPrice,
          closePrice: close,
          highPrice: day.highPrice,
          lowPrice: day.lowPrice,
          volume: day.volume,
          quantity: p.quantity,
          positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
        },
        update: {
          closePrice: close,
          positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
        },
      });
      await this.prisma.position.update({
        where: { id: p.id },
        data: {
          currentPrice: close,
          currentValue: positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
          highestPrice: highest,
          highestAt: highest > (p.highestPrice ?? 0) ? new Date() : p.highestAt,
        },
      });
      n++;
    }
    return n;
  }

  // ─── 3) Exit 평가 + 모의 매도 ─────────────────────────────────────────
  private async evaluateExits(portfolioId: string, tradeDate: string): Promise<number> {
    const positions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
    });
    const exitRepo = new PrismaExitSignalRepository(this.prisma);
    let exited = 0;

    for (const p of positions) {
      const day = await this.latestPriceRow(p.corpCode, tradeDate);
      if (!day) continue;
      const close = day.closePrice;

      const posSnap: PositionSnapshot = {
        id: p.id,
        corpCode: p.corpCode,
        stockCode: p.stockCode,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        entryAmount: p.entryAmount,
        currentPrice: close,
        highestPrice: p.highestPrice ?? close,
        stopLossPct: p.stopLossPct,
        takeProfitPct: p.takeProfitPct,
        maxHoldDays: p.maxHoldDays,
        entryDate: p.entryDate,
        portfolioTotalValue: PaperSimulationService.INITIAL_CAPITAL,
        portfolioMaxSinglePositionPct: 10,
        portfolioMaxSectorPct: 30,
        portfolioMaxDailyLossPct: 2,
        portfolioDailyLossPct: null,
      };
      const tech: TechnicalSnapshot = {
        closePrice: close,
        openPrice: day.openPrice,
        ma5: null,
        ma20: null,
        low20: day.lowPrice,
        vwap: null,
        atr14: null,
        volumeRatio3d: null,
        excessReturn5d: null,
        avgVolumeRatio5d: null,
      };
      const thesisSnap = await this.loadThesisSnapshot(p.positionThesisId);

      const exit = calculateExitScore(posSnap, tech, thesisSnap, []);

      await exitRepo.save({
        positionId: p.id,
        checkTime: 'POST_MARKET',
        components: exit.components,
        exitScore: exit.exitScore,
        exitAction: exit.exitAction,
        triggerTypes: exit.triggerTypes,
        primaryTrigger: exit.primaryTrigger,
        scoreDetail: { source: 'DAR-40 paper-sim', tradeDate, triggers: exit.triggerTypes },
      });

      // 스냅샷에 exit 결과 기록(있으면)
      await this.prisma.positionDailySnapshot.updateMany({
        where: { positionId: p.id, snapshotDate: tradeDate },
        data: { exitScore: exit.exitScore, exitAction: exit.exitAction },
      });

      if (EXIT_ACTIONS.has(exit.exitAction)) {
        // DAR-85: 청산 권고 통지 enqueue(graceful — 모의 매도 체결을 깨지 않음).
        // ★권고일 뿐 자동 실주문/Kill 직결 아님. 수신자는 포트폴리오 소유자.
        await this.notifyProducer?.enqueueExit({
          positionId: p.id,
          corpCode: p.corpCode,
          stockCode: p.stockCode,
          exitAction: exit.exitAction,
          triggerTypes: exit.triggerTypes,
        });
        const sell = await this.paperTrade.placeOrder({
          corpCode: p.corpCode,
          stockCode: p.stockCode,
          direction: 'SELL',
          orderedShares: p.quantity,
          entryPrice: close,
          entryDate: new Date(),
          liquidityRatio: 1.0,
          positionThesisId: p.positionThesisId ?? undefined,
        });
        const sellPrice = sell.filledPrice ?? close;
        const grossPnl = (sellPrice - p.entryPrice) * sell.filledShares;
        const netPnl = grossPnl - sell.commission - sell.tax;
        const returnPct =
          p.entryPrice > 0 ? ((sellPrice - p.entryPrice) / p.entryPrice) * 100 : 0;

        // 모의 매도 체결에 실현손익 기록
        await this.prisma.paperTrade.update({
          where: { id: sell.id },
          data: { grossPnl, netPnl, returnPct },
        });
        await this.prisma.position.update({
          where: { id: p.id },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            currentPrice: sellPrice,
            currentValue: sellPrice * sell.filledShares,
            unrealizedPnl: netPnl,
            unrealizedPnlPct: returnPct,
          },
        });
        exited++;
      }
    }
    return exited;
  }

  // ─── 4) 누적 지표 ─────────────────────────────────────────────────────
  private async computeMetrics(portfolioId: string): Promise<{
    metrics: SimulationMetrics;
    equity: number;
    openPositions: number;
  }> {
    const open = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: { id: true, entryPrice: true, quantity: true, unrealizedPnl: true, entryDate: true },
    });
    const closed = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED' },
      select: { id: true, entryPrice: true, quantity: true, unrealizedPnl: true, closedAt: true, corpCode: true },
    });

    const unrealizedPnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const realizedNetPnl = closed.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const equity = PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl + unrealizedPnl;

    // 신호 적중률(D+5): 스냅샷 6개(D0~D5) 이상 보유한 포지션의 진입가 대비 D+5 수익률
    const signalOutcomes: SignalOutcome[] = [];
    for (const p of [...open, ...closed]) {
      const snaps = await this.prisma.positionDailySnapshot.findMany({
        where: { positionId: p.id },
        orderBy: { snapshotDate: 'asc' },
        select: { closePrice: true },
        take: 6,
      });
      if (snaps.length >= 6 && snaps[5].closePrice && p.entryPrice > 0) {
        signalOutcomes.push({
          d5ReturnPct: ((snaps[5].closePrice - p.entryPrice) / p.entryPrice) * 100,
        });
      } else {
        signalOutcomes.push({ d5ReturnPct: null });
      }
    }

    // Exit 정확도(D+3): 청산 후 3거래일 종가 변화율 (음수면 손절 적중)
    const exitOutcomes: ExitOutcome[] = [];
    for (const p of closed) {
      if (!p.closedAt) {
        exitOutcomes.push({ d3ReturnPct: null });
        continue;
      }
      const closeDate = this.toBasDd(p.closedAt);
      const after = await this.prisma.stockDailyPrice.findMany({
        where: { corpCode: p.corpCode, tradeDate: { gt: closeDate } },
        orderBy: { tradeDate: 'asc' },
        select: { closePrice: true },
        take: 3,
      });
      const exitPx = p.entryPrice; // 청산 시 currentPrice 가 entry 자리에 없으므로 보수적으로 null 처리
      if (after.length >= 3 && exitPx > 0) {
        exitOutcomes.push({ d3ReturnPct: ((after[2].closePrice - exitPx) / exitPx) * 100 });
      } else {
        exitOutcomes.push({ d3ReturnPct: null });
      }
    }

    // AI 비용 — AIUsageLog 전체 합(USD→KRW)
    const aiAgg = await this.prisma.aIUsageLog.aggregate({ _sum: { costUsd: true } });
    const totalAiCostKrw =
      (aiAgg._sum.costUsd ?? 0) * PaperSimulationService.USD_TO_KRW;

    const metrics = calculateSimulationMetrics({
      signalOutcomes,
      exitOutcomes,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      currentEquity: equity,
      realizedNetPnl,
      unrealizedPnl,
      totalAiCostKrw,
    });
    return { metrics, equity, openPositions: open.length };
  }

  private async savePortfolioSnapshot(
    portfolioId: string,
    tradeDate: string,
    equity: number,
    metrics: SimulationMetrics,
    openPositions: number,
  ): Promise<void> {
    const unrealizedPnl = metrics.netPnl;
    await this.prisma.portfolioRiskSnapshot.upsert({
      where: { portfolioId_snapshotDate: { portfolioId, snapshotDate: tradeDate } },
      create: {
        portfolioId,
        snapshotDate: tradeDate,
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: metrics.cumulativeReturnPct,
        topPositionPct: 0,
        openPositionCount: openPositions,
        riskLevel: 'NORMAL',
        hardRuleDetail: this.metricsSummary(metrics),
      },
      update: {
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: metrics.cumulativeReturnPct,
        openPositionCount: openPositions,
        hardRuleDetail: this.metricsSummary(metrics),
      },
    });
  }

  // ─── 헬퍼 ─────────────────────────────────────────────────────────────
  private metricsSummary(m: SimulationMetrics): string {
    const pct = (v: number | null) => (v === null ? 'N/A' : `${(v * 100).toFixed(1)}%`);
    return `적중률D5=${pct(m.hitRateD5)}(n=${m.hitRateSampleSize}) 누적=${m.cumulativeReturnPct.toFixed(2)}% Exit정확도D3=${pct(m.exitAccuracyD3)}(n=${m.exitAccuracySampleSize}) AI/순익=${m.aiCostToNetPnlRatio === null ? 'N/A' : m.aiCostToNetPnlRatio.toFixed(3)}`;
  }

  private deriveExitParams(exitRules: unknown): { stopLossPct: number; maxHoldDays: number } {
    let stopLossPct = PaperSimulationService.DEFAULT_STOP_LOSS_PCT;
    let maxHoldDays = PaperSimulationService.DEFAULT_MAX_HOLD_DAYS;
    if (Array.isArray(exitRules)) {
      for (const r of exitRules) {
        if (r && typeof r === 'object' && 'type' in r && 'value' in r) {
          const rule = r as { type: string; value: number };
          if (rule.type === 'STOP_LOSS_PCT' && typeof rule.value === 'number') stopLossPct = rule.value;
          if (rule.type === 'MAX_HOLD_DAYS' && typeof rule.value === 'number') maxHoldDays = rule.value;
        }
      }
    }
    return { stopLossPct, maxHoldDays };
  }

  private async loadThesisSnapshot(positionThesisId: string | null): Promise<ThesisSnapshot> {
    if (!positionThesisId) return { invalidConditions: [], maxHoldDays: null };
    const thesis = await this.prisma.positionThesis.findUnique({
      where: { id: positionThesisId },
      select: { invalidConditions: true },
    });
    const raw = thesis?.invalidConditions;
    const invalidConditions = Array.isArray(raw)
      ? (raw as Array<{ type: string; [k: string]: unknown }>)
      : [];
    return { invalidConditions, maxHoldDays: null };
  }

  private async latestPriceRow(corpCode: string, tradeDate: string) {
    return this.prisma.stockDailyPrice.findFirst({
      where: { corpCode, tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: { openPrice: true, highPrice: true, lowPrice: true, closePrice: true, volume: true },
    });
  }

  private async latestClose(corpCode: string, tradeDate: string): Promise<number | null> {
    const row = await this.latestPriceRow(corpCode, tradeDate);
    return row ? row.closePrice : null;
  }

  private toBasDd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  private emptyResult(tradeDate: string, message: string): DailyCycleResult {
    return {
      tradeDate,
      bought: 0,
      snapshotted: 0,
      exited: 0,
      openPositions: 0,
      equity: PaperSimulationService.INITIAL_CAPITAL,
      metrics: calculateSimulationMetrics({
        signalOutcomes: [],
        exitOutcomes: [],
        initialCapital: PaperSimulationService.INITIAL_CAPITAL,
        currentEquity: PaperSimulationService.INITIAL_CAPITAL,
        realizedNetPnl: 0,
        unrealizedPnl: 0,
        totalAiCostKrw: 0,
      }),
      message,
    };
  }
}
