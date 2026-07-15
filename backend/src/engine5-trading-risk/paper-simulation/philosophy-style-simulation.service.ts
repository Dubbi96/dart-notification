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
 * ★개장 체결 정렬(2026-07-06, 사용자 승인): 진입을 "결정 당일 종가 즉시체결"에서 시스템 모의와 동일한
 *   **"저녁 = 주문 결정(PENDING 예약, styleTag=스타일) → 익일 개장 = 당일 시가 체결"**로 통일했다.
 *   체결은 장중 모니터(개장 체결기, 일반화된 fillPendingEntries) 또는 본 사이클 서두 폴백(당일 REAL
 *   시가)이 수행 — 모든 트랙이 실제 장중 가격으로 거래돼 "지금 장에 맞는 트랙" 데이터가 축적된다.
 *   진입 후보에는 entryReady 폴백(②단계, buyScore≥50)을 도입(시스템 모의 DAR-362 계승).
 *
 * 비고(스키마): styleTag 영속화는 DAR-76 마이그레이션(휴먼 수동 적용) 이후에만 동작한다. 비교 조회
 *   (getStyleComparison)는 포트폴리오 단위 집계라 styleTag 컬럼과 무관하게 적용 전에도 안전하다.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradeService } from '../services/paper-trade.service';
import { RiskGuardService } from '../services/risk-guard.service';
import { formatKstDateCompact } from '../../common/time/kst';
import { DEFAULT_FILL_PARAMS } from '../domain/fill-simulator';
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
  dedupeCandidatesByCorpCode,
  ENTRY_FALLBACK_MIN_BUY_SCORE,
} from './simulation-entry';
// 시장 캘린더 순수 함수(주말·KRX 공휴일) — 익일 시가 체결 예약일 산정(시스템 모의와 동일 유틸 재사용).
import { nextTradingDay } from '../../engine3-quant-market/event-study/utils/d0-calculator';
import { kstMidnightOf } from './forward-track-namespace';
import { buildEquityCurve, EquityCurvePoint } from './equity-curve';
import { buildTradeRationale, calculateTradeScorecard, TradeScorecard } from './trade-scorecard';
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
  /** 이번 사이클에 '당일 시가'로 체결된 매수 수(이전 예약분 폴백 체결 — 장중 모니터 미체결분). */
  bought: number;
  /** 이번 사이클에 새로 예약된 매수 주문 수(PENDING, 익일 시가 체결 예정). */
  reserved: number;
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
    // DAR-496(P18): 공용 진입 게이트(SHADOW) — @Optional(미주입 단위 테스트 no-op). 측정 트랙이라 무변경.
    @Optional() private readonly riskGuard?: RiskGuardService,
    // 개장 체결 정렬(2026-07-06): 일반화된 개장 체결기(fillPendingEntries) 소유자 — 사이클 서두
    //   폴백 체결(당일 REAL 시가)에 사용. @Optional — 미주입(단위 테스트)이면 폴백 생략(예약은
    //   장중 모니터가 체결·이월 상한이 정리).
    @Optional() private readonly paperSim?: PaperSimulationService,
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

  /** 스타일 1종 1사이클: 예약 폴백 체결 → 적합도 예약 → 시가평가 → Exit → 스냅샷. */
  async runStyleCycle(style: PhilosophyStyle, tradeDate: string): Promise<StyleCycleResult> {
    try {
      const pf = await this.getOrCreateStylePortfolio(style);
      // 0) 만기 도래 매수 예약 폴백 체결 — '당일 시가'로(시스템 모의 runDailyCycle 0단계와 동일
      //    패턴). 정상 운영은 장중 모니터(09:00~)가 먼저 체결하므로 여기는 KIS 미가동/휴장 익일
      //    등에서의 폴백(당일 REAL 일봉 open). 미주입(단위 테스트)이면 0.
      const bought = this.paperSim
        ? await this.paperSim.fillPendingEntries(pf.id, tradeDate, {
            styleTag: style,
            initialCapital: PaperSimulationService.INITIAL_CAPITAL,
          })
        : 0;
      // 1) 신규 후보 → 매수 예약(익일 시가 체결 예정, 즉시 체결 금지 — lookahead 편향 차단).
      const reserved = await this.openStylePositions(style, pf, tradeDate);
      const snapshotted = await this.snapshotOpenPositions(pf.id, tradeDate, style);
      const exited = await this.evaluateExits(pf.id, tradeDate, style);
      const { equity, openPositions } = await this.computeEquity(pf.id);
      await this.saveStyleSnapshot(pf.id, tradeDate, equity, openPositions);

      // DAR-497(P19): 계좌 고점(HWM) 추적 + 드로다운 컷 — 측정 트랙은 **SHADOW**(기록만·차단 0·매매 무변경).
      await this.riskGuard
        ?.evaluateDrawdownCut({
          track: 'philosophy-style',
          portfolioId: pf.id,
          tradeDate,
          currentEquity: equity,
        })
        ?.catch((e) =>
          this.logger.error(`[StyleSim] 드로다운 SHADOW 평가 실패(무시): ${(e as Error).message}`),
        );

      this.logger.log(
        `[StyleSim][${style}] 체결매수=${bought} 예약=${reserved} 스냅샷=${snapshotted} 매도=${exited} 보유=${openPositions} 평가=${equity}`,
      );
      return {
        style,
        portfolioId: pf.id,
        bought,
        reserved,
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
        reserved: 0,
        snapshotted: 0,
        exited: 0,
        openPositions: 0,
        equity: PaperSimulationService.INITIAL_CAPITAL,
        message: (e as Error).message,
      };
    }
  }

  // ─── 1) 적합도 필터 신규 매수 예약 ────────────────────────────────────
  // 개장 체결 정렬(2026-07-06): 즉시 placeOrder+Position 생성 대신 **PENDING PaperTrade 예약**만
  //   만든다(styleTag=스타일·entryDate=다음 거래일·orderedShares=결정 시점 사이징·entryPrice=기준가).
  //   체결·Position 생성은 일반화된 개장 체결기(fillPendingEntries)가 '당일 시가'로 수행.
  private async openStylePositions(
    style: PhilosophyStyle,
    pf: { id: string; maxSinglePositionPct: number },
    tradeDate: string,
  ): Promise<number> {
    const openPositions = await this.prisma.position.findMany({
      where: { portfolioId: pf.id, status: 'OPEN' },
      select: { corpCode: true, entryAmount: true },
    });
    // 미체결 매수 예약(PENDING, 스타일 네임스페이스) — 슬롯·현금·종목 디듑에 포함해야
    //   예약↔체결 사이(하루)의 이중 예약·현금 초과 배분을 막는다(시스템 모의 패턴 계승).
    const pendingEntries = await this.prisma.paperTrade.findMany({
      where: { status: 'PENDING', direction: 'BUY', styleTag: style },
      select: { corpCode: true, orderedShares: true, entryPrice: true },
    });
    const available =
      PaperSimulationService.MAX_HOLDINGS - openPositions.length - pendingEntries.length;
    if (available <= 0) return 0;

    const openCorpCodes = [
      ...openPositions.map((p) => p.corpCode),
      ...pendingEntries.map((t) => t.corpCode),
    ];
    // 동일 사이클 내 같은 종목 재예약 방지(디듑 후라도 방어선 유지).
    const openedCorpCodes = new Set<string>(openCorpCodes);

    // DAR-496(P18): 공용 진입 게이트(SHADOW) 입력 — 가용현금·당일 실현손익 산정.
    //   현금 정의(SSOT): cash = 초기자본 + 실현손익(CLOSED net) − 보유 진입원가(OPEN entryAmount).
    //   예약이 잡아둔 금액(기준가×주문수량)도 차감 — 이중 배분 방지(체결기 재클램프가 최종 방어).
    const closedForCash = await this.prisma.position.findMany({
      where: { portfolioId: pf.id, status: 'CLOSED' },
      select: { unrealizedPnl: true, closedAt: true },
    });
    const realizedNetPnl = closedForCash.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const investedPrincipal = openPositions.reduce((s, p) => s + (p.entryAmount ?? 0), 0);
    const dailyRealizedPnl = closedForCash.reduce(
      (s, p) =>
        p.closedAt && formatKstDateCompact(p.closedAt) === tradeDate
          ? s + (p.unrealizedPnl ?? 0)
          : s,
      0,
    );
    // DAR-501(P21): 당월(KST) 실현손익 — closedAt 의 연·월(YYYYMM)이 tradeDate 와 같은 청산분 합산
    //   (월간 손실 한도 게이트 입력·SHADOW 관측). 월이 바뀌면 합이 리셋(익월 자동 재개·명세 3-3).
    const yearMonth = tradeDate.slice(0, 6);
    const monthlyRealizedPnl = closedForCash.reduce(
      (s, p) =>
        p.closedAt && formatKstDateCompact(p.closedAt).slice(0, 6) === yearMonth
          ? s + (p.unrealizedPnl ?? 0)
          : s,
      0,
    );
    const reservedCash = pendingEntries.reduce(
      (s, t) => s + t.orderedShares * Number(t.entryPrice),
      0,
    );
    let availableCash =
      PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl - investedPrincipal - reservedCash;

    const baseBudget = PaperSimulationService.INITIAL_CAPITAL * (pf.maxSinglePositionPct / 100);
    const excludeCorp = openCorpCodes.length ? openCorpCodes : ['__none__'];
    const eligibleGrades = entryEligibleGrades(SIM_MIN_ENTRY_GRADE) as never;

    let reserved = 0;
    /** 후보 목록에서 스타일 적격만 골라 예약 생성(공용 루프 — ①entryReady ②폴백 공유). */
    const reserveFrom = async (
      candidates: Array<{
        id: string;
        corpCode: string;
        stockCode: string;
        signal: string;
        buyScore: number;
      }>,
    ): Promise<void> => {
      for (const sig of candidates) {
        if (reserved >= available) break;
        // 현금 소진 시 추가 예약 중단(cash≥0 — 체결기 재클램프와 정합). buyScore desc 정렬이라
        //   남은 현금으로 가장 확신 높은 종목부터 채운다.
        if (availableCash <= 0) break;
        if (openedCorpCodes.has(sig.corpCode)) continue;

        // 엔진 경계: DB 저장 재무 기반 philosophy-fit(Rule). 스타일 적격 아니면 진입 제외.
        const fit = await this.philosophyFit.getCompanyFit(sig.corpCode);
        if (!isStyleEligible(style, fit.fits, STYLE_ENTRY_MIN_FIT)) continue;

        const price = await this.latestClose(sig.corpCode, tradeDate);
        if (price === null || price <= 0) continue;

        // 결정 시점 사이징(등급 계수만 — 철학 트랙 기존 규칙) ∧ 가용현금.
        const budget = Math.min(entryBudget(baseBudget, sig.signal), availableCash);
        const shares = Math.floor(budget / price);
        if (shares <= 0) continue;

        const thesis = await this.prisma.positionThesis.findUnique({
          where: { tradingSignalId: sig.id },
          select: { id: true },
        });

        // DAR-496(P18): 공용 진입 게이트(일일손실·현금) — SHADOW. 진입 확정(예약 create) 직전 1줄.
        //   ★측정 트랙(mode=SHADOW) → 절대 BLOCK 없음 → 진입 후보·수량 무변경(M10 클록 보호).
        const gate = await this.riskGuard?.evaluateEntry({
          track: 'philosophy-style',
          tradeDate,
          totalCapital: PaperSimulationService.INITIAL_CAPITAL,
          dailyRealizedPnl,
          monthlyRealizedPnl,
          availableCash,
          entryBudget: shares * price,
          corpCode: sig.corpCode,
          stockCode: sig.stockCode,
        });
        if (gate?.action === 'BLOCK') continue;

        // ★즉시 체결 금지 — PENDING 예약만 기록. entryDate=다음 거래일(주말·KRX 공휴일 스킵),
        //   entryPrice=예약 기준가(당일 평가가 — 사이징 근거, 체결가 아님). expectedPrice 는
        //   신호시점 기대가 보존(DAR-474 — 체결기가 entryPrice 를 덮어써도 유지).
        await this.prisma.paperTrade.create({
          data: {
            corpCode: sig.corpCode,
            stockCode: sig.stockCode,
            direction: 'BUY',
            orderedShares: shares,
            filledShares: 0,
            fillRate: 0,
            entryPrice: price,
            expectedPrice: price,
            status: 'PENDING',
            entryDate: kstMidnightOf(nextTradingDay(tradeDate)),
            tradingSignalId: sig.id,
            positionThesisId: thesis?.id ?? null,
            // 스타일 네임스페이스 — 시스템 모의(paper-simulation)·전략(strategy:*) 예약과 안전 분리.
            styleTag: style,
          },
        });
        openedCorpCodes.add(sig.corpCode);
        // 예약 몫(기준가×주문수량)만큼 선차감 — 같은 사이클 내 후보 간 이중 배분 방지.
        availableCash -= shares * price;
        reserved++;
      }
    };

    // ① entryReady=true 우선(품질 우선 — 시스템 모의 DAR-362 계승). 적합도 필터로 다수
    //    탈락하므로 후보 풀을 넉넉히 조회한 뒤 스타일 적격만 예약.
    const readyRaw = await this.prisma.tradingSignal.findMany({
      where: {
        signal: { in: eligibleGrades },
        entryReady: true,
        corpCode: { notIn: excludeCorp },
        // ★DAR-389/DAR-129(불가침): 과거 공시 백필 신호는 라이브 스타일 진입 후보에서 배제.
        disclosure: { isBackfill: false },
      },
      orderBy: { buyScore: 'desc' },
      take: PhilosophyStyleSimulationService.CANDIDATE_POOL_CAP,
    });
    // DAR-122: 종목당 1건으로 디듑 — 동일 corpCode 다중 Persona 신호로 인한 중복 예약 차단.
    await reserveFrom(dedupeCandidatesByCorpCode(readyRaw));

    // ② 슬롯이 남으면 entryReady=false 라도 buyScore≥ENTRY_FALLBACK_MIN_BUY_SCORE(50) 인 상위
    //    후보로 보강(entryReady 폴백 — 무차별 확대 아님·품질 하한 유지. fit≥50 게이트는 그대로).
    if (reserved < available && availableCash > 0) {
      const already = Array.from(openedCorpCodes);
      const fallbackRaw = await this.prisma.tradingSignal.findMany({
        where: {
          signal: { in: eligibleGrades },
          entryReady: false,
          buyScore: { gte: ENTRY_FALLBACK_MIN_BUY_SCORE },
          corpCode: { notIn: already.length ? already : ['__none__'] },
          // ★DAR-389/DAR-129(불가침): 백필 신호는 폴백 후보에서도 배제(① 동일 근거).
          disclosure: { isBackfill: false },
        },
        orderBy: { buyScore: 'desc' },
        take: PhilosophyStyleSimulationService.CANDIDATE_POOL_CAP,
      });
      await reserveFrom(dedupeCandidatesByCorpCode(fallbackRaw));
    }
    return reserved;
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
      const unrealizedPnlPct = p.entryPrice > 0 ? ((close - p.entryPrice) / p.entryPrice) * 100 : 0;
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

      // asOf = 사이클 거래일 자정(라이브=오늘이라 무변경, 리플레이=평가일 정확 — 룩어헤드 차단).
      const exit = calculateExitScore(
        posSnap,
        tech,
        thesisSnap,
        [],
        null,
        kstMidnightOf(tradeDate),
      );

      await exitRepo.save({
        positionId: p.id,
        checkTime: 'POST_MARKET',
        components: exit.components,
        exitScore: exit.exitScore,
        exitAction: exit.exitAction,
        triggerTypes: exit.triggerTypes,
        primaryTrigger: exit.primaryTrigger,
        scoreDetail: {
          source: `DAR-76 style-sim [${style}]`,
          tradeDate,
          triggers: exit.triggerTypes,
        },
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
        // F7(2026-06-27): 매수 수수료 차감(회계 누락 교정). 전량 매도 → 진입가×수량×commissionRate.
        const buyCommission = p.entryPrice * sell.filledShares * DEFAULT_FILL_PARAMS.commissionRate;
        const netPnl = grossPnl - buyCommission - sell.commission - sell.tax;
        const returnPct = p.entryPrice > 0 ? ((sellPrice - p.entryPrice) / p.entryPrice) * 100 : 0;

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
    const equity = PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl + unrealizedPnl;
    return { equity, openPositions: open.length };
  }

  private async saveStyleSnapshot(
    portfolioId: string,
    tradeDate: string,
    equity: number,
    openPositions: number,
  ): Promise<void> {
    const unrealizedPnl = equity - PaperSimulationService.INITIAL_CAPITAL;
    const cumulativeReturnPct = (unrealizedPnl / PaperSimulationService.INITIAL_CAPITAL) * 100;
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

  private async buildStylePerformance(style: PhilosophyStyle): Promise<StylePerformance> {
    const pf = await this.getOrCreateStylePortfolio(style);

    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    const equityCurve = buildEquityCurve(snapshots, PaperSimulationService.INITIAL_CAPITAL);

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
        equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].snapshotDate : null,
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

  // (개장 체결 정렬) exit 파라미터 파생은 일반화된 체결기(fillPendingEntries)가 체결 시점에
  //   thesis exitRules 로 수행한다 — 본 서비스의 중복 파생 헬퍼는 제거.

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
      select: {
        openPrice: true,
        highPrice: true,
        lowPrice: true,
        closePrice: true,
        volume: true,
      },
    });
  }

  private async latestClose(corpCode: string, tradeDate: string): Promise<number | null> {
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
