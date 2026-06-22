/**
 * IntradayScalpService — 분봉 단타(intraday scalping) 모의전략 (DAR-411)
 *
 * 당일 진입·당일 청산 실시간 페이퍼 트랙. 기존 4종 일봉 전략과 별개.
 *   ★분봉은 당일 forward-only(KIS, 과거 분봉 없음) → 백테스트 불가 → 정규장 중
 *     실시간 모의(paper)로만 누적.
 *
 * 엔진 경계: 진입 "신호 정의"는 engine3(intraday-scalp-signal, 순수 함수)를 호출만 한다.
 *   모의 체결·리스크·청산·영속은 engine5 가 독립 강제(이 서비스).
 *
 * AI 금지영역 불가침(risk-guard 훅 강제):
 *   - engine2/AI/LLM import 0. 진입·청산·체결·리스크 모두 순수 Rule.
 *   - ★실주문 경로 0 — simulateFill(순수 시뮬)만 사용. 어떤 증권사 주문 API도 호출하지 않는다.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  evaluateScalpEntry,
  ScalpCandle,
  SCALP_ENTRY_TAG,
} from '../../../engine3-quant-market/intraday-scalp/intraday-scalp-signal';
import { RealtimeQuoteCache } from '../../../engine3-quant-market/market-data/realtime-quote.cache';
import { simulateFill, DEFAULT_FILL_PARAMS } from '../../domain/fill-simulator';
import { checkRisk } from '../../domain/risk-check.service';
import {
  INTRADAY_SCALP_STYLE_TAG,
  MAX_OPEN_POSITIONS,
  PER_POSITION_BUDGET_PCT,
  SCALP_INITIAL_CAPITAL,
  ScalpExitReason,
  evaluateScalpExit,
  isPastEntryCutoff,
} from './intraday-scalp-exit';
import {
  KST_TIMEZONE,
  formatKstDateCompact,
  isKstRegularMarketHours,
  kstClock,
} from '../../../common/time/kst';

export interface ScalpEntryCycleResult {
  ran: boolean;
  skipped: boolean;
  reason?: string;
  tradeDate: string;
  evaluated: number; // 평가한 유니버스 종목 수
  entered: number; // 신규 진입 포지션 수
  openAfter: number; // 사이클 후 동시 보유 수
}

export interface ScalpExitCycleResult {
  ran: boolean;
  skipped: boolean;
  reason?: string;
  tradeDate: string;
  evaluated: number; // 평가한 보유 포지션 수
  exited: number; // 청산된 포지션 수
}

export interface ScalpStatusEquityPoint {
  tradeDate: string;
  realizedPnl: number;
  cumulativeReturnPct: number;
}

export interface ScalpStatus {
  styleTag: string;
  strategyKey: string;
  tagline: string;
  initialCapital: number;
  openPositions: number;
  closedTrades: number;
  realizedPnl: number;
  winRate: number; // 0~1
  cumulativeReturnPct: number;
  lowSample: boolean; // 표본 < 20
  lowSampleThreshold: number;
  backtestable: false; // ★분봉 단타는 백테스트 불가(forward-only)
  equityCurve: ScalpStatusEquityPoint[];
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

/** 'YYYYMMDD' 의 직전 달력일('YYYYMMDD'). 월/연 경계 안전(UTC 산술). DAR-412 flat-fill 앵커. */
function compactDayBefore(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

@Injectable()
export class IntradayScalpService {
  private readonly logger = new Logger(IntradayScalpService.name);
  static readonly LOW_SAMPLE_THRESHOLD = 20;
  static readonly TIMEZONE = KST_TIMEZONE;

  constructor(
    private readonly prisma: PrismaService,
    // 실시간 시세 캐시(@Global). 신선분이 있으면 우선 사용, 없으면 분봉 종가로 폴백.
    @Optional() private readonly realtimeCache?: RealtimeQuoteCache,
  ) {}

  /** 현재 KST 벽시계 'HHMM'(zero-padded). */
  private hhmm(now: Date): string {
    const { minutes } = kstClock(now);
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
  }

  /** 당일 분봉(시간 오름차순) 로드 → ScalpCandle[]. 미수집(장외)이면 빈 배열(graceful). */
  private async loadTodayCandles(stockCode: string, tradeDate: string): Promise<ScalpCandle[]> {
    const rows = await this.prisma.stockMinutePrice.findMany({
      where: { stockCode, tradeDate },
      orderBy: { ts: 'asc' },
      select: {
        ts: true,
        openPrice: true,
        highPrice: true,
        lowPrice: true,
        closePrice: true,
        volume: true,
      },
    });
    return rows.map((r) => ({
      ts: r.ts,
      open: toNum(r.openPrice),
      high: toNum(r.highPrice),
      low: toNum(r.lowPrice),
      close: toNum(r.closePrice),
      volume: toNum(r.volume),
    }));
  }

  /**
   * 유니버스(매 사이클): 당일 공시 발생 종목 ∪ buy-signal(STRONG_BUY/BUY/WATCH) 후보,
   *   **분봉이 수집된 종목만**, 신호 buyScore 우선순위 정합. (이슈 설계 1)
   */
  async resolveUniverse(tradeDate: string): Promise<Array<{ corpCode: string; stockCode: string }>> {
    const [minuteRows, signals, disclosures] = await Promise.all([
      this.prisma.stockMinutePrice.findMany({
        where: { tradeDate },
        distinct: ['stockCode'],
        select: { stockCode: true, corpCode: true },
      }),
      this.prisma.tradingSignal.findMany({
        where: {
          signal: { in: ['STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE', 'WATCH'] },
          disclosure: { isBackfill: false },
        },
        orderBy: { buyScore: 'desc' },
        select: { corpCode: true, stockCode: true },
      }),
      this.prisma.disclosure.findMany({
        where: { rcpDt: { startsWith: tradeDate }, isBackfill: false },
        select: { corpCode: true },
      }),
    ]);

    const minuteByCode = new Map<string, string>();
    for (const r of minuteRows) {
      if (r.corpCode && r.stockCode) minuteByCode.set(r.stockCode, r.corpCode);
    }
    const candidateCorp = new Set<string>();
    for (const s of signals) candidateCorp.add(s.corpCode);
    for (const d of disclosures) candidateCorp.add(d.corpCode);

    const ordered = new Map<string, { corpCode: string; stockCode: string }>();
    // 1) buy-signal 후보(buyScore desc 정합) — 분봉 수집된 종목만
    for (const s of signals) {
      if (minuteByCode.has(s.stockCode) && !ordered.has(s.stockCode)) {
        ordered.set(s.stockCode, { corpCode: s.corpCode, stockCode: s.stockCode });
      }
    }
    // 2) 당일 공시 종목(신호 외) — 분봉 수집된 종목만
    for (const [stockCode, corpCode] of minuteByCode) {
      if (candidateCorp.has(corpCode) && !ordered.has(stockCode)) {
        ordered.set(stockCode, { corpCode, stockCode });
      }
    }
    return [...ordered.values()];
  }

  /** 현재가: 실시간 신선분 우선, 없으면 당일 마지막 분봉 종가. 둘 다 없으면 null. */
  private currentPrice(corpCode: string, candles: ScalpCandle[], nowMs: number): number | null {
    const fresh = this.realtimeCache?.getFresh(corpCode, nowMs);
    if (fresh && fresh.price > 0) return fresh.price;
    if (candles.length > 0) return candles[candles.length - 1].close;
    return null;
  }

  /** 오늘 트랙 실현손익 합·거래수(리스크 입력·중복 진입 게이트). */
  private async todayRealizedAndCount(tradeDate: string): Promise<{ realized: number; count: number }> {
    const rows = await this.prisma.intradayScalpTrade.findMany({
      where: { tradeDate, styleTag: INTRADAY_SCALP_STYLE_TAG },
      select: { netPnl: true },
    });
    let realized = 0;
    for (const r of rows) realized += toNum(r.netPnl);
    return { realized, count: rows.length };
  }

  /**
   * 진입 사이클: 정규장 매 사이클 유니버스→진입 평가→리스크→모의 체결→OPEN 영속.
   * 정규장 외/진입 마감(15:20 이후)/동시보유 상한이면 graceful 스킵.
   */
  async runEntryCycle(now: Date = new Date()): Promise<ScalpEntryCycleResult> {
    const tradeDate = formatKstDateCompact(now);
    const base: ScalpEntryCycleResult = {
      ran: false,
      skipped: true,
      tradeDate,
      evaluated: 0,
      entered: 0,
      openAfter: 0,
    };

    if (!isKstRegularMarketHours(now)) {
      return { ...base, reason: '정규장 외 — 진입 스킵' };
    }
    const nowHhmm = this.hhmm(now);
    if (isPastEntryCutoff(nowHhmm)) {
      return { ...base, reason: '진입 마감(15:20 이후) — 당일 청산 보장' };
    }

    const openTrades = await this.prisma.intradayScalpTrade.findMany({
      where: { status: 'OPEN', styleTag: INTRADAY_SCALP_STYLE_TAG },
      select: { stockCode: true },
    });
    const openCount = openTrades.length;
    const openStocks = new Set(openTrades.map((t) => t.stockCode));
    if (openCount >= MAX_OPEN_POSITIONS) {
      return { ...base, ran: true, skipped: false, openAfter: openCount, reason: '동시 보유 상한 도달' };
    }

    const universe = await this.resolveUniverse(tradeDate);
    const { realized, count } = await this.todayRealizedAndCount(tradeDate);
    const nowMs = now.getTime();
    const budget = SCALP_INITIAL_CAPITAL * PER_POSITION_BUDGET_PCT;

    let entered = 0;
    for (const cand of universe) {
      if (openCount + entered >= MAX_OPEN_POSITIONS) break;
      if (openStocks.has(cand.stockCode)) continue; // 종목당 1포지션

      const candles = await this.loadTodayCandles(cand.stockCode, tradeDate);
      const decision = evaluateScalpEntry(candles);
      if (!decision.triggered || decision.currentPrice === null) continue;

      const price = decision.currentPrice;
      const shares = Math.floor(budget / price);
      if (shares <= 0) continue;

      // engine5 Risk 하드룰(순수 Rule) — 위반 시 진입 거부(veto).
      const risk = checkRisk({
        corpCode: cand.corpCode,
        stockCode: cand.stockCode,
        side: 'BUY',
        requestedShares: shares,
        limitPrice: price,
        totalCapital: SCALP_INITIAL_CAPITAL,
        currentPositionValue: 0,
        dailyPnl: realized,
        weeklyPnl: realized,
        openOrderCount: openCount + entered,
        todayTradeCount: count + entered,
        killSwitchActive: false,
      });
      if (!risk.approved) {
        this.logger.debug(
          `[Scalp] 진입 거부(Risk) ${cand.stockCode}: ${risk.violations.map((v) => v.code).join(',')}`,
        );
        continue;
      }

      // ★실주문 0 — 순수 모의 체결만.
      const fill = simulateFill(
        { direction: 'BUY', orderedShares: shares, entryPrice: price },
        DEFAULT_FILL_PARAMS,
      );
      if (fill.filledShares <= 0) continue;

      await this.prisma.intradayScalpTrade.create({
        data: {
          corpCode: cand.corpCode,
          stockCode: cand.stockCode,
          tradeDate,
          entryTs: now,
          entryPrice: fill.filledPrice,
          shares: fill.filledShares,
          entryReason: SCALP_ENTRY_TAG,
          entryVwap: decision.vwap ?? undefined,
          entryVolumeRatio: decision.volumeRatio ?? undefined,
          commission: fill.commission,
          tax: 0,
          slippage: fill.slippageCost,
          status: 'OPEN',
          styleTag: INTRADAY_SCALP_STYLE_TAG,
        },
      });
      entered += 1;
      openStocks.add(cand.stockCode);
      this.logger.log(`[Scalp] 진입 ${cand.stockCode} ${fill.filledShares}주 @${fill.filledPrice} (${decision.detail})`);
    }

    return {
      ran: true,
      skipped: false,
      tradeDate,
      evaluated: universe.length,
      entered,
      openAfter: openCount + entered,
    };
  }

  /** 보유 포지션 1건 청산(모의 매도 체결 → 손익 산출 → CLOSED 영속). */
  private async closePosition(
    trade: {
      id: string;
      stockCode: string;
      entryPrice: unknown;
      shares: number;
      entryTs: Date;
      commission: unknown;
      slippage: unknown;
    },
    currentPrice: number,
    reason: ScalpExitReason,
    now: Date,
  ): Promise<void> {
    const entryPrice = toNum(trade.entryPrice);
    // ★실주문 0 — 순수 모의 매도 체결.
    const fill = simulateFill(
      { direction: 'SELL', orderedShares: trade.shares, entryPrice: currentPrice },
      DEFAULT_FILL_PARAMS,
    );
    const exitPrice = fill.filledShares > 0 ? fill.filledPrice : currentPrice;
    const grossPnl = (exitPrice - entryPrice) * trade.shares;
    const entryCommission = toNum(trade.commission);
    const totalCommission = entryCommission + fill.commission;
    const tax = fill.tax;
    const totalSlippage = toNum(trade.slippage) + fill.slippageCost;
    const netPnl = grossPnl - fill.commission - entryCommission - tax;
    const cost = entryPrice * trade.shares;
    const returnPct = cost > 0 ? (netPnl / cost) * 100 : 0;
    const holdMinutes = Math.max(0, Math.floor((now.getTime() - trade.entryTs.getTime()) / 60_000));

    await this.prisma.intradayScalpTrade.update({
      where: { id: trade.id },
      data: {
        status: 'CLOSED',
        exitTs: now,
        exitPrice,
        exitReason: reason,
        holdMinutes,
        commission: totalCommission,
        tax,
        slippage: totalSlippage,
        grossPnl,
        netPnl,
        returnPct,
      },
    });
    this.logger.log(`[Scalp] 청산 ${trade.stockCode} @${exitPrice.toFixed(0)} ${reason} 수익률 ${returnPct.toFixed(2)}%`);
  }

  /**
   * 청산 사이클: 보유 포지션을 익절(+2%)/손절(-1.2%)/강제청산(15:20)로 평가·청산.
   * 정규장 외면 graceful 스킵.
   */
  async runExitCycle(now: Date = new Date()): Promise<ScalpExitCycleResult> {
    const tradeDate = formatKstDateCompact(now);
    if (!isKstRegularMarketHours(now)) {
      return { ran: false, skipped: true, tradeDate, evaluated: 0, exited: 0, reason: '정규장 외 — 청산 스킵' };
    }
    const nowHhmm = this.hhmm(now);
    const open = await this.prisma.intradayScalpTrade.findMany({
      where: { status: 'OPEN', styleTag: INTRADAY_SCALP_STYLE_TAG },
    });
    const nowMs = now.getTime();
    let exited = 0;
    for (const t of open) {
      const candles = await this.loadTodayCandles(t.stockCode, t.tradeDate);
      const price = this.currentPrice(t.corpCode, candles, nowMs) ?? toNum(t.entryPrice);
      const decision = evaluateScalpExit(toNum(t.entryPrice), price, nowHhmm);
      if (!decision.shouldExit || decision.reason === null) continue;
      await this.closePosition(t, price, decision.reason, now);
      exited += 1;
    }
    return { ran: true, skipped: false, tradeDate, evaluated: open.length, exited };
  }

  /**
   * 전량 강제청산(15:20 별도 잡) — 손익 무관 모든 OPEN 포지션 청산(당일 청산 보장).
   * 정규장 게이트 없이 항상 실행(15:20 잡 전용) — 오버나잇 절대 금지.
   */
  async forceCloseAll(now: Date = new Date()): Promise<ScalpExitCycleResult> {
    const tradeDate = formatKstDateCompact(now);
    const open = await this.prisma.intradayScalpTrade.findMany({
      where: { status: 'OPEN', styleTag: INTRADAY_SCALP_STYLE_TAG },
    });
    const nowMs = now.getTime();
    let exited = 0;
    for (const t of open) {
      const candles = await this.loadTodayCandles(t.stockCode, t.tradeDate);
      const price = this.currentPrice(t.corpCode, candles, nowMs) ?? toNum(t.entryPrice);
      await this.closePosition(t, price, 'FORCE_CLOSE_EOD', now);
      exited += 1;
    }
    return { ran: true, skipped: false, tradeDate, evaluated: open.length, exited };
  }

  /**
   * 트랙 현황(표면화) — forward 누적 성과. 백테스트 없음(표본0/저표본 graceful).
   */
  async getStatus(): Promise<ScalpStatus> {
    const rows = await this.prisma.intradayScalpTrade.findMany({
      where: { styleTag: INTRADAY_SCALP_STYLE_TAG },
      orderBy: { tradeDate: 'asc' },
      select: { status: true, tradeDate: true, netPnl: true, returnPct: true },
    });
    const open = rows.filter((r) => r.status === 'OPEN');
    const closed = rows.filter((r) => r.status === 'CLOSED');

    let realizedPnl = 0;
    let wins = 0;
    const byDate = new Map<string, number>();
    for (const r of closed) {
      const net = toNum(r.netPnl);
      realizedPnl += net;
      if (toNum(r.returnPct) > 0) wins += 1;
      byDate.set(r.tradeDate, (byDate.get(r.tradeDate) ?? 0) + net);
    }
    const winRate = closed.length > 0 ? wins / closed.length : 0;
    const cumulativeReturnPct = (realizedPnl / SCALP_INITIAL_CAPITAL) * 100;

    // DAR-412: 일별 flat-fill. 손익 변동일마다 "직전 달력일"에 변동 직전 누적수익률을
    // 유지하는 flat 앵커를 넣어, 거래 없는 구간이 직선 보간으로 뭉개지지 않고
    // 평평 → 청산 시점 계단으로 그려지게 한다(forward-only 트랙, 차트는 인덱스 균등 간격).
    let cum = 0;
    const equityCurve: ScalpStatusEquityPoint[] = [];
    for (const [tradeDate, pnl] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const prevCumPct = (cum / SCALP_INITIAL_CAPITAL) * 100;
      const anchorDate = compactDayBefore(tradeDate);
      const lastDate = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].tradeDate : '';
      if (anchorDate > lastDate) {
        equityCurve.push({ tradeDate: anchorDate, realizedPnl: 0, cumulativeReturnPct: prevCumPct });
      }
      cum += pnl;
      equityCurve.push({
        tradeDate,
        realizedPnl: pnl,
        cumulativeReturnPct: (cum / SCALP_INITIAL_CAPITAL) * 100,
      });
    }

    return {
      styleTag: INTRADAY_SCALP_STYLE_TAG,
      strategyKey: INTRADAY_SCALP_STYLE_TAG,
      tagline: '분봉 단타 — 거래량 폭발+돌파+VWAP 진입, 당일 청산(오버나잇 금지)',
      initialCapital: SCALP_INITIAL_CAPITAL,
      openPositions: open.length,
      closedTrades: closed.length,
      realizedPnl,
      winRate,
      cumulativeReturnPct,
      lowSample: closed.length < IntradayScalpService.LOW_SAMPLE_THRESHOLD,
      lowSampleThreshold: IntradayScalpService.LOW_SAMPLE_THRESHOLD,
      backtestable: false,
      equityCurve,
    };
  }
}
