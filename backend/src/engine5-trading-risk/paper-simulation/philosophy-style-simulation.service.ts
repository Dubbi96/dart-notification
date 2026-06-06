/**
 * PhilosophyStyleSimulationService — 철학 스타일별 모의 포트폴리오 분기 운용·성과 비교 (DAR-76, P-D)
 *
 * ★Main Thesis B. 단일 모의운용(PaperSimulationService)을 BUFFETT/LYNCH/GREENBLATT/DRUCKENMILLER
 * 4개 거장 스타일로 분기 운용한다. 스타일별 전용 포트폴리오에 engine2 philosophy-fit(Rule, AI 미개입)
 * 적합도를 진입 필터로 적용해 후보를 분리하고, 스타일별 자산곡선·성적표·졸업지표를 분리 집계해
 * "어느 스타일이 한국시장 공시에서 실제 모의수익을 내는지"를 데이터로 변별한다.
 *
 * 엔진 경계: 적합도는 PhilosophyFitService.getCompanyFit 가 **DB 저장 재무(CompanyFinancial) +
 *   InvestorPhilosophy 지표**를 결합해 산출하는 순수 Rule 값 — 신규 AI 호출·외부 fetch 0.
 * ★ 모의 전용 — 실주문 절대 금지(OrderRequest/OrderExecution 미사용). 체결·Exit·점수는 순수 Rule.
 * 회귀 0: 기존 단일 시뮬(PaperSimulationService) 경로/포트폴리오를 일절 변경하지 않고, 스타일 전용
 *   포트폴리오('모의운용 포트폴리오 [STYLE]')에만 별도로 적재한다. styleTag 는 가산형(nullable).
 *
 * 비고(스키마): styleTag 영속화는 DAR-76 마이그레이션(휴먼 수동 적용) 이후에만 동작한다. 비교 조회
 *   (getStyleComparison)는 포트폴리오 단위 집계라 styleTag 컬럼과 무관하게 적용 전에도 안전하다.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradeService } from '../services/paper-trade.service';
import { PaperSimulationService } from './paper-simulation.service';
import { PhilosophyFitService } from '../../engine2-ai-analyst/philosophy/philosophy-fit.service';
import {
  GraduationMetricsService,
  GraduationMetrics,
} from '../simulation/graduation-metrics.service';
import { PrismaExitSignalRepository } from '../../engine4-portfolio-exit/repositories/prisma-exit-signal.repository';
import { calculateExitScore } from '../../engine4-portfolio-exit/domain/exit-score.calculator';
import {
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
} from '../../engine4-portfolio-exit/domain/exit-engine.types';
import {
  SIM_MIN_ENTRY_GRADE,
  entryEligibleGrades,
  entryBudget,
} from './simulation-entry';
import { buildEquityCurve, EquityCurvePoint } from './equity-curve';
import {
  buildTradeRationale,
  calculateTradeScorecard,
  TradeScorecard,
} from './trade-scorecard';
import {
  PHILOSOPHY_STYLES,
  PhilosophyStyle,
  STYLE_LABELS,
  STYLE_ENTRY_MIN_FIT,
  STYLE_LOW_SAMPLE_THRESHOLD,
  stylePortfolioName,
  isStyleEligible,
  rankStyles,
  StyleRanking,
  StyleReturnRow,
} from './philosophy-style';

/** 한 스타일의 1사이클 실행 요약. */
export interface StyleCycleResult {
  style: PhilosophyStyle;
  portfolioId: string;
  bought: number;
  snapshotted: number;
  exited: number;
  openPositions: number;
  equity: number;
  message?: string;
}

/** 전체 스타일 1사이클 실행 결과. */
export interface AllStylesCycleResult {
  tradeDate: string;
  styles: StyleCycleResult[];
}

/** 졸업지표 비교 요약(스타일 비교용 핵심만 발췌). */
export interface StyleGraduationSummary {
  /** 신호 적중률(D+5, 0~100%) — 표본 0이면 0 */
  hitRatePct: number;
  hitRateSampleSize: number;
  /** Sharpe(연환산, DAR-68) — 표본 부족이면 null */
  sharpe: number | null;
  /** 최대낙폭 MDD(%, 0 이하) — 표본 부족이면 null */
  mddPct: number | null;
  /** 벤치마크(KOSPI) 대비 초과수익 alpha(%p) — 측정 불가면 null */
  benchmarkAlphaPct: number | null;
}

/** 스타일 1종의 성과 비교 행. */
export interface StylePerformance {
  style: PhilosophyStyle;
  label: string;
  portfolioId: string;
  initialCapital: number;
  /** 일별 자산곡선(오름차순; 0·1개도 정직하게 그대로) */
  equityCurve: EquityCurvePoint[];
  latestSnapshotDate: string | null;
  /** 청산 성적표(승률·평균손익·누적수익률·표본) */
  scorecard: TradeScorecard;
  /** 졸업지표 요약(적중률·Sharpe·MDD·alpha) */
  graduation: StyleGraduationSummary;
  /** 보유(OPEN) 포지션 수 */
  openPositions: number;
  /** 과신 방지 — 청산 표본 < 임계 */
  lowSample: boolean;
}

/** 스타일 비교 응답. */
export interface StyleComparison {
  initialCapital: number;
  styles: StylePerformance[];
  ranking: StyleRanking;
  lowSampleThreshold: number;
  minEntryFit: number;
}

@Injectable()
export class PhilosophyStyleSimulationService {
  private readonly logger = new Logger(PhilosophyStyleSimulationService.name);
  private isRunning = false;

  /** 적합도 필터 적용 시 후보 풀을 넉넉히 조회(필터로 다수 탈락하므로). */
  private static readonly CANDIDATE_POOL_CAP = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paperTrade: PaperTradeService,
    private readonly philosophyFit: PhilosophyFitService,
    private readonly graduation: GraduationMetricsService,
  ) {}

  // ─── 스타일 포트폴리오 find-or-create (단일 시뮬과 동일 시스템 유저) ─────
  async getOrCreateStylePortfolio(
    style: PhilosophyStyle,
  ): Promise<{ id: string; maxSinglePositionPct: number }> {
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
    const name = stylePortfolioName(style);
    let pf = await this.prisma.portfolio.findFirst({
      where: { userId: user.id, name },
      select: { id: true, maxSinglePositionPct: true },
    });
    if (!pf) {
      pf = await this.prisma.portfolio.create({
        data: { userId: user.id, name, maxSinglePositionPct: 10 },
        select: { id: true, maxSinglePositionPct: true },
      });
    }
    return pf;
  }

  // ─── 전체 스타일 1사이클(수동 run-once / Cron 공통 진입점) ─────────────
  async runDailyCycleAllStyles(tradeDate: string): Promise<AllStylesCycleResult> {
    if (this.isRunning) {
      this.logger.warn('[StyleSim] 이전 사이클 진행 중 — 스킵');
      return { tradeDate, styles: [] };
    }
    this.isRunning = true;
    try {
      const styles: StyleCycleResult[] = [];
      for (const style of PHILOSOPHY_STYLES) {
        styles.push(await this.runStyleCycle(style, tradeDate));
      }
      return { tradeDate, styles };
    } finally {
      this.isRunning = false;
    }
  }

  /** 스타일 1종 1사이클: 적합도 진입 → 시가평가 → Exit → 스타일 포트폴리오 스냅샷. */
  async runStyleCycle(
    style: PhilosophyStyle,
    tradeDate: string,
  ): Promise<StyleCycleResult> {
    try {
      const pf = await this.getOrCreateStylePortfolio(style);
      const bought = await this.openStylePositions(style, pf, tradeDate);
      const snapshotted = await this.snapshotOpenPositions(pf.id, tradeDate, style);
      const exited = await this.evaluateExits(pf.id, tradeDate, style);
      const { equity, openPositions } = await this.computeEquity(pf.id);
      await this.saveStyleSnapshot(pf.id, tradeDate, equity, openPositions);
      this.logger.log(
        `[StyleSim][${style}] 매수=${bought} 스냅샷=${snapshotted} 매도=${exited} 보유=${openPositions} 평가=${equity}`,
      );
      return {
        style,
        portfolioId: pf.id,
        bought,
        snapshotted,
        exited,
        openPositions,
        equity,
      };
    } catch (e) {
      this.logger.error(`[StyleSim][${style}] 사이클 오류: ${(e as Error).message}`);
      return {
        style,
        portfolioId: '',
        bought: 0,
        snapshotted: 0,
        exited: 0,
        openPositions: 0,
        equity: PaperSimulationService.INITIAL_CAPITAL,
        message: (e as Error).message,
      };
    }
  }

  // ─── 1) 적합도 필터 신규 매수 ─────────────────────────────────────────
  private async openStylePositions(
    style: PhilosophyStyle,
    pf: { id: string; maxSinglePositionPct: number },
    tradeDate: string,
  ): Promise<number> {
    const holdings = await this.prisma.position.count({
      where: { portfolioId: pf.id, status: 'OPEN' },
    });
    const available = PaperSimulationService.MAX_HOLDINGS - holdings;
    if (available <= 0) return 0;

    const openCorpCodes = (
      await this.prisma.position.findMany({
        where: { portfolioId: pf.id, status: 'OPEN' },
        select: { corpCode: true },
      })
    ).map((p) => p.corpCode);

    // 적합도 필터로 다수 탈락하므로 후보 풀을 넉넉히 조회한 뒤 스타일 적격만 진입.
    const candidates = await this.prisma.tradingSignal.findMany({
      where: {
        signal: { in: entryEligibleGrades(SIM_MIN_ENTRY_GRADE) as never },
        entryReady: true,
        corpCode: { notIn: openCorpCodes.length ? openCorpCodes : ['__none__'] },
      },
      orderBy: { buyScore: 'desc' },
      take: PhilosophyStyleSimulationService.CANDIDATE_POOL_CAP,
    });

    const baseBudget =
      PaperSimulationService.INITIAL_CAPITAL * (pf.maxSinglePositionPct / 100);

    let opened = 0;
    for (const sig of candidates) {
      if (opened >= available) break;

      // 엔진 경계: DB 저장 재무 기반 philosophy-fit(Rule). 스타일 적격 아니면 진입 제외.
      const fit = await this.philosophyFit.getCompanyFit(sig.corpCode);
      if (!isStyleEligible(style, fit.fits, STYLE_ENTRY_MIN_FIT)) continue;

      const price = await this.latestClose(sig.corpCode, tradeDate);
      if (price === null || price <= 0) continue;

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
      await this.tagPaperTrade(trade.id, style);

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

  // ─── 2) 일일 시가평가(styleTag 태깅) ──────────────────────────────────
  private async snapshotOpenPositions(
    portfolioId: string,
    tradeDate: string,
    style: PhilosophyStyle,
  ): Promise<number> {
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
          styleTag: style,
        },
        update: {
          closePrice: close,
          positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
          styleTag: style,
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

  // ─── 3) Exit 평가 + 모의 매도(styleTag 태깅) ─────────────────────────
  private async evaluateExits(
    portfolioId: string,
    tradeDate: string,
    style: PhilosophyStyle,
  ): Promise<number> {
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
        scoreDetail: { source: `DAR-76 style-sim [${style}]`, tradeDate, triggers: exit.triggerTypes },
      });

      await this.prisma.positionDailySnapshot.updateMany({
        where: { positionId: p.id, snapshotDate: tradeDate },
        data: { exitScore: exit.exitScore, exitAction: exit.exitAction },
      });

      if (EXIT_ACTIONS.has(exit.exitAction)) {
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

        await this.prisma.paperTrade.update({
          where: { id: sell.id },
          data: { grossPnl, netPnl, returnPct, styleTag: style },
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

  // ─── 4) 스타일 포트폴리오 평가액·스냅샷 ───────────────────────────────
  private async computeEquity(
    portfolioId: string,
  ): Promise<{ equity: number; openPositions: number }> {
    const open = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: { unrealizedPnl: true },
    });
    const closed = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED' },
      select: { unrealizedPnl: true },
    });
    const unrealizedPnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const realizedNetPnl = closed.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const equity =
      PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl + unrealizedPnl;
    return { equity, openPositions: open.length };
  }

  private async saveStyleSnapshot(
    portfolioId: string,
    tradeDate: string,
    equity: number,
    openPositions: number,
  ): Promise<void> {
    const unrealizedPnl = equity - PaperSimulationService.INITIAL_CAPITAL;
    const cumulativeReturnPct =
      (unrealizedPnl / PaperSimulationService.INITIAL_CAPITAL) * 100;
    await this.prisma.portfolioRiskSnapshot.upsert({
      where: { portfolioId_snapshotDate: { portfolioId, snapshotDate: tradeDate } },
      create: {
        portfolioId,
        snapshotDate: tradeDate,
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: cumulativeReturnPct,
        topPositionPct: 0,
        openPositionCount: openPositions,
        riskLevel: 'NORMAL',
      },
      update: {
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: cumulativeReturnPct,
        openPositionCount: openPositions,
      },
    });
  }

  // ─── 비교 조회(read-only, styleTag 무관) ──────────────────────────────
  /**
   * 4개 스타일의 자산곡선·성적표·졸업지표를 분리 집계해 비교 + 랭킹으로 반환.
   * ★ read-only — 신규 수집·체결·AI 0. 스타일 전용 포트폴리오 단위 집계라 마이그레이션 적용 전에도 안전.
   */
  async getStyleComparison(): Promise<StyleComparison> {
    const styles: StylePerformance[] = [];
    for (const style of PHILOSOPHY_STYLES) {
      styles.push(await this.buildStylePerformance(style));
    }
    const rows: StyleReturnRow[] = styles.map((s) => ({
      style: s.style,
      cumulativeReturnPct: s.scorecard.cumulativeReturnPct,
      sampleSize: s.scorecard.sampleSize,
    }));
    return {
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      styles,
      ranking: rankStyles(rows, STYLE_LOW_SAMPLE_THRESHOLD),
      lowSampleThreshold: STYLE_LOW_SAMPLE_THRESHOLD,
      minEntryFit: STYLE_ENTRY_MIN_FIT,
    };
  }

  private async buildStylePerformance(
    style: PhilosophyStyle,
  ): Promise<StylePerformance> {
    const pf = await this.getOrCreateStylePortfolio(style);

    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    const equityCurve = buildEquityCurve(
      snapshots,
      PaperSimulationService.INITIAL_CAPITAL,
    );

    const scorecard = await this.buildStyleScorecard(pf.id);
    const openPositions = await this.prisma.position.count({
      where: { portfolioId: pf.id, status: 'OPEN' },
    });

    let graduation: StyleGraduationSummary;
    try {
      const g = await this.graduation.getMetrics(pf.id);
      graduation = summarizeGraduation(g);
    } catch {
      graduation = EMPTY_GRADUATION;
    }

    return {
      style,
      label: STYLE_LABELS[style],
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      equityCurve,
      latestSnapshotDate:
        equityCurve.length > 0
          ? equityCurve[equityCurve.length - 1].snapshotDate
          : null,
      scorecard,
      graduation,
      openPositions,
      lowSample: scorecard.sampleSize < STYLE_LOW_SAMPLE_THRESHOLD,
    };
  }

  /** 스타일 포트폴리오의 CLOSED 포지션 → 성적표(승률·평균손익·누적수익률·표본). */
  private async buildStyleScorecard(portfolioId: string): Promise<TradeScorecard> {
    const rows = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED' },
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
      },
    });
    const closed = rows.map((r) =>
      buildTradeRationale({
        positionId: r.id,
        corpCode: r.corpCode,
        stockCode: r.stockCode,
        corpName: null,
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
        entryReason: null,
        initialThesis: null,
        exitAction: null,
        exitTriggers: [],
      }),
    );
    return calculateTradeScorecard(closed, PaperSimulationService.INITIAL_CAPITAL);
  }

  // ─── 헬퍼(단일 시뮬과 동일 로직 재사용) ──────────────────────────────
  /** PaperTrade 에 styleTag 태깅(가산형). 마이그레이션 적용 전이면 런타임에서만 영향. */
  private async tagPaperTrade(id: string, style: PhilosophyStyle): Promise<void> {
    await this.prisma.paperTrade.update({
      where: { id },
      data: { styleTag: style },
    });
  }

  private deriveExitParams(exitRules: unknown): {
    stopLossPct: number;
    maxHoldDays: number;
  } {
    let stopLossPct = PaperSimulationService.DEFAULT_STOP_LOSS_PCT;
    let maxHoldDays = PaperSimulationService.DEFAULT_MAX_HOLD_DAYS;
    if (Array.isArray(exitRules)) {
      for (const r of exitRules) {
        if (r && typeof r === 'object' && 'type' in r && 'value' in r) {
          const rule = r as { type: string; value: number };
          if (rule.type === 'STOP_LOSS_PCT' && typeof rule.value === 'number') {
            stopLossPct = rule.value;
          }
          if (rule.type === 'MAX_HOLD_DAYS' && typeof rule.value === 'number') {
            maxHoldDays = rule.value;
          }
        }
      }
    }
    return { stopLossPct, maxHoldDays };
  }

  private async loadThesisSnapshot(
    positionThesisId: string | null,
  ): Promise<ThesisSnapshot> {
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
      select: {
        openPrice: true,
        highPrice: true,
        lowPrice: true,
        closePrice: true,
        volume: true,
      },
    });
  }

  private async latestClose(
    corpCode: string,
    tradeDate: string,
  ): Promise<number | null> {
    const row = await this.latestPriceRow(corpCode, tradeDate);
    return row ? row.closePrice : null;
  }
}

const EXIT_ACTIONS = new Set(['EXIT', 'BLOCK_REBUY']);

const EMPTY_GRADUATION: StyleGraduationSummary = {
  hitRatePct: 0,
  hitRateSampleSize: 0,
  sharpe: null,
  mddPct: null,
  benchmarkAlphaPct: null,
};

/** GraduationMetrics → 스타일 비교용 요약 발췌(필드 결측은 null 유지, 정직 표기). */
export function summarizeGraduation(g: GraduationMetrics): StyleGraduationSummary {
  return {
    hitRatePct: g.hitRate?.hitRatePct ?? 0,
    hitRateSampleSize: g.hitRate?.evaluated ?? 0,
    sharpe: g.riskAdjusted?.sharpe ?? null,
    mddPct: g.riskAdjusted?.mddPct ?? null,
    benchmarkAlphaPct: g.benchmarkAlpha?.alphaPct ?? null,
  };
}
