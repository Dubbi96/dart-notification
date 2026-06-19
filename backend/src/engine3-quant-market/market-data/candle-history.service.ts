import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CandleResolution,
  NormalizedCandleQuery,
  RawCandleQuery,
  dateFromTradeDate,
  normalizeCandleQuery,
  tradeDateFromMs,
} from './candle-query';

/**
 * 분봉/일봉 구간 조회(candles) 서비스 — TimescaleDB 하이퍼테이블 + 연속집계 (DAR-378, read-only).
 *
 * 대규모 시계열(분봉)을 from~to 구간 + 해상도(1m/5m/15m/1d) + 페이지네이션 + 서버측 다운샘플로
 * 반환한다. 해상도가 분(1m)이면 원본 하이퍼테이블 stock_minute_prices 를, 5m/15m 이면 연속집계
 * 머티리얼라이즈드 뷰를 조회해 원본 풀스캔을 피한다(응답 효율 레이어).
 *
 * ★1d 일봉(DAR-384): 캐노니컬 소스는 KRX 딥히스토리 stock_daily_prices(StockDailyPrice 백필,
 *   2010~). 분봉 롤업 stock_candles_1d 는 분봉 수집 시작 이후(forward)만 커버하므로 과거 일봉을
 *   못 본다 → 1d 는 stock_daily_prices(tradeDate 'YYYYMMDD')를 source=EOD 로 서빙한다.
 *
 * 정직 계약: 데이터 출처를 source 로 명시한다(TIMESCALE=분봉 하이퍼테이블/집계 · EOD=KRX 일봉).
 *   관계가 없거나(확장/마이그레이션 미반영) 조회 실패 시 빈 배열 + source=UNAVAILABLE 로 graceful
 *   흡수한다(기존 minute-candles 패턴과 동일 — 비파괴 read-only).
 *
 * AI 금지영역: 순수 조회·집계뿐. 점수·체결·하드룰과 무관.
 */

/** 캔들 한 점 — time 은 ISO 8601(UTC instant)로 일관 반환(구간 조회라 HHMMSS 모호성 회피). */
export interface CandlePoint {
  /** 버킷 시각(ISO 8601, UTC). */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 거래량(다운샘플 시 버킷 합). */
  volume: number;
}

export interface CandleSeriesResult {
  stockCode: string;
  resolution: CandleResolution;
  /**
   * TIMESCALE: 분봉 하이퍼테이블/연속집계(1m/5m/15m) · EOD: KRX 일봉 stock_daily_prices(1d, DAR-384) ·
   * UNAVAILABLE: 미적용/조회불가 graceful.
   */
  source: 'TIMESCALE' | 'EOD' | 'UNAVAILABLE';
  /** 서버 조회시각(ISO 8601). 환경 시계 괴리 고지용. */
  asOf: string;
  /** 반환 캔들 수. */
  count: number;
  /**
   * 다음(과거) 페이지 커서 — 이 페이지에서 가장 오래된 버킷의 ISO 시각.
   * before 로 다시 넘기면 그 이전 캔들을 잇는다. 더 없으면 null.
   */
  nextCursor: string | null;
  /** 시간 오름차순 캔들. */
  candles: CandlePoint[];
}

interface CandleRow {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: bigint | number;
}

/** stock_daily_prices 행(DAR-384) — time 대신 tradeDate 'YYYYMMDD' 문자열. */
interface DailyRow {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: bigint | number;
}

@Injectable()
export class CandleHistoryService {
  private readonly logger = new Logger(CandleHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 구간 캔들 조회. raw 파라미터를 정규화(검증)한 뒤 해상도에 맞는 관계를 newest-first 로
   * limit 만큼 조회하고 오름차순으로 뒤집어 반환한다(최근 구간 우선 다운샘플).
   * @throws CandleQueryError 입력 검증 실패(컨트롤러가 400 매핑).
   */
  async getCandles(
    raw: RawCandleQuery,
    nowMs: number = Date.now(),
  ): Promise<CandleSeriesResult> {
    const q = normalizeCandleQuery(raw);
    const asOf = new Date(nowMs).toISOString();
    const isDaily = q.source.kind === 'daily';

    let rows: CandleRow[];
    try {
      rows = isDaily ? await this.queryDailyRows(q) : await this.queryRows(q);
    } catch (err) {
      // 관계 부재(확장/마이그레이션 미적용) 등 — 비파괴 graceful.
      this.logger.warn(
        `캔들 조회 실패(graceful UNAVAILABLE): stock=${q.stockCode} res=${q.resolution} — ${
          (err as Error)?.message ?? err
        }`,
      );
      return {
        stockCode: q.stockCode,
        resolution: q.resolution,
        source: 'UNAVAILABLE',
        asOf,
        count: 0,
        nextCursor: null,
        candles: [],
      };
    }

    // 조회는 newest-first(DESC). 차트용으로 오름차순으로 뒤집는다.
    const ascending = [...rows].reverse();
    const candles: CandlePoint[] = ascending.map((r) => ({
      time: r.time.toISOString(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    // 더 과거가 남아있으면(가득 찼으면) 가장 오래된 버킷을 커서로.
    const nextCursor =
      rows.length === q.limit && candles.length > 0 ? candles[0].time : null;

    return {
      stockCode: q.stockCode,
      resolution: q.resolution,
      source: isDaily ? 'EOD' : 'TIMESCALE',
      asOf,
      count: candles.length,
      nextCursor,
      candles,
    };
  }

  /**
   * 해상도별 관계(하이퍼테이블/연속집계)에서 구간·커서·limit 으로 newest-first 조회.
   * 관계명·시간컬럼은 고정 화이트리스트(주입 안전). 값은 파라미터 바인딩.
   */
  private async queryRows(q: NormalizedCandleQuery): Promise<CandleRow[]> {
    const rel = Prisma.raw(`"${q.source.relation}"`);
    const tcol = Prisma.raw(`"${q.source.timeColumn}"`);

    const conds: Prisma.Sql[] = [Prisma.sql`"stockCode" = ${q.stockCode}`];
    if (q.fromMs != null) {
      conds.push(Prisma.sql`${tcol} >= ${new Date(q.fromMs)}`);
    }
    if (q.toMs != null) {
      conds.push(Prisma.sql`${tcol} <= ${new Date(q.toMs)}`);
    }
    if (q.beforeMs != null) {
      conds.push(Prisma.sql`${tcol} < ${new Date(q.beforeMs)}`);
    }
    const where = Prisma.join(conds, ' AND ');

    return this.prisma.$queryRaw<CandleRow[]>(Prisma.sql`
      SELECT
        ${tcol}        AS "time",
        "openPrice"    AS "open",
        "highPrice"    AS "high",
        "lowPrice"     AS "low",
        "closePrice"   AS "close",
        "volume"::bigint AS "volume"
      FROM ${rel}
      WHERE ${where}
      ORDER BY ${tcol} DESC
      LIMIT ${q.limit}
    `);
  }

  /**
   * 1d 일봉 — KRX 딥히스토리 stock_daily_prices(StockDailyPrice 백필) newest-first 조회 (DAR-384).
   * tradeDate 는 'YYYYMMDD' 문자열이라 사전식 비교 == 시간 순서다. 구간(from/to/before)은 KST
   * 거래일로 환산해 문자열 비교한다(tradeDateFromMs). 각 행의 대표 instant(time)는 거래일 자정
   * UTC(=09:00 KST 같은 날)로 매핑해 분봉과 동일하게 ISO time 으로 일관 반환한다(커서 라운드트립 보존).
   */
  private async queryDailyRows(q: NormalizedCandleQuery): Promise<CandleRow[]> {
    const conds: Prisma.Sql[] = [Prisma.sql`"stockCode" = ${q.stockCode}`];
    if (q.fromMs != null) {
      conds.push(Prisma.sql`"tradeDate" >= ${tradeDateFromMs(q.fromMs)}`);
    }
    if (q.toMs != null) {
      conds.push(Prisma.sql`"tradeDate" <= ${tradeDateFromMs(q.toMs)}`);
    }
    if (q.beforeMs != null) {
      conds.push(Prisma.sql`"tradeDate" < ${tradeDateFromMs(q.beforeMs)}`);
    }
    const where = Prisma.join(conds, ' AND ');

    const rows = await this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT
        "tradeDate"      AS "tradeDate",
        "openPrice"      AS "open",
        "highPrice"      AS "high",
        "lowPrice"       AS "low",
        "closePrice"     AS "close",
        "volume"::bigint AS "volume"
      FROM "stock_daily_prices"
      WHERE ${where}
      ORDER BY "tradeDate" DESC
      LIMIT ${q.limit}
    `);

    // 대표 instant 매핑 — 형식 불량 거래일은 방어적으로 제외(빈 차트 graceful).
    const out: CandleRow[] = [];
    for (const r of rows) {
      const time = dateFromTradeDate(r.tradeDate);
      if (time == null) continue;
      out.push({
        time,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: r.volume,
      });
    }
    return out;
  }
}
