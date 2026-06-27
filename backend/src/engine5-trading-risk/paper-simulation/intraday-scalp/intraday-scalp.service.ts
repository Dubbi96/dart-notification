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
import { NotificationProducerService } from '../../../notifications/notification-producer.service';
import {
  scanEntrySignals,
  ScalpCandle,
  SCALP_ENTRY_TAG,
} from '../../../engine3-quant-market/intraday-scalp/intraday-scalp-signal';
import { RealtimeQuoteCache } from '../../../engine3-quant-market/market-data/realtime-quote.cache';
import { KrxMarketDataScheduler } from '../../../engine3-quant-market/market-data/krx-market-data.scheduler';
import {
  minuteTimestamp,
  kstWallClockIso,
} from '../../../engine3-quant-market/market-data/minute-timestamp';
import { simulateFill, DEFAULT_FILL_PARAMS } from '../../domain/fill-simulator';
import { checkRisk } from '../../domain/risk-check.service';
import { KillSwitchManager } from '../../domain/kill-switch';
import {
  INTRADAY_SCALP_STYLE_TAG,
  MAX_OPEN_POSITIONS,
  PER_POSITION_BUDGET_PCT,
  SCALP_INITIAL_CAPITAL,
  DEFAULT_SCALP_EXIT_PARAMS,
  ScalpExitReason,
  evaluateScalpExit,
  grossTakeProfitThresholdPct,
  passesEntryFeeHurdle,
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
  // ★DAR-418 fee-aware 투명화: 비용 인지 거래임을 표면화.
  /** 왕복(매수+매도) 거래비용율(%) — TP/SL net 환산 기준(수수료·세금·슬리피지 SSOT). */
  roundTripCostPct: number;
  /** 순(net) 익절 목표(%) — 비용 차감 후 달성 목표. */
  takeProfitNetPct: number;
  /** 순(net) 손절 목표(%, 음수). */
  stopLossNetPct: number;
  /** 청산 완료 거래의 총수수료(수수료+세금) 합(원). */
  totalFees: number;
  equityCurve: ScalpStatusEquityPoint[];
}

/**
 * 단타 거래 1행(드릴다운 타임라인) — DAR-416 모바일 표면화.
 *   진입/청산 시각·사유·가격·손익을 종목별로 노출(최신 진입순). OPEN 포지션은 청산 필드 null.
 */
export interface ScalpTradeRow {
  /** 행 식별자(IntradayScalpTrade id). */
  id: string;
  stockCode: string;
  /** 종목명(Company.corpName, 없으면 stockCode 폴백). */
  corpName: string;
  tradeDate: string;
  /** 진입 분봉 시각(ISO 8601). */
  entryTs: string;
  /** 청산 분봉 시각(ISO 8601) — OPEN 이면 null. */
  exitTs: string | null;
  /** 진입 사유 태그(VOLUME_BREAKOUT_VWAP). */
  entryReason: string;
  /** 청산 사유 — OPEN 이면 null. */
  exitReason: ScalpExitReason | null;
  entryPrice: number;
  /** 청산 체결가 — OPEN 이면 null. */
  exitPrice: number | null;
  /** 순수익률(%) — net(=netReturnPct). OPEN 이면 null. (기존 FE 호환 — net 의미). */
  returnPct: number | null;
  /** gross 수익률(%) — 비용 미반영(가격 기준). OPEN 이면 null. (DAR-418) */
  grossReturnPct: number | null;
  /** 순(net) 수익률(%) — returnPct 와 동일 값(명시 별칭). OPEN 이면 null. (DAR-418) */
  netReturnPct: number | null;
  /** 순손익(원) — OPEN 이면 null. */
  netPnl: number | null;
  /** 총수수료(수수료+세금) 합(원) — OPEN 이면 null. (DAR-418) */
  totalFees: number | null;
  /** 포지션 상태. */
  status: 'OPEN' | 'CLOSED';
}

/** 단타 거래 타임라인 응답 — GET /intraday-scalp/trade-history(최신 진입순). */
export interface ScalpTradeHistory {
  styleTag: string;
  strategyKey: string;
  tagline: string;
  /** 왕복 거래비용율(%) — '순수익(수수료 후)' 고지·비용 인지 표면화(DAR-418). */
  roundTripCostPct: number;
  trades: ScalpTradeRow[];
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

/** F11: 해당 YYYYMMDD 가 속한 ISO 주의 월요일(YYYYMMDD). 주간 손실 한도 윈도우 시작. */
function weekStartCompact(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=일..6=토
  dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // 월요일로 back
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
    // ★DAR-414/423: 분봉 collector(engine3)와 동일한 거래일 해석기 — tradeDate SSOT 정렬.
    //   분봉/단타는 인트라데이 해석(resolveIntradayTradeDate)으로 장중엔 today, 장외엔 직전
    //   거래일을 쓴다. 동일 해석기를 공유해 분봉 라벨과 단타 조회 라벨 불일치를 구조적으로 차단한다.
    @Optional() private readonly tradeDateResolver?: KrxMarketDataScheduler,
    // ★DAR-424: 체결 알림 producer(@Optional — 큐 미설정 환경/테스트에선 미주입, graceful no-op).
    //   진입/청산 체결 직후 TRADE_ENTRY/TRADE_EXIT 발행. 알림은 통지일 뿐 — 체결을 깨지 않는다.
    @Optional() private readonly notifyProducer?: NotificationProducerService,
    // ★F5(2026-06-27): kill-switch 영속 상태(TradingRiskModule 공유 싱글톤). 운영자가 발동하면
    //   신규 진입을 차단한다(과거 killSwitchActive:false 하드코딩으로 단타가 우회하던 결함 해소).
    //   @Optional — 미주입(일부 단위 테스트)이면 비활성 폴백 + 경고 1회(결선 누락 가시화).
    @Optional() private readonly killSwitch?: KillSwitchManager,
  ) {
    if (!this.killSwitch) {
      this.logger.warn('[Scalp] KillSwitchManager 미주입 — kill-switch 게이트 비활성(결선 확인)');
    }
  }

  /** DAR-424 체결 알림 — 트랙 식별·딥링크 상수(분봉 단타). */
  private static readonly STRATEGY_LABEL = '분봉 단타';
  private static readonly DEEP_LINK = '/portfolio/strategy/intraday-scalp';

  /**
   * ★DAR-414/423 tradeDate SSOT — 분봉 collector(StockMinutePriceCollector)와 동일 소스.
   *   해석기가 주입돼 있으면 인트라데이 거래일(resolveIntradayTradeDate)을 사용(분봉 라벨과 일치
   *   보장). 장중(평일·KST≥09:00)이면 오늘, 장외면 직전 거래일이다 — 일봉 발행 기준
   *   resolveLatestAvailableTradeDate 가 장중 어제를 반환하던 버그(DAR-423)를 분리 해소한다.
   *   미주입(단위 테스트 등) 시에만 환경 시계 today 로 폴백한다.
   *   해석기 자체에 KRX 프로브 실패·DB 폴백·미래일 클램프가 내장돼 있어 graceful.
   */
  private async resolveTradeDate(now: Date): Promise<string> {
    if (this.tradeDateResolver) {
      try {
        return await this.tradeDateResolver.resolveIntradayTradeDate(now);
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

  /**
   * L[1](2026-06-26): 강제청산 체결가 해석 — 실시간 신선분 → 당일 마지막 분봉종가 →
   * 같은 거래일 일봉종가 → (최후)진입가. 진입가 최후폴백이 실제 발동하면 priceMissing=true
   * (정직 고지 대상) — '가격 결측 시 진입가로 0% 손익 날조' 데이터정합 결함 방지.
   * ★ 일봉은 반드시 '포지션 자신의 거래일(t.tradeDate)' 한정 — orderBy desc(최신)는 어제 종가를
   *   오늘 손익으로 영속하는 cross-day 가짜손익(DAR-433 부류)을 만들므로 금지.
   */
  private async resolveExitPrice(
    t: { corpCode: string; stockCode: string; entryPrice: unknown; tradeDate: string },
    candles: ScalpCandle[],
    nowMs: number,
  ): Promise<{ price: number; priceMissing: boolean }> {
    const live = this.currentPrice(t.corpCode, candles, nowMs);
    if (live !== null) return { price: live, priceMissing: false };
    const daily = await this.prisma.stockDailyPrice.findFirst({
      where: { stockCode: t.stockCode, tradeDate: t.tradeDate },
      select: { closePrice: true },
    });
    if (daily?.closePrice != null) {
      return { price: toNum(daily.closePrice), priceMissing: false };
    }
    return { price: toNum(t.entryPrice), priceMissing: true };
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
   * F11(2026-06-27): 이번주(월~tradeDate) 실현손익 합 — 주간 손실 한도(WEEKLY_LOSS_LIMIT) 입력.
   * 과거엔 weeklyPnl 에 당일 실현손익(realized)을 그대로 넣어 주간 한도가 사실상 무력했다.
   * YYYYMMDD 는 고정폭·zero-pad 라 문자열 gte/lte 범위가 시간순과 일치(월·연 경계 안전).
   */
  private async weeklyRealizedPnl(tradeDate: string): Promise<number> {
    const weekStart = weekStartCompact(tradeDate);
    const rows = await this.prisma.intradayScalpTrade.findMany({
      where: {
        tradeDate: { gte: weekStart, lte: tradeDate },
        styleTag: INTRADAY_SCALP_STYLE_TAG,
      },
      select: { netPnl: true },
    });
    let sum = 0;
    for (const r of rows) sum += toNum(r.netPnl);
    return sum;
  }

  /**
   * DAR-424: 체결 알림용 포트폴리오 스냅샷 — 현금·전체 평가금(현재가 기준).
   *   cash = 초기자본 + 실현손익(CLOSED net) − 보유 진입원가(OPEN 진입가×수량)
   *   totalValue = cash + 보유 평가합(OPEN 현재가×수량). (현재가=실시간 신선분 우선·없으면 분봉 종가)
   */
  private async computeScalpSnapshot(now: Date): Promise<{ cash: number; totalValue: number }> {
    const rows = await this.prisma.intradayScalpTrade.findMany({
      where: { styleTag: INTRADAY_SCALP_STYLE_TAG },
      select: {
        status: true,
        netPnl: true,
        entryPrice: true,
        shares: true,
        corpCode: true,
        stockCode: true,
        tradeDate: true,
      },
    });
    let realized = 0;
    let openCost = 0;
    const openTrades = rows.filter((r) => r.status === 'OPEN');
    for (const r of rows) {
      if (r.status === 'CLOSED') realized += toNum(r.netPnl);
      else openCost += toNum(r.entryPrice) * r.shares;
    }
    const nowMs = now.getTime();
    let openValue = 0;
    for (const t of openTrades) {
      const candles = await this.loadTodayCandles(t.stockCode, t.tradeDate);
      const price = this.currentPrice(t.corpCode, candles, nowMs) ?? toNum(t.entryPrice);
      openValue += price * t.shares;
    }
    const cash = SCALP_INITIAL_CAPITAL + realized - openCost;
    return { cash, totalValue: cash + openValue };
  }

  /** DAR-424: 종목명(Company.corpName) — 없으면 stockCode 폴백. */
  private async corpNameOf(corpCode: string, stockCode: string): Promise<string> {
    const c = await this.prisma.company.findUnique({
      where: { corpCode },
      select: { corpName: true },
    });
    return c?.corpName ?? stockCode;
  }

  /** DAR-424: 매수 체결 알림 발행(graceful — 실패해도 체결을 깨지 않는다). */
  private async emitTradeEntry(
    refId: string,
    corpCode: string,
    stockCode: string,
    price: number,
    shares: number,
    now: Date,
  ): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      const [snapshot, corpName] = await Promise.all([
        this.computeScalpSnapshot(now),
        this.corpNameOf(corpCode, stockCode),
      ]);
      await this.notifyProducer.enqueueTradeEntry({
        kind: 'ENTRY',
        refId,
        strategyKey: INTRADAY_SCALP_STYLE_TAG,
        strategyLabel: IntradayScalpService.STRATEGY_LABEL,
        corpCode,
        stockCode,
        corpName,
        price,
        shares,
        cash: snapshot.cash,
        totalValue: snapshot.totalValue,
        deepLink: IntradayScalpService.DEEP_LINK,
      });
    } catch (e) {
      this.logger.warn(`[Scalp] 매수 체결 알림 발행 실패(graceful): ${(e as Error).message}`);
    }
  }

  /** DAR-424: 매도 체결 알림 발행(graceful). */
  private async emitTradeExit(
    refId: string,
    corpCode: string,
    stockCode: string,
    price: number,
    shares: number,
    pnlPct: number,
    exitReason: ScalpExitReason,
    now: Date,
  ): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      const [snapshot, corpName] = await Promise.all([
        this.computeScalpSnapshot(now),
        this.corpNameOf(corpCode, stockCode),
      ]);
      await this.notifyProducer.enqueueTradeExit({
        kind: 'EXIT',
        refId,
        strategyKey: INTRADAY_SCALP_STYLE_TAG,
        strategyLabel: IntradayScalpService.STRATEGY_LABEL,
        corpCode,
        stockCode,
        corpName,
        price,
        shares,
        pnlPct,
        exitReason,
        cash: snapshot.cash,
        totalValue: snapshot.totalValue,
        deepLink: IntradayScalpService.DEEP_LINK,
      });
    } catch (e) {
      this.logger.warn(`[Scalp] 매도 체결 알림 발행 실패(graceful): ${(e as Error).message}`);
    }
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
    // F5(2026-06-27): kill-switch 발동 시 신규 진입 차단(청산은 계속 허용 — 오버나잇 리스크 회피).
    if (this.killSwitch?.isActive()) {
      return { ...base, ran: true, skipped: false, reason: '킬스위치 발동 — 신규 진입 차단' };
    }

    // ★DAR-418 진입 fee 허들 게이트: 기대이동(gross 익절폭)이 왕복비용+최소마진을 넘지 못하면
    //   진입 보류(수수료만 내는 무의미 거래 차단). 비용율 SSOT = 체결 파라미터에서 산출.
    //   고정 설정(순 +2% 익절)이라 사이클 단위 상수 — 후보 루프 전 1회 평가.
    const grossTpPct = grossTakeProfitThresholdPct(DEFAULT_SCALP_EXIT_PARAMS);
    if (!passesEntryFeeHurdle(grossTpPct, DEFAULT_SCALP_EXIT_PARAMS.roundTripCostPct)) {
      return {
        ...base,
        reason: `진입 fee 허들 미달 — 기대이동 ${grossTpPct.toFixed(2)}% ≤ 왕복비용 ${DEFAULT_SCALP_EXIT_PARAMS.roundTripCostPct.toFixed(2)}%+마진`,
      };
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
    const weeklyRealized = await this.weeklyRealizedPnl(tradeDate); // F11: 이번주 누적
    const budget = SCALP_INITIAL_CAPITAL * PER_POSITION_BUDGET_PCT;

    // DAR-426: 가용현금 가드(방어선) — 단타는 MAX_OPEN_POSITIONS(5)×PER_POSITION_BUDGET_PCT(3%)
    //   =15% < 100% 라 구조적으로 음수 현금이 불가능하지만, 시스템모의와 동일한 현금 불변식
    //   (cash = 초기자본 + 실현손익 − 보유 진입원가 ≥ 0)을 명시적으로 enforce 한다.
    const allTrades = await this.prisma.intradayScalpTrade.findMany({
      where: { styleTag: INTRADAY_SCALP_STYLE_TAG },
      select: { status: true, netPnl: true, entryPrice: true, shares: true },
    });
    let availableCash = SCALP_INITIAL_CAPITAL;
    for (const t of allTrades) {
      if (t.status === 'CLOSED') availableCash += toNum(t.netPnl);
      else availableCash -= toNum(t.entryPrice) * t.shares;
    }

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
      // DAR-426: 현금 소진 시 추가 진입 중단(현금<0 절대 금지).
      if (availableCash <= 0) break;
      // 슬리피지 반영가로 수량 산정 → 진입원가(=체결가×수량) ≤ 가용현금 보장.
      const effPrice = price * (1 + DEFAULT_FILL_PARAMS.slippagePct);
      const shares = Math.floor(Math.min(budget, availableCash) / effPrice);
      if (shares <= 0) continue;

      // engine5 Risk 하드룰(순수 Rule) — 위반 시 진입 거부(veto).
      const risk = checkRisk({
        corpCode: cand.corpCode,
        stockCode: cand.stockCode,
        side: 'BUY',
        requestedShares: shares,
        limitPrice: price,
        totalCapital: SCALP_INITIAL_CAPITAL,
        // 불변식: 종목당 1라운드트립 dedup + EOD 강제청산 → 신규 진입 종목 기보유 0.
        currentPositionValue: 0,
        dailyPnl: realized,
        weeklyPnl: weeklyRealized, // F11: 당일치 재사용 금지 — 이번주 누적
        openOrderCount: openCount + entered,
        todayTradeCount: count + entered,
        killSwitchActive: this.killSwitch?.isActive() ?? false, // F5: 영속 상태 반영
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

      const createdTrade = await this.prisma.intradayScalpTrade.create({
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
        select: { id: true },
      });
      entered += 1;
      // DAR-426: 진입원가만큼 가용현금 차감(슬리피지 반영가 산정 → 현금 음수 불가).
      availableCash -= fill.filledPrice * fill.filledShares;
      enteredTodayStocks.add(cand.stockCode); // 같은 사이클 내 재진입 방지
      this.logger.log(
        `[Scalp] 진입 ${cand.stockCode} ${fill.filledShares}주 @${fill.filledPrice} ` +
          `(충족봉 ${scan.candle.ts.toISOString()}·${decision.detail})`,
      );
      // DAR-424 매수 체결 알림(graceful — OPEN 영속 직후 스냅샷 산출).
      await this.emitTradeEntry(
        createdTrade.id,
        cand.corpCode,
        cand.stockCode,
        fill.filledPrice,
        fill.filledShares,
        now,
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
      corpCode: string;
      stockCode: string;
      tradeDate: string;
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
    // ★DAR-435 청산 ts 를 entryTs(분봉 KST 벽시계 naive)와 동일 timebase 로 통일한다.
    //   진입 거래일(trade.tradeDate) 기준 청산 KST 벽시계 HHMM 을 분봉 ts 로 산출(날짜 경계 교차 차단).
    // ★DAR-444 가드레일 — 장외/역전 청산시각이 절대 DB에 영속되지 않게 봉인(실투자 불변식).
    //   ① `?? now`(UTC instant) 폴백 제거: 폴백이 발동하면 entry 와 9시간 어긋난 00~06시 청산이 재발하므로 금지.
    //   ② 정규장(09:00~15:30 KST)·entryTs 이후로 clamp: timebase 오염·역전·장외가 들어와도 안전 경계로 보정.
    const exitCandidate = minuteTimestamp(trade.tradeDate, this.hhmm(now));
    const marketOpen = minuteTimestamp(trade.tradeDate, '0900');
    const marketClose = minuteTimestamp(trade.tradeDate, '1530');
    let exitTsKst: Date;
    if (exitCandidate && marketOpen && marketClose) {
      const lo = Math.max(trade.entryTs.getTime(), marketOpen.getTime());
      const hi = marketClose.getTime();
      const clamped = Math.min(Math.max(exitCandidate.getTime(), lo), hi);
      if (clamped !== exitCandidate.getTime()) {
        this.logger.warn(
          `[Scalp][가드레일] 청산 ts 보정 ${trade.stockCode}: ${exitCandidate.toISOString()} → ${new Date(clamped).toISOString()} (entry=${trade.entryTs.toISOString()}, reason=${reason})`,
        );
      }
      exitTsKst = new Date(clamped);
    } else {
      // tradeDate/hhmm 파싱 실패 — UTC now 폴백 금지. entryTs(분봉 KST)로 최소한 역전·장외 차단.
      exitTsKst = trade.entryTs;
      this.logger.error(
        `[Scalp][가드레일] minuteTimestamp 파싱 실패 → exitTs=entryTs 폴백 ${trade.stockCode} (tradeDate=${trade.tradeDate}, hhmm=${this.hhmm(now)})`,
      );
    }
    const holdMinutes = Math.max(
      0,
      Math.floor((exitTsKst.getTime() - trade.entryTs.getTime()) / 60_000),
    );

    await this.prisma.intradayScalpTrade.update({
      where: { id: trade.id },
      data: {
        status: 'CLOSED',
        exitTs: exitTsKst,
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
    // DAR-424 매도 체결 알림(graceful — CLOSED 영속 직후 스냅샷 산출).
    await this.emitTradeExit(
      trade.id,
      trade.corpCode,
      trade.stockCode,
      exitPrice,
      trade.shares,
      returnPct,
      reason,
      now,
    );
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
    // L[3](2026-06-27): 전일 OPEN(15:20 강제청산 누락 추정분)을 익일 개장 시 sweep — 오버나잇 절대 금지 보강.
    const sweptStale = await this.catchUpStaleForceClose(tradeDate);
    const nowHhmm = this.hhmm(now);
    const open = await this.prisma.intradayScalpTrade.findMany({
      where: { status: 'OPEN', styleTag: INTRADAY_SCALP_STYLE_TAG },
    });
    const nowMs = now.getTime();
    let exited = 0;
    for (const t of open) {
      const candles = await this.loadTodayCandles(t.stockCode, t.tradeDate);
      // L[1]: 실시간·분봉 모두 결측이면 TP/SL 평가 불가 → 진입가 날조(0% 손익) 대신 스킵.
      //   강제청산 시각(15:20) 안전망은 forceCloseAll(일봉 폴백 포함)이 담당한다.
      const price = this.currentPrice(t.corpCode, candles, nowMs);
      if (price === null) {
        this.logger.warn(
          `[Scalp] 가격결측 — 청산평가 스킵(forceCloseAll 일봉 폴백 위임) ${t.stockCode}`,
        );
        continue;
      }
      const decision = evaluateScalpExit(toNum(t.entryPrice), price, nowHhmm);
      if (!decision.shouldExit || decision.reason === null) continue;
      await this.closePosition(t, price, decision.reason, now);
      exited += 1;
    }
    return {
      ran: true,
      skipped: false,
      tradeDate,
      evaluated: open.length + sweptStale,
      exited: exited + sweptStale,
    };
  }

  /**
   * L[3](2026-06-27): 전일(또는 그 이전) OPEN 단타 포지션을 강제청산한다(catch-up).
   * 15:20 강제청산 잡이 누락(프로세스 다운 등)되면 OPEN 이 오버나잇으로 잔존하는데, 익일 개장
   * 첫 청산 사이클에서 이를 sweep 해 '오버나잇 절대 금지' 불변식을 복원한다.
   * 체결가는 '포지션 자신의 거래일' 데이터만 사용(분봉 마지막→같은 거래일 일봉→진입가). 실시간/
   * 타일자 혼입 금지(cross-day 가짜손익 차단). exitTs 는 그 거래일 15:25(정규장 clamp 내).
   */
  private async catchUpStaleForceClose(today: string): Promise<number> {
    const stale = await this.prisma.intradayScalpTrade.findMany({
      where: {
        status: 'OPEN',
        tradeDate: { lt: today },
        styleTag: INTRADAY_SCALP_STYLE_TAG,
      },
    });
    if (stale.length === 0) return 0;
    this.logger.warn(
      `[Scalp][오버나잇방지] 전일 이전 OPEN ${stale.length}건 catch-up 강제청산(15:20 잡 누락 추정)`,
    );
    let closed = 0;
    for (const t of stale) {
      // 그 거래일 15:25 기준 시각(정규장 내) — closePosition 의 DAR-444 clamp 가 exitTs 를 해당일로 고정.
      const staleNow = minuteTimestamp(t.tradeDate, '1525') ?? new Date();
      const candles = await this.loadTodayCandles(t.stockCode, t.tradeDate);
      // staleNow.getTime() 전달 → 오늘 실시간 캐시는 신선도 미충족(null)로 떨어지고 그 거래일 데이터만 사용.
      const { price, priceMissing } = await this.resolveExitPrice(t, candles, staleNow.getTime());
      if (priceMissing) {
        this.logger.error(
          `[Scalp][데이터정합] catch-up 강제청산 가격결측 — 진입가 폴백 ${t.stockCode} tradeDate=${t.tradeDate}`,
        );
      }
      await this.closePosition(t, price, 'FORCE_CLOSE_EOD', staleNow);
      closed += 1;
    }
    return closed;
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
      // L[1]: 실측 폴백체인(실시간→분봉→같은거래일 일봉→진입가). 진입가 최후폴백 시 정직 고지.
      const { price, priceMissing } = await this.resolveExitPrice(t, candles, nowMs);
      if (priceMissing) {
        this.logger.error(
          `[Scalp][데이터정합] 강제청산 가격결측 — 진입가 폴백(손익 0% 기록=실손익 아님) ${t.stockCode} tradeDate=${t.tradeDate}`,
        );
      }
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
      select: { status: true, tradeDate: true, netPnl: true, returnPct: true, commission: true, tax: true },
    });
    const open = rows.filter((r) => r.status === 'OPEN');
    const closed = rows.filter((r) => r.status === 'CLOSED');

    let realizedPnl = 0;
    let totalFees = 0;
    let wins = 0;
    const byDate = new Map<string, number>();
    for (const r of closed) {
      const net = toNum(r.netPnl);
      realizedPnl += net;
      totalFees += toNum(r.commission) + toNum(r.tax); // ★DAR-418 총수수료(수수료+세금)
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
      roundTripCostPct: DEFAULT_SCALP_EXIT_PARAMS.roundTripCostPct,
      takeProfitNetPct: DEFAULT_SCALP_EXIT_PARAMS.takeProfitPct,
      stopLossNetPct: DEFAULT_SCALP_EXIT_PARAMS.stopLossPct,
      totalFees,
      equityCurve,
    };
  }

  /**
   * 단타 거래 타임라인(표면화) — DAR-416. 최신 진입순(entryTs desc) 종목별 1행.
   *   OPEN 포지션은 청산 필드 null(보유 중). 종목명은 Company.corpName 결합(없으면 stockCode).
   *   게스트 조회 가능(컨트롤러 OptionalJwt) — forward 모의 트랙은 공개 성과.
   */
  async getTradeHistory(): Promise<ScalpTradeHistory> {
    const rows = await this.prisma.intradayScalpTrade.findMany({
      where: { styleTag: INTRADAY_SCALP_STYLE_TAG },
      orderBy: [{ entryTs: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        stockCode: true,
        corpCode: true,
        tradeDate: true,
        entryTs: true,
        entryPrice: true,
        shares: true,
        entryReason: true,
        exitTs: true,
        exitPrice: true,
        exitReason: true,
        returnPct: true,
        grossPnl: true,
        netPnl: true,
        commission: true,
        tax: true,
        status: true,
      },
    });

    const corpCodes = Array.from(new Set(rows.map((r) => r.corpCode)));
    const companies = corpCodes.length
      ? await this.prisma.company.findMany({
          where: { corpCode: { in: corpCodes } },
          select: { corpCode: true, corpName: true },
        })
      : [];
    const nameMap = new Map(companies.map((c) => [c.corpCode, c.corpName]));

    const trades: ScalpTradeRow[] = rows.map((r) => {
      const isClosed = r.status === 'CLOSED';
      const netReturnPct = r.returnPct != null ? toNum(r.returnPct) : null;
      // ★DAR-418 gross 수익률 = grossPnl / 진입원가(진입가×수량). 비용 미반영(net 과 대비).
      const entryCost = toNum(r.entryPrice) * r.shares;
      const grossReturnPct =
        isClosed && r.grossPnl != null && entryCost > 0 ? (toNum(r.grossPnl) / entryCost) * 100 : null;
      const totalFees = isClosed ? toNum(r.commission) + toNum(r.tax) : null;
      return {
        id: r.id,
        stockCode: r.stockCode,
        corpName: nameMap.get(r.corpCode) ?? r.stockCode,
        tradeDate: r.tradeDate,
        // ★DAR-435 entry/exit 둘 다 분봉 KST 벽시계 naive → `+09:00` 오프셋 명시 ISO 로 직렬화.
        //   `toISOString()`(UTC `Z`)은 클라이언트의 Asia/Seoul 변환과 이중 오프셋(+9 중복) → 19:14 류 표시.
        entryTs: kstWallClockIso(r.entryTs),
        exitTs: r.exitTs ? kstWallClockIso(r.exitTs) : null,
        entryReason: r.entryReason,
        exitReason: (r.exitReason as ScalpExitReason | null) ?? null,
        entryPrice: toNum(r.entryPrice),
        exitPrice: r.exitPrice != null ? toNum(r.exitPrice) : null,
        returnPct: netReturnPct,
        grossReturnPct,
        netReturnPct,
        netPnl: r.netPnl != null ? toNum(r.netPnl) : null,
        totalFees,
        status: isClosed ? 'CLOSED' : 'OPEN',
      };
    });

    return {
      styleTag: INTRADAY_SCALP_STYLE_TAG,
      strategyKey: INTRADAY_SCALP_STYLE_TAG,
      tagline: '분봉 단타 — 거래량 폭발+돌파+VWAP 진입, 당일 청산(오버나잇 금지)',
      roundTripCostPct: DEFAULT_SCALP_EXIT_PARAMS.roundTripCostPct,
      trades,
    };
  }
}
