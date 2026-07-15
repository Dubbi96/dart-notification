/**
 * StrategyForwardSimulationService — 전략 변형 4종 forward 모의운용 (live-readiness W1)
 *
 * ★진단 확정 결함 교정: 전략 4종(이벤트엣지·단기모멘텀·보수가치·공격분산)은 그간 engine3
 * 리플레이(BacktestRun, 과거 1년 재생)로만 존재했고 forward(오늘 신호→오늘 진입) 트랙이 없었다.
 * 이 서비스는 PhilosophyStyleSimulationService(DAR-76) 구조를 전략 축으로 복제해, 라이브
 * TradingSignal(isBackfill=false)에 engine3 strategy-presets 의 preset.params(minBuyScore·
 * eventTypes allowlist·maxPositions·사이징)를 적용한 전략별 전용 포트폴리오를 매일 운용한다.
 * engine3 의 기존 리플레이 트랙(BacktestRun)은 일절 건드리지 않는다(별도 참고 컨텍스트로 존치).
 *
 * - 트랙 식별: 포트폴리오 이름 '모의운용 포트폴리오 [strategy:<key>]' find-or-create,
 *   PaperTrade/PositionDailySnapshot.styleTag='strategy:<key>' 네임스페이스(칼럼·인덱스 기존재).
 * - event-edge 는 EventEdgeSelectorService 를 **당일 1회** 해석해 allowlist 를 주입한다 —
 *   forward 에선 "오늘 신호에 오늘 통계"가 point-in-time 합법(미래 미참조). allowlist 가 비면
 *   진입 0 유지 + 로그(do-no-harm, 정직).
 * - 청산: preset.exitRules(takeProfit/stopLoss/maxHoldDays)를 Position exit 파라미터 자리에
 *   대입 → engine4 calculateExitScore(순수 Rule)가 그대로 발화. thesis invalidConditions 는
 *   주입하지 않는다(전략 정체성 = 프리셋 룰만, THESIS_BREAK 미혼입).
 * - Risk: 기존 예산 envelope(가상원금 × maxSinglePositionPct) 상한 + PaperTradeService
 *   공용 체결 경로(simulateFill) 그대로 — 하드룰 대체/우회 없음.
 * - ★체결 의미론(개장 체결 정렬, 2026-07-06 사용자 승인): "당일 최근 종가 즉시체결"에서 시스템
 *   모의와 동일한 **"저녁 = 주문 결정(PENDING 예약, styleTag='strategy:<key>') → 익일 개장 =
 *   당일 시가 체결"**로 통일. 체결은 장중 모니터(일반화된 fillPendingEntries) 또는 사이클 서두
 *   폴백(당일 REAL 시가)이 수행 — exit 파라미터는 체결기가 프리셋 exitRules 로 대입(정체성 보존).
 *
 * ★ 모의 전용 — 실주문 절대 금지(OrderRequest/OrderExecution 미사용). AI 금지영역: 진입 필터·
 *   사이징·청산 전부 순수 Rule(engine2/AI import 0 — engine3 은 Rule/통계 엔진).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradeService } from '../services/paper-trade.service';
import { RiskGuardService } from '../services/risk-guard.service';
import { formatKstDateCompact } from '../../common/time/kst';
import { DEFAULT_FILL_PARAMS } from '../domain/fill-simulator';
import { PaperSimulationService } from './paper-simulation.service';
// 시장 캘린더 순수 함수 — 익일 시가 체결 예약일 산정(시스템 모의와 동일 유틸 재사용).
import { nextTradingDay } from '../../engine3-quant-market/event-study/utils/d0-calculator';
import { PrismaExitSignalRepository } from '../../engine4-portfolio-exit/repositories/prisma-exit-signal.repository';
import { calculateExitScore } from '../../engine4-portfolio-exit/domain/exit-score.calculator';
import {
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
} from '../../engine4-portfolio-exit/domain/exit-engine.types';
import {
  STRATEGY_PRESETS,
  STRATEGY_INITIAL_CAPITAL,
  StrategyPreset,
  summarizeEntryRule,
  summarizeExitRule,
} from '../../engine3-quant-market/backtest/strategies/strategy-presets';
import { EventEdgeSelectorService } from '../../engine3-quant-market/backtest/strategies/event-edge-selector.service';
import { resolvePositionBudget } from '../../engine3-quant-market/backtest/backtest-runner.service';
import { StrategyParams } from '../../engine3-quant-market/backtest/ports/backtest.types';
import { dedupeCandidatesByCorpCode } from './simulation-entry';
// 네임스페이스 순수 Rule 은 forward-track-namespace.ts 로 승격(개장 체결기와 공유·순환 import 차단).
//   기존 소비처 호환을 위해 재export 유지.
import {
  STRATEGY_TAG_PREFIX,
  strategyStyleTag,
  strategyForwardPortfolioName,
  presetExitParams,
  kstMidnightOf,
} from './forward-track-namespace';
import { buildEquityCurve, EquityCurvePoint } from './equity-curve';
import { buildTradeRationale, calculateTradeScorecard, TradeScorecard } from './trade-scorecard';

export { STRATEGY_TAG_PREFIX, strategyStyleTag, strategyForwardPortfolioName, presetExitParams };

/** 과신 방지 — 청산 표본이 이 값 미만이면 LOW_SAMPLE(철학 스타일 비교와 동일 임계). */
export const STRATEGY_FORWARD_LOW_SAMPLE_THRESHOLD = 5;

/**
 * 전략 진입예산(순수 함수) = 프리셋 사이징(resolvePositionBudget — 리플레이와 동일 산식)을
 * Risk 예산 envelope(가상원금 × maxSinglePositionPct)로 절단. SCORE_WEIGHT 가중(최대 1.5배)이
 * envelope 를 넘지 못하게 상한 고정 — 하드룰 보존(우회 0).
 */
export function strategyEntryBudget(
  params: StrategyParams,
  buyScore: number,
  maxSinglePositionPct: number,
): number {
  const envelope = params.initialCapital * (maxSinglePositionPct / 100);
  if (!(envelope > 0)) return 0;
  const budget = resolvePositionBudget(
    params.initialCapital,
    params.maxPositions,
    params.sizeRule,
    buyScore,
  );
  return Math.min(budget, envelope);
}

// ─── 실행 결과 계약 ─────────────────────────────────────────────────────────

/** 한 전략의 1사이클 실행 요약. */
export interface StrategyCycleResult {
  strategyKey: string;
  portfolioId: string;
  /** 이번 사이클에 '당일 시가'로 체결된 매수 수(이전 예약분 폴백 체결 — 장중 모니터 미체결분). */
  bought: number;
  /** 이번 사이클에 새로 예약된 매수 주문 수(PENDING, 익일 시가 체결 예정). */
  reserved: number;
  snapshotted: number;
  exited: number;
  openPositions: number;
  equity: number;
  /** event-edge do-no-harm: robust 양-edge allowlist 가 비어 진입 0 유지(정직 표기). */
  allowlistEmpty?: boolean;
  message?: string;
}

/** 전체 전략 1사이클 실행 결과. */
export interface AllStrategiesCycleResult {
  tradeDate: string;
  strategies: StrategyCycleResult[];
}

/** 전략 forward 1종 성과 비교 행(철학 StylePerformance 패턴). */
export interface StrategyForwardPerformance {
  key: string;
  label: string;
  /** 한 줄 컨셉(preset.description). */
  tagline: string;
  portfolioId: string;
  initialCapital: number;
  /** 일별 자산곡선(오름차순; 0·1개도 정직하게 그대로) */
  equityCurve: EquityCurvePoint[];
  latestSnapshotDate: string | null;
  /** 청산 성적표(승률·평균손익·누적수익률·표본) */
  scorecard: TradeScorecard;
  /** 보유(OPEN) 포지션 수 */
  openPositions: number;
  /** 진입/청산 룰 평문(리플레이 비교와 동일 서식) */
  rules: { entry: string; exit: string };
  /** 과신 방지 — 청산 표본 < 임계 */
  lowSample: boolean;
}

/** 전략 forward 비교 응답. */
export interface StrategyForwardComparison {
  initialCapital: number;
  strategies: StrategyForwardPerformance[];
  ranking: { ranking: string[]; bestKey: string | null; allLowSample: boolean };
  lowSampleThreshold: number;
}

const EXIT_ACTIONS = new Set(['EXIT', 'BLOCK_REBUY']);

@Injectable()
export class StrategyForwardSimulationService {
  private readonly logger = new Logger(StrategyForwardSimulationService.name);
  private isRunning = false;

  /** 점수 임계·allowlist 필터로 다수 탈락하므로 후보 풀을 넉넉히 조회(스타일 시뮬과 동일). */
  private static readonly CANDIDATE_POOL_CAP = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paperTrade: PaperTradeService,
    private readonly eventEdgeSelector: EventEdgeSelectorService,
    // DAR-496(P18): 공용 진입 게이트(SHADOW) — @Optional(미주입 단위 테스트 no-op). 측정 트랙이라 무변경.
    @Optional() private readonly riskGuard?: RiskGuardService,
    // 개장 체결 정렬(2026-07-06): 일반화된 개장 체결기(fillPendingEntries) 소유자 — 사이클 서두
    //   폴백 체결(당일 REAL 시가)에 사용. @Optional — 미주입(단위 테스트)이면 폴백 생략(예약은
    //   장중 모니터가 체결·이월 상한이 정리).
    @Optional() private readonly paperSim?: PaperSimulationService,
  ) {}

  // ─── 전략 포트폴리오 find-or-create (스타일 시뮬과 동일 시스템 유저) ─────
  async getOrCreateStrategyPortfolio(
    key: string,
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
    const name = strategyForwardPortfolioName(key);
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

  // ─── 전체 전략 1사이클(수동 run-once / Cron 공통 진입점) ─────────────────
  async runDailyCycleAllStrategies(tradeDate: string): Promise<AllStrategiesCycleResult> {
    if (this.isRunning) {
      this.logger.warn('[StrategyFwd] 이전 사이클 진행 중 — 스킵');
      return { tradeDate, strategies: [] };
    }
    this.isRunning = true;
    try {
      // ★event-edge allowlist 는 당일 1회 해석(forward point-in-time: 오늘 신호에 오늘 통계).
      let gatedEventTypes: string[] | null = null;
      if (STRATEGY_PRESETS.some((p) => p.robustEventGate)) {
        const selection = await this.eventEdgeSelector.selectPositiveEdgeEventTypes();
        gatedEventTypes = selection.eventTypes;
      }

      const strategies: StrategyCycleResult[] = [];
      for (const preset of STRATEGY_PRESETS) {
        strategies.push(await this.runStrategyCycle(preset, tradeDate, gatedEventTypes));
      }
      return { tradeDate, strategies };
    } finally {
      this.isRunning = false;
    }
  }

  /** 전략 1종 1사이클: 예약 폴백 체결 → 프리셋 필터 예약 → 시가평가 → Exit → 스냅샷. */
  async runStrategyCycle(
    preset: StrategyPreset,
    tradeDate: string,
    gatedEventTypes: string[] | null,
  ): Promise<StrategyCycleResult> {
    try {
      const pf = await this.getOrCreateStrategyPortfolio(preset.key);
      // 0) 만기 도래 매수 예약 폴백 체결 — '당일 시가'로(시스템 모의 runDailyCycle 0단계와 동일
      //    패턴). 정상 운영은 장중 모니터(09:00~)가 먼저 체결. exit 파라미터는 체결기가 프리셋
      //    exitRules 로 대입(exitParamsForStyleTag). 미주입(단위 테스트)이면 0.
      const bought = this.paperSim
        ? await this.paperSim.fillPendingEntries(pf.id, tradeDate, {
            styleTag: strategyStyleTag(preset.key),
            initialCapital: STRATEGY_INITIAL_CAPITAL,
          })
        : 0;
      const { reserved, allowlistEmpty } = await this.openStrategyPositions(
        preset,
        pf,
        tradeDate,
        gatedEventTypes,
      );
      const snapshotted = await this.snapshotOpenPositions(pf.id, tradeDate, preset.key);
      const exited = await this.evaluateExits(pf.id, tradeDate, preset.key);
      const { equity, openPositions } = await this.computeEquity(pf.id);
      await this.saveStrategySnapshot(pf.id, tradeDate, equity, openPositions);

      // DAR-497(P19): 계좌 고점(HWM) 추적 + 드로다운 컷 — 측정 트랙은 **SHADOW**(기록만·차단 0·매매 무변경).
      await this.riskGuard
        ?.evaluateDrawdownCut({
          track: 'strategy-forward',
          portfolioId: pf.id,
          tradeDate,
          currentEquity: equity,
        })
        ?.catch((e) =>
          this.logger.error(
            `[StrategyFwd] 드로다운 SHADOW 평가 실패(무시): ${(e as Error).message}`,
          ),
        );

      this.logger.log(
        `[StrategyFwd][${preset.key}] 체결매수=${bought} 예약=${reserved} 스냅샷=${snapshotted} 매도=${exited} 보유=${openPositions} 평가=${equity}`,
      );
      return {
        strategyKey: preset.key,
        portfolioId: pf.id,
        bought,
        reserved,
        snapshotted,
        exited,
        openPositions,
        equity,
        ...(allowlistEmpty ? { allowlistEmpty: true } : {}),
      };
    } catch (e) {
      this.logger.error(`[StrategyFwd][${preset.key}] 사이클 오류: ${(e as Error).message}`);
      return {
        strategyKey: preset.key,
        portfolioId: '',
        bought: 0,
        reserved: 0,
        snapshotted: 0,
        exited: 0,
        openPositions: 0,
        equity: STRATEGY_INITIAL_CAPITAL,
        message: (e as Error).message,
      };
    }
  }

  // ─── 1) 프리셋 필터 신규 매수 예약 ────────────────────────────────────────
  // 개장 체결 정렬(2026-07-06): 즉시 placeOrder+Position 생성 대신 **PENDING PaperTrade 예약**만
  //   만든다(styleTag='strategy:<key>'·entryDate=다음 거래일·orderedShares=결정 시점 사이징).
  //   체결·Position 생성·exit 파라미터(프리셋) 대입은 일반화된 개장 체결기가 '당일 시가'로 수행.
  private async openStrategyPositions(
    preset: StrategyPreset,
    pf: { id: string; maxSinglePositionPct: number },
    tradeDate: string,
    gatedEventTypes: string[] | null,
  ): Promise<{ reserved: number; allowlistEmpty: boolean }> {
    // allowlist: robustEventGate 전략은 당일 해석분, 아니면 프리셋 정적 eventTypes(현행 3전략은 미지정=전 이벤트).
    const allowlist = preset.robustEventGate ? (gatedEventTypes ?? []) : preset.params.eventTypes;
    if (preset.robustEventGate && (!allowlist || allowlist.length === 0)) {
      // do-no-harm: 양-edge 이벤트가 없으면 진입 0 유지 — 정직하게 로그로 남긴다.
      this.logger.log(
        `[StrategyFwd][${preset.key}] robust 양-edge allowlist 0종 → 진입 0(do-no-harm)`,
      );
      return { reserved: 0, allowlistEmpty: true };
    }

    const tag = strategyStyleTag(preset.key);
    const openPositions = await this.prisma.position.findMany({
      where: { portfolioId: pf.id, status: 'OPEN' },
      select: { corpCode: true, entryAmount: true },
    });
    // 미체결 매수 예약(PENDING, 전략 네임스페이스) — 슬롯·현금·종목 디듑에 포함(이중 예약 방지).
    const pendingEntries = await this.prisma.paperTrade.findMany({
      where: { status: 'PENDING', direction: 'BUY', styleTag: tag },
      select: { corpCode: true, orderedShares: true, entryPrice: true },
    });
    const available = preset.params.maxPositions - openPositions.length - pendingEntries.length;
    if (available <= 0) return { reserved: 0, allowlistEmpty: false };

    const openCorpCodes = [
      ...openPositions.map((p) => p.corpCode),
      ...pendingEntries.map((t) => t.corpCode),
    ];

    // 라이브 신호만(★DAR-389/DAR-129 불가침: 과거 공시 백필 신호는 forward 진입 후보에서 배제).
    // 진입 필터 = 프리셋 정체성(minBuyScore + eventTypes allowlist) — 리플레이 러너와 동일 축.
    const rawCandidates = await this.prisma.tradingSignal.findMany({
      where: {
        buyScore: { gte: preset.params.minBuyScore },
        ...(allowlist && allowlist.length > 0 ? { eventType: { in: allowlist } } : {}),
        corpCode: { notIn: openCorpCodes.length ? openCorpCodes : ['__none__'] },
        disclosure: { isBackfill: false },
      },
      orderBy: { buyScore: 'desc' },
      take: StrategyForwardSimulationService.CANDIDATE_POOL_CAP,
    });
    // DAR-122 계승: 종목당 1건 디듑 — 동일 corpCode 다중 신호로 인한 중복 예약 차단.
    const candidates = dedupeCandidatesByCorpCode(rawCandidates);
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
      STRATEGY_INITIAL_CAPITAL + realizedNetPnl - investedPrincipal - reservedCash;

    let reserved = 0;
    for (const sig of candidates) {
      if (reserved >= available) break;
      // 현금 소진 시 추가 예약 중단(cash≥0 — 체결기 재클램프와 정합).
      if (availableCash <= 0) break;
      if (openedCorpCodes.has(sig.corpCode)) continue;

      const price = await this.latestClose(sig.corpCode, tradeDate);
      if (price === null || price <= 0) continue;

      // 프리셋 사이징(EQUAL/SCORE_WEIGHT) — Risk envelope 상한 절단(순수 함수) ∧ 가용현금.
      const budget = Math.min(
        strategyEntryBudget(preset.params, sig.buyScore, pf.maxSinglePositionPct),
        availableCash,
      );
      const shares = Math.floor(budget / price);
      if (shares <= 0) continue;

      // 기록 연계용 thesis 링크만 — exit 파라미터는 프리셋이 정본(THESIS 룰 미혼입, 체결기 대입).
      const thesis = await this.prisma.positionThesis.findUnique({
        where: { tradingSignalId: sig.id },
        select: { id: true },
      });

      // DAR-496(P18): 공용 진입 게이트(일일손실·현금) — SHADOW. 진입 확정(예약 create) 직전 1줄.
      //   ★측정 트랙(mode=SHADOW) → 절대 BLOCK 없음 → 진입 후보·수량 무변경(M10 클록 보호).
      const gate = await this.riskGuard?.evaluateEntry({
        track: 'strategy-forward',
        tradeDate,
        totalCapital: STRATEGY_INITIAL_CAPITAL,
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
          // 전략 네임스페이스 — 시스템 모의(paper-simulation)·철학(BUFFETT 등) 예약과 안전 분리.
          styleTag: tag,
        },
      });
      openedCorpCodes.add(sig.corpCode);
      // 예약 몫(기준가×주문수량)만큼 선차감 — 같은 사이클 내 후보 간 이중 배분 방지.
      availableCash -= shares * price;
      reserved++;
    }
    return { reserved, allowlistEmpty: false };
  }

  // ─── 2) 일일 시가평가(strategy:<key> 태깅) ────────────────────────────────
  private async snapshotOpenPositions(
    portfolioId: string,
    tradeDate: string,
    strategyKey: string,
  ): Promise<number> {
    const tag = strategyStyleTag(strategyKey);
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
          styleTag: tag,
        },
        update: {
          closePrice: close,
          positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
          styleTag: tag,
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

  // ─── 3) Exit 평가 + 모의 매도(프리셋 exitRules 정본) ─────────────────────
  private async evaluateExits(
    portfolioId: string,
    tradeDate: string,
    strategyKey: string,
  ): Promise<number> {
    const tag = strategyStyleTag(strategyKey);
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
        portfolioTotalValue: STRATEGY_INITIAL_CAPITAL,
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
      // 전략 정체성 보존: exit 은 프리셋 exitRules(포지션 주입값)만 — thesis 룰 미혼입.
      const thesisSnap: ThesisSnapshot = { invalidConditions: [], maxHoldDays: null };

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
          source: `strategy-forward [${strategyKey}]`,
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
        // F7 계승: 매수 수수료 차감(회계 누락 방지). 전량 매도 → 진입가×수량×commissionRate.
        const buyCommission = p.entryPrice * sell.filledShares * DEFAULT_FILL_PARAMS.commissionRate;
        const netPnl = grossPnl - buyCommission - sell.commission - sell.tax;
        const returnPct = p.entryPrice > 0 ? ((sellPrice - p.entryPrice) / p.entryPrice) * 100 : 0;

        await this.prisma.paperTrade.update({
          where: { id: sell.id },
          data: { grossPnl, netPnl, returnPct, styleTag: tag },
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

  // ─── 4) 전략 포트폴리오 평가액·스냅샷 ─────────────────────────────────────
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
    const equity = STRATEGY_INITIAL_CAPITAL + realizedNetPnl + unrealizedPnl;
    return { equity, openPositions: open.length };
  }

  private async saveStrategySnapshot(
    portfolioId: string,
    tradeDate: string,
    equity: number,
    openPositions: number,
  ): Promise<void> {
    const unrealizedPnl = equity - STRATEGY_INITIAL_CAPITAL;
    const cumulativeReturnPct = (unrealizedPnl / STRATEGY_INITIAL_CAPITAL) * 100;
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

  // ─── 비교 조회(read-only, getStyleComparison 패턴) ────────────────────────
  /**
   * 전략 4종 forward 포트폴리오의 자산곡선·성적표를 분리 집계해 비교 + 랭킹 반환.
   * ★ read-only — 신규 수집·체결·AI 0. 리플레이 비교(GET /strategies/comparison)와 별개 표면
   *   (리플레이=과거 1년 재생, 본 응답=forward 실운용 누적).
   */
  async getStrategyForwardComparison(): Promise<StrategyForwardComparison> {
    const strategies: StrategyForwardPerformance[] = [];
    for (const preset of STRATEGY_PRESETS) {
      strategies.push(await this.buildStrategyPerformance(preset));
    }

    // 표본 있는(청산 표본>0) 전략만으로 best / allLowSample 판정(리플레이 비교와 동일 규칙).
    const sampled = strategies.filter((s) => s.scorecard.sampleSize > 0);
    const best = sampled.reduce<StrategyForwardPerformance | null>(
      (top, s) =>
        top === null || s.scorecard.cumulativeReturnPct > top.scorecard.cumulativeReturnPct
          ? s
          : top,
      null,
    );
    const allLowSample = sampled.length === 0 ? true : sampled.every((s) => s.lowSample);
    const ranking = [...strategies]
      .sort(
        (a, b) =>
          Number(b.scorecard.sampleSize > 0) - Number(a.scorecard.sampleSize > 0) ||
          b.scorecard.cumulativeReturnPct - a.scorecard.cumulativeReturnPct,
      )
      .map((s) => s.key);

    return {
      initialCapital: STRATEGY_INITIAL_CAPITAL,
      strategies,
      ranking: { ranking, bestKey: best ? best.key : null, allLowSample },
      lowSampleThreshold: STRATEGY_FORWARD_LOW_SAMPLE_THRESHOLD,
    };
  }

  private async buildStrategyPerformance(
    preset: StrategyPreset,
  ): Promise<StrategyForwardPerformance> {
    const pf = await this.getOrCreateStrategyPortfolio(preset.key);

    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    const equityCurve = buildEquityCurve(snapshots, STRATEGY_INITIAL_CAPITAL);

    const scorecard = await this.buildStrategyScorecard(pf.id);
    const openPositions = await this.prisma.position.count({
      where: { portfolioId: pf.id, status: 'OPEN' },
    });

    return {
      key: preset.key,
      label: preset.label,
      tagline: preset.description,
      portfolioId: pf.id,
      initialCapital: STRATEGY_INITIAL_CAPITAL,
      equityCurve,
      latestSnapshotDate:
        equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].snapshotDate : null,
      scorecard,
      openPositions,
      rules: {
        entry: summarizeEntryRule(preset.params),
        exit: summarizeExitRule(preset.params),
      },
      lowSample: scorecard.sampleSize < STRATEGY_FORWARD_LOW_SAMPLE_THRESHOLD,
    };
  }

  /** 전략 포트폴리오의 CLOSED 포지션 → 성적표(승률·평균손익·누적수익률·표본). */
  private async buildStrategyScorecard(portfolioId: string): Promise<TradeScorecard> {
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
    return calculateTradeScorecard(closed, STRATEGY_INITIAL_CAPITAL);
  }

  // ─── 헬퍼(스타일 시뮬과 동일 로직 재사용) ─────────────────────────────────
  /** PaperTrade 에 strategy:<key> 태깅(가산형). */
  private async tagPaperTrade(id: string, strategyKey: string): Promise<void> {
    await this.prisma.paperTrade.update({
      where: { id },
      data: { styleTag: strategyStyleTag(strategyKey) },
    });
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
