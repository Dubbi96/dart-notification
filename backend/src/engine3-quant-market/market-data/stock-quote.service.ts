import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeQuoteCache } from './realtime-quote.cache';

/**
 * 종목 최신 시세(quote) 조회 — 화면 가격 배지 종단연결 (DAR-158, read-only).
 *
 * 적재 데이터(StockDailyPrice 일봉 + KIS 실시간 캐시)를 '읽는' GET 경로가 없어 워치리스트·신호·
 * 종목 카드에 현재가/등락률이 표시되지 않던 문제를 해소한다. 다건 종목코드를 in 쿼리 한 번으로
 * 조회(N+1 회피)하고, 종목별 최종가·전일대비%·최근 5일 종가 스파크라인을 반환한다.
 *
 * 가격 우선순위(DAR-140 정직 계약 준수):
 *   1) KIS 실시간 캐시가 신선하면 그 현재가(source=REALTIME)
 *   2) 없으면 StockDailyPrice 최신 종가(source=DAILY)
 * 데이터가 전혀 없는 종목은 null 로 흡수(소비측 배지 미표시).
 *
 * AI 금지영역: 순수 조회·산술(등락률)뿐. 점수·체결·하드룰과 무관.
 */

/** 스파크라인에 노출할 최근 종가 개수. */
export const QUOTE_SPARKLINE_DAYS = 5;
/** 종목별로 조회할 최근 일봉 행 수(스파크라인 5 + 전일대비 계산 여유). */
const DAILY_ROWS_PER_STOCK = QUOTE_SPARKLINE_DAYS + 1;
/** 한 번에 조회 가능한 최대 종목 수(남용 방지). */
export const MAX_QUOTE_STOCK_CODES = 50;

export interface StockQuote {
  stockCode: string;
  /** DART 고유번호(실시간 캐시 키 루트) — 일봉이 있으면 채워진다. */
  corpCode: string | null;
  /** 최종가(원) — 실시간 우선, 폴백 최신 일봉 종가. */
  price: number;
  /** 직전 기준 종가(원) — 실시간이면 최신 일봉 종가, 일봉이면 그 전일 종가. 없으면 null. */
  previousClose: number | null;
  /** 전일대비 절대 등락(원). previousClose 없으면 null. */
  change: number | null;
  /** 전일대비 등락률(%) 소수 2자리. previousClose 없으면 null. */
  changePercent: number | null;
  /** 가격 기준 일봉일(YYYYMMDD). */
  tradeDate: string | null;
  /** 가격 출처 — 'REALTIME'(KIS 신선) | 'DAILY'(일봉 종가). */
  source: 'REALTIME' | 'DAILY';
  /** 최근 종가 스파크라인(오래된→최신, 최대 5개). */
  sparkline: number[];
}

/** 일봉 행(오름차순)을 정직한 시세로 합성하는 순수 함수. 행이 없으면 null. */
export function buildQuote(
  stockCode: string,
  dailyRowsAsc: Array<{ corpCode: string; tradeDate: string; closePrice: number }>,
  realtimePrice: number | null,
): StockQuote | null {
  if (dailyRowsAsc.length === 0) {
    // 일봉이 없으면 실시간만으로는 corpCode/기준일을 신뢰할 수 없어 미표시 처리.
    return null;
  }

  const latest = dailyRowsAsc[dailyRowsAsc.length - 1];
  const prevDaily =
    dailyRowsAsc.length >= 2 ? dailyRowsAsc[dailyRowsAsc.length - 2] : null;

  const useRealtime = realtimePrice !== null && realtimePrice > 0;
  const price = useRealtime ? realtimePrice! : latest.closePrice;
  // 실시간이면 직전 기준 = 최신 일봉 종가(직전 세션), 일봉이면 그 전일 종가.
  const previousClose = useRealtime
    ? latest.closePrice
    : prevDaily?.closePrice ?? null;

  const change = previousClose !== null ? price - previousClose : null;
  const changePercent =
    previousClose !== null && previousClose !== 0
      ? Math.round(((price - previousClose) / previousClose) * 10000) / 100
      : null;

  const sparkline = dailyRowsAsc
    .slice(-QUOTE_SPARKLINE_DAYS)
    .map((r) => r.closePrice);

  return {
    stockCode,
    corpCode: latest.corpCode,
    price,
    previousClose,
    change,
    changePercent,
    tradeDate: latest.tradeDate,
    source: useRealtime ? 'REALTIME' : 'DAILY',
    sparkline,
  };
}

@Injectable()
export class StockQuoteService {
  private readonly logger = new Logger(StockQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional: 전역 RealtimeQuoteCache 미배선(테스트 등) 시 일봉 폴백으로 graceful 동작.
    @Optional() private readonly realtimeCache?: RealtimeQuoteCache,
  ) {}

  /** 입력 종목코드 정규화 — 6자리 숫자만, 중복 제거, 최대 개수 제한. */
  private sanitize(raw: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const code of raw) {
      const trimmed = (code ?? '').trim();
      if (!/^\d{6}$/.test(trimmed)) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_QUOTE_STOCK_CODES) break;
    }
    return out;
  }

  /**
   * 다건 종목 최신 시세 조회. stockCode → StockQuote|null 맵 반환.
   * @param nowMs 실시간 신선도 판정용 현재 epoch ms(테스트 주입 가능).
   */
  async getQuotes(
    rawStockCodes: string[],
    nowMs: number = Date.now(),
  ): Promise<Record<string, StockQuote | null>> {
    const stockCodes = this.sanitize(rawStockCodes);
    const result: Record<string, StockQuote | null> = {};
    for (const code of stockCodes) result[code] = null;
    if (stockCodes.length === 0) return result;

    // N+1 회피: 종목 전체를 한 번의 in 쿼리로. 모든 종목이 동일 거래 캘린더를 공유하므로
    // tradeDate desc 정렬 후 종목수 × (스파크라인+1) 행을 가져오면 종목별 최근 행이 고르게 포함된다.
    const rows = await this.prisma.stockDailyPrice.findMany({
      where: { stockCode: { in: stockCodes } },
      orderBy: { tradeDate: 'desc' },
      take: stockCodes.length * DAILY_ROWS_PER_STOCK,
      select: { stockCode: true, corpCode: true, tradeDate: true, closePrice: true },
    });

    // 종목별 그룹화(현재 desc 순서 유지 → 종목당 최신 DAILY_ROWS_PER_STOCK 만 보존).
    const byStock = new Map<
      string,
      Array<{ corpCode: string; tradeDate: string; closePrice: number }>
    >();
    for (const r of rows) {
      const list = byStock.get(r.stockCode) ?? [];
      if (list.length < DAILY_ROWS_PER_STOCK) {
        list.push({
          corpCode: r.corpCode,
          tradeDate: r.tradeDate,
          closePrice: r.closePrice,
        });
        byStock.set(r.stockCode, list);
      }
    }

    for (const code of stockCodes) {
      const desc = byStock.get(code) ?? [];
      const asc = [...desc].reverse(); // 오래된→최신
      const corpCode = asc.length > 0 ? asc[asc.length - 1].corpCode : null;
      const realtime =
        corpCode && this.realtimeCache
          ? this.realtimeCache.getFresh(corpCode, nowMs)
          : null;
      result[code] = buildQuote(code, asc, realtime ? realtime.price : null);
    }

    return result;
  }
}
