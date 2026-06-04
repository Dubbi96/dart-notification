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
}
