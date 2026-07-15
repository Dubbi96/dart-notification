import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { dateFromTradeDate } from './candle-query';
import {
  NormalizedIndicatorQuery,
  RawIndicatorQuery,
  normalizeIndicatorQuery,
} from './indicator-query';

/**
 * 기술지표 구간 조회(indicators) 서비스 — W13 데이터 자산 표면 개방 (read-only).
 *
 * TechnicalIndicator 는 전종목 EOD 적재·인덱스 완비(@@unique([stockCode, tradeDate]))인데
 * 사용자 조회 API 가 0개였다(ops 백필 POST /indicators/backfill 만 존재). GET /market-data/candles
 * 와 동일한 파라미터·응답 규약(from~to+페이지네이션+limit 다운샘플 상한, newest-first 조회 후
 * 오름차순 반환)으로 개방한다 — Buy Score 입력 근거를 사용자가 직접 검증할 수 있게 하는
 * 투명성 표면이다.
 *
 * ★정직 계약: latestTradeDate(지표 기준일 — 조회 구간과 무관한 이 종목의 적재 최신 tradeDate)를
 *   항상 포함한다. 일봉 T+1 지연 이력이 있으므로 모바일이 stale 을 숨기지 않고 배지로 고지한다.
 *   조회 실패(관계 부재 등)는 빈 배열 + source=UNAVAILABLE 로 graceful 흡수(캔들 패턴 동일).
 *
 * AI 금지영역: 순수 조회뿐. 점수 계산·체결·하드룰과 무관(노출만, 계산 로직 무변경).
 */

/** 지표 한 점 — tradeDate(YYYYMMDD) + 1d 캔들과 동일 규약의 time(거래일 자정 UTC ISO, 조인 편의). */
export interface IndicatorPoint {
  /** 기준 거래일 'YYYYMMDD'(KST). 1d 캔들과 이 값으로 조인한다. */
  tradeDate: string;
  /** 거래일 대표 instant(자정 UTC = 09:00 KST 같은 날, ISO 8601) — 1d 캔들 time 과 동일 규약. */
  time: string;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerMid: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  vwap: number | null;
  volumeRatio20: number | null;
  high52w: number | null;
  low52w: number | null;
  /** 공시 전 선행상승률 D-5~D-1 (%). 커버리지 구멍 가능(nullable) — 모바일은 '—' 처리. */
  preDsclReturn: number | null;
}

export interface IndicatorSeriesResult {
  stockCode: string;
  /**
   * EOD: KRX 일봉 확정치에서 계산·적재된 지표(technical_indicators) ·
   * UNAVAILABLE: 조회 불가 graceful.
   */
  source: 'EOD' | 'UNAVAILABLE';
  /** 서버 조회시각(ISO 8601). 환경 시계 괴리 고지용. */
  asOf: string;
  /**
   * ★지표 기준일(YYYYMMDD) — 조회 구간과 무관한 이 종목의 적재 최신 tradeDate.
   * T+1 지연 이력 고지용(캔들 최신일보다 이전이면 stale). 적재 0행이면 null.
   */
  latestTradeDate: string | null;
  /** 반환 지표 행 수. */
  count: number;
  /**
   * 다음(과거) 페이지 커서 — 이 페이지에서 가장 오래된 거래일의 ISO 시각(캔들 계약 동일).
   * before 로 다시 넘기면 그 이전 지표를 잇는다. 더 없으면 null.
   */
  nextCursor: string | null;
  /** 거래일 오름차순 지표. */
  points: IndicatorPoint[];
}

/** Prisma select 결과 행(도메인 필드만). */
interface IndicatorRow {
  tradeDate: string;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerMid: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  vwap: number | null;
  volumeRatio20: number | null;
  high52w: number | null;
  low52w: number | null;
  preDsclReturn: number | null;
}

const INDICATOR_SELECT = {
  tradeDate: true,
  ma5: true,
  ma20: true,
  ma60: true,
  ma120: true,
  rsi14: true,
  macdLine: true,
  macdSignal: true,
  macdHistogram: true,
  bollingerUpper: true,
  bollingerMid: true,
  bollingerLower: true,
  atr14: true,
  vwap: true,
  volumeRatio20: true,
  high52w: true,
  low52w: true,
  preDsclReturn: true,
} as const;

@Injectable()
export class IndicatorHistoryService {
  private readonly logger = new Logger(IndicatorHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 구간 지표 조회. raw 파라미터를 정규화(검증)한 뒤 newest-first 로 limit 만큼 조회하고
   * 오름차순으로 뒤집어 반환한다(최근 구간 우선 — 캔들과 동일).
   * @throws IndicatorQueryError 입력 검증 실패(컨트롤러가 400 매핑).
   */
  async getIndicators(
    raw: RawIndicatorQuery,
    nowMs: number = Date.now(),
  ): Promise<IndicatorSeriesResult> {
    const q = normalizeIndicatorQuery(raw);
    const asOf = new Date(nowMs).toISOString();

    let rows: IndicatorRow[];
    let latestTradeDate: string | null;
    try {
      [rows, latestTradeDate] = await Promise.all([
        this.queryRows(q),
        this.queryLatestTradeDate(q.stockCode),
      ]);
    } catch (err) {
      // 조회 실패 — 비파괴 graceful(캔들 UNAVAILABLE 패턴 동일).
      this.logger.warn(
        `지표 조회 실패(graceful UNAVAILABLE): stock=${q.stockCode} — ${
          (err as Error)?.message ?? err
        }`,
      );
      return {
        stockCode: q.stockCode,
        source: 'UNAVAILABLE',
        asOf,
        latestTradeDate: null,
        count: 0,
        nextCursor: null,
        points: [],
      };
    }

    // 조회는 newest-first(DESC). 차트 조인용으로 오름차순으로 뒤집는다.
    const ascending = [...rows].reverse();
    const points: IndicatorPoint[] = [];
    for (const r of ascending) {
      const time = dateFromTradeDate(r.tradeDate);
      // 형식 불량 거래일은 방어적으로 제외(빈 오버레이 graceful — 캔들 1d 동일).
      if (time == null) continue;
      points.push({
        tradeDate: r.tradeDate,
        time: time.toISOString(),
        ma5: r.ma5,
        ma20: r.ma20,
        ma60: r.ma60,
        ma120: r.ma120,
        rsi14: r.rsi14,
        macdLine: r.macdLine,
        macdSignal: r.macdSignal,
        macdHistogram: r.macdHistogram,
        bollingerUpper: r.bollingerUpper,
        bollingerMid: r.bollingerMid,
        bollingerLower: r.bollingerLower,
        atr14: r.atr14,
        vwap: r.vwap,
        volumeRatio20: r.volumeRatio20,
        high52w: r.high52w,
        low52w: r.low52w,
        preDsclReturn: r.preDsclReturn,
      });
    }

    // 더 과거가 남아있으면(가득 찼으면) 가장 오래된 거래일을 커서로(캔들 계약 동일).
    const nextCursor =
      rows.length === q.limit && points.length > 0 ? points[0].time : null;

    return {
      stockCode: q.stockCode,
      source: 'EOD',
      asOf,
      latestTradeDate,
      count: points.length,
      nextCursor,
      points,
    };
  }

  /**
   * @@unique([stockCode, tradeDate]) 인덱스로 구간·커서·limit newest-first 조회.
   * tradeDate 'YYYYMMDD' 사전식 비교 == 시간 순서.
   */
  private async queryRows(q: NormalizedIndicatorQuery): Promise<IndicatorRow[]> {
    const tradeDateFilter: { gte?: string; lte?: string; lt?: string } = {};
    if (q.fromTradeDate != null) tradeDateFilter.gte = q.fromTradeDate;
    if (q.toTradeDate != null) tradeDateFilter.lte = q.toTradeDate;
    if (q.beforeTradeDate != null) tradeDateFilter.lt = q.beforeTradeDate;

    return this.prisma.technicalIndicator.findMany({
      where: {
        stockCode: q.stockCode,
        ...(Object.keys(tradeDateFilter).length > 0
          ? { tradeDate: tradeDateFilter }
          : {}),
      },
      orderBy: { tradeDate: 'desc' },
      take: q.limit,
      select: INDICATOR_SELECT,
    });
  }

  /** ★지표 기준일 — 조회 구간과 무관한 이 종목의 적재 최신 tradeDate(T+1 stale 고지 근거). */
  private async queryLatestTradeDate(stockCode: string): Promise<string | null> {
    const latest = await this.prisma.technicalIndicator.findFirst({
      where: { stockCode },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    return latest?.tradeDate ?? null;
  }
}
