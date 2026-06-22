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
  scanEntrySignals,
  ScalpCandle,
  SCALP_ENTRY_TAG,
} from '../../../engine3-quant-market/intraday-scalp/intraday-scalp-signal';
import { RealtimeQuoteCache } from '../../../engine3-quant-market/market-data/realtime-quote.cache';
import { KrxMarketDataScheduler } from '../../../engine3-quant-market/market-data/krx-market-data.scheduler';
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

  /**
   * ★DAR-415 윈도우 스캔 커서 — 종목별 '다음 스캔 시작 인덱스'(이미 평가한 분봉 재평가 방지).
   *   forward-only 단일 스케줄러 프로세스 가정 — 인메모리로 충분(재시작 시 빈 커서=처음부터 스캔도
   *   종목당-1라운드트립 게이트가 중복 진입을 막는다). 거래일 전환 시 전일 커서를 폐기한다.
   */
  private readonly scanCursor = new Map<string, number>();
  /** 커서가 속한 거래일(전환 감지용). */
  private scanCursorDate: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // 실시간 시세 캐시(@Global). 신선분이 있으면 우선 사용, 없으면 분봉 종가로 폴백.
    @Optional() private readonly realtimeCache?: RealtimeQuoteCache,
    // ★DAR-414: 분봉 collector(engine3)와 동일한 거래일 해석기 — tradeDate SSOT 정렬.
    //   환경 시계 today 가 KRX 실 가용 거래일보다 앞설 수 있어, 분봉은
    //   resolveLatestAvailableTradeDate() 로 라벨링되어 적재된다. 단타가 환경시계 today 를
    //   직접 쓰면 그 라벨과 어긋나 분봉을 못 찾아(빈 유니버스) 거래가 0이 된다(이 버그).
    //   동일 해석기를 공유해 라벨 불일치를 구조적으로 차단한다.
    @Optional() private readonly tradeDateResolver?: KrxMarketDataScheduler,
  ) {}

  /**
   * ★DAR-414 tradeDate SSOT — 분봉 collector(StockMinutePriceCollector)와 동일 소스.
   *   해석기가 주입돼 있으면 KRX 실 가용 거래일을 사용(분봉 라벨과 일치 보장),
   *   미주입(단위 테스트 등) 시에만 환경 시계 today 로 폴백한다.
   *   해석기 자체에 KRX 프로브 실패·DB 폴백·미래일 클램프가 내장돼 있어 graceful.
   */
  private async resolveTradeDate(now: Date): Promise<string> {
    if (this.tradeDateResolver) {
      try {
        return await this.tradeDateResolver.resolveLatestAvailableTradeDate();
      } catch (e) {
        this.logger.warn(
          `[Scalp] tradeDate 해석 실패 — 환경시계 today 폴백: ${(e as Error).message}`,
        );
      }
    }
    return formatKstDateCompact(now);
  }

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
    const tradeDate = await this.resolveTradeDate(now);
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

    // 동시 보유 상한 게이트(현재 OPEN 수 기준).
    const openCount = await this.prisma.intradayScalpTrade.count({
      where: { status: 'OPEN', styleTag: INTRADAY_SCALP_STYLE_TAG },
    });
    if (openCount >= MAX_OPEN_POSITIONS) {
      return { ...base, ran: true, skipped: false, openAfter: openCount, reason: '동시 보유 상한 도달' };
    }

    // ★DAR-415 dedup: 당일 진입 이력이 있는 종목(OPEN/CLOSED 무관)은 스킵 → 종목당 1라운드트립.
    const todayTrades = await this.prisma.intradayScalpTrade.findMany({
      where: { tradeDate, styleTag: INTRADAY_SCALP_STYLE_TAG },
      select: { stockCode: true },
    });
    const enteredTodayStocks = new Set(todayTrades.map((t) => t.stockCode));

    // 거래일 전환 시 커서 리셋(전일 종목 커서 폐기).
    if (this.scanCursorDate !== tradeDate) {
      this.scanCursor.clear();
      this.scanCursorDate = tradeDate;
    }

    const universe = await this.resolveUniverse(tradeDate);
    const { realized, count } = await this.todayRealizedAndCount(tradeDate);
    const budget = SCALP_INITIAL_CAPITAL * PER_POSITION_BUDGET_PCT;

    let entered = 0;
    let scannedStocks = 0;
    for (const cand of universe) {
      if (openCount + entered >= MAX_OPEN_POSITIONS) break;
      if (enteredTodayStocks.has(cand.stockCode)) continue; // 종목당 1라운드트립

      const candles = await this.loadTodayCandles(cand.stockCode, tradeDate);
      // ★DAR-415 윈도우 스캔: 직전 스캔 이후 도착 분봉부터 각 봉을 '현재'로 평가, 첫 충족봉 포착.
      const fromIndex = this.scanCursor.get(cand.stockCode) ?? 0;
      const scan = scanEntrySignals(candles, fromIndex);
      scannedStocks += 1;

      if (scan.index < 0 || scan.candle === null || scan.decision.currentPrice === null) {
        // 비충족 — 평가한 봉까지 커서 전진(재평가 방지). 다음 사이클은 신규 도착 분봉만 스캔.
        this.scanCursor.set(cand.stockCode, candles.length);
        continue;
      }
      // 충족봉 발견 — 커서는 충족봉 인덱스에 두어, 아래 리스크 거부 시 다음 사이클 재시도를 보존.
      this.scanCursor.set(cand.stockCode, scan.index);

      const decision = scan.decision;
      const price = scan.candle.close; // 충족봉 종가(체결 기준가) — currentPrice 와 동일, non-null
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
          // ★DAR-415 진입ts = 충족봉 시각(사이클 발화 시각 now 가 아님). 진입가 = 충족봉 종가.
          entryTs: scan.candle.ts,
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
      enteredTodayStocks.add(cand.stockCode); // 같은 사이클 내 재진입 방지
      this.logger.log(
        `[Scalp] 진입 ${cand.stockCode} ${fill.filledShares}주 @${fill.filledPrice} ` +
          `(충족봉 ${scan.candle.ts.toISOString()}·${decision.detail})`,
      );
    }

    // ★DAR-414/415 가시성: 진입 0이어도 '데이터 연결·윈도우 스캔함'이 로그에 보이게.
    //   스캔종목=종목당 1라운드트립 dedup 통과해 윈도우 스캔한 종목 수(진입은 충족·리스크 통과분).
    this.logger.log(
      `[Scalp] 진입 사이클 tradeDate=${tradeDate} 유니버스=${universe.length} ` +
        `윈도우스캔=${scannedStocks} 진입=${entered}`,
    );

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
    const tradeDate = await this.resolveTradeDate(now);
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
    const tradeDate = await this.resolveTradeDate(now);
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
