import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface StockDailyPrice {
  stockCode: string;
  tradeDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  tradingValue?: number;
}

/**
 * 시장지수 최신값(전일대비 등락 포함) — GET /market-data/indices/latest 응답 단위 (DAR-160).
 * 데이터가 1건뿐이면 전일 기준이 없어 prevCloseIndex·change·changePercent 는 null.
 */
export interface MarketIndexQuote {
  indexCode: string; // 0001=KOSPI, 1001=KOSDAQ
  indexName: string;
  market: 'KOSPI' | 'KOSDAQ';
  tradeDate: string; // 최신 거래일 YYYYMMDD
  closeIndex: number; // 최신 종가지수
  prevCloseIndex: number | null; // 전일 종가지수 (없으면 null)
  change: number | null; // 전일대비 등락폭 (포인트)
  changePercent: number | null; // 전일대비 등락률 (%)
}

/**
 * 시세 조회 서비스 — Prisma DB에서 읽기 전용 조회 제공.
 * 수집은 KrxMarketDataScheduler가 담당 (EOD 배치).
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 일봉 조회 (DB 읽기).
   * @param stockCode 종목코드 6자리
   * @param from 시작일 YYYYMMDD
   * @param to 종료일 YYYYMMDD
   */
  async fetchDailyPrice(stockCode: string, from: string, to: string): Promise<StockDailyPrice[]> {
    const rows = await this.prisma.stockDailyPrice.findMany({
      where: {
        stockCode,
        tradeDate: { gte: from, lte: to },
      },
      orderBy: { tradeDate: 'asc' },
    });

    return rows.map((r) => ({
      stockCode: r.stockCode,
      tradeDate: r.tradeDate,
      openPrice: r.openPrice,
      highPrice: r.highPrice,
      lowPrice: r.lowPrice,
      closePrice: r.closePrice,
      volume: Number(r.volume),
      tradingValue: r.tradingValue ? Number(r.tradingValue) : undefined,
    }));
  }

  /**
   * 현재가 조회 — 최신 일봉 종가 반환.
   * 실시간 현재가는 Phase 6 KIS OpenAPI 보완 시 추가.
   */
  async fetchCurrentPrice(stockCode: string): Promise<number> {
    const latest = await this.prisma.stockDailyPrice.findFirst({
      where: { stockCode },
      orderBy: { tradeDate: 'desc' },
      select: { closePrice: true },
    });
    return latest?.closePrice ?? 0;
  }

  /** 시장지수 일봉 조회 */
  async fetchMarketIndex(
    indexCode: string,
    from: string,
    to: string,
  ): Promise<Array<{ indexCode: string; tradeDate: string; closeIndex: number }>> {
    const rows = await this.prisma.marketIndex.findMany({
      where: {
        indexCode,
        tradeDate: { gte: from, lte: to },
      },
      orderBy: { tradeDate: 'asc' },
    });

    return rows.map((r) => ({
      indexCode: r.indexCode,
      tradeDate: r.tradeDate,
      closeIndex: r.closeIndex,
    }));
  }

  /** 종목 상태 조회 (거래정지·관리종목·투자주의 등) */
  async getStockStatus(stockCode: string) {
    return this.prisma.stockStatus.findUnique({ where: { stockCode } });
  }

  // KOSPI·KOSDAQ 지수코드 매핑 (krx-api.service 의 fetchIndexDaily 와 동일).
  private static readonly MARKET_INDEX_CODES: ReadonlyArray<{
    code: string;
    market: 'KOSPI' | 'KOSDAQ';
  }> = [
    { code: '0001', market: 'KOSPI' },
    { code: '1001', market: 'KOSDAQ' },
  ];

  /**
   * 시장지수 최신값 조회 (DAR-160) — KOSPI·KOSDAQ 각각 최신 종가 + 전일대비 등락률.
   * 지수별로 최근 2거래일(desc)을 읽어 최신/전일을 산출한다. 데이터가 없는 지수는 결과에서
   * 생략하고, 1건뿐이면 등락 필드를 null 로 둔다(홈 배지가 깨지지 않도록 graceful).
   */
  async fetchLatestIndices(): Promise<MarketIndexQuote[]> {
    const results: MarketIndexQuote[] = [];

    for (const { code, market } of MarketDataService.MARKET_INDEX_CODES) {
      const rows = await this.prisma.marketIndex.findMany({
        where: { indexCode: code },
        orderBy: { tradeDate: 'desc' },
        take: 2,
        select: { indexCode: true, indexName: true, tradeDate: true, closeIndex: true },
      });

      if (rows.length === 0) continue; // 미적재 지수는 생략 (배지 측에서 부분 표시).

      const latest = rows[0];
      const prevClose = rows.length > 1 ? rows[1].closeIndex : null;

      const change =
        prevClose !== null ? round2(latest.closeIndex - prevClose) : null;
      const changePercent =
        prevClose !== null && prevClose !== 0
          ? round2(((latest.closeIndex - prevClose) / prevClose) * 100)
          : null;

      results.push({
        indexCode: latest.indexCode,
        indexName: latest.indexName,
        market,
        tradeDate: latest.tradeDate,
        closeIndex: latest.closeIndex,
        prevCloseIndex: prevClose,
        change,
        changePercent,
      });
    }

    return results;
  }
}

/** 소수 2자리 반올림 (등락폭·등락률 표시용). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
