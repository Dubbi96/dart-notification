/**
 * prisma-market-index.adapter.ts — 시장 지수 일별 Prisma 어댑터 (DAR-133)
 *
 * MarketIndex 테이블을 IMarketIndexPort 로 노출한다. KOSPI(0001)·KOSDAQ(1001)
 * 종가 지수로 AR(초과수익)의 시장수익률 기준선을 제공한다.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IMarketIndexPort, IMarketIndexPrice } from '../ports/market-index.port';

@Injectable()
export class PrismaMarketIndexAdapter implements IMarketIndexPort {
  constructor(private readonly prisma: PrismaService) {}

  async getIndexWindow(
    indexCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<IMarketIndexPrice[]> {
    const rows = await this.prisma.marketIndex.findMany({
      where: { indexCode, tradeDate: { gte: fromDate, lte: toDate } },
      orderBy: { tradeDate: 'asc' },
      select: { indexCode: true, tradeDate: true, closeIndex: true },
    });

    return rows.map(r => ({
      indexCode: r.indexCode,
      tradeDate: r.tradeDate,
      closeIndex: r.closeIndex,
    }));
  }
}
