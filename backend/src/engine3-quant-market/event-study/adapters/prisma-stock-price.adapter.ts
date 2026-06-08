/**
 * prisma-stock-price.adapter.ts — 종목 일별 가격 Prisma 어댑터 (DAR-133)
 *
 * StockDailyPrice 테이블을 IStockPricePort 로 노출한다. Event Study 산출이
 * 실 DB 가격으로 AR 을 계산할 수 있게 하는 production 어댑터.
 * (테스트는 in-memory-stock-price.adapter 를 그대로 재사용)
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IStockPricePort, IStockDailyPrice } from '../ports/stock-price.port';
import {
  AssetClass,
  DEFAULT_ASSET_CLASS,
  assertSupportedAssetClass,
} from '../../../common/asset/asset-class';

@Injectable()
export class PrismaStockPriceAdapter implements IStockPricePort {
  constructor(private readonly prisma: PrismaService) {}

  async getPriceWindow(
    stockCode: string,
    fromDate: string,
    toDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<IStockDailyPrice[]> {
    // KR 어댑터: 비-KR 자산군은 스텁 경계(미구현)로 명시 (DAR-77 추상화 일관).
    assertSupportedAssetClass(assetClass, 'PrismaStockPriceAdapter');

    const rows = await this.prisma.stockDailyPrice.findMany({
      where: { stockCode, tradeDate: { gte: fromDate, lte: toDate } },
      orderBy: { tradeDate: 'asc' },
      select: { stockCode: true, tradeDate: true, closePrice: true, volume: true },
    });

    return rows.map(r => ({
      stockCode: r.stockCode,
      tradeDate: r.tradeDate,
      closePrice: r.closePrice,
      volume: Number(r.volume), // BigInt → number (AR 거래량 비율 계산용)
    }));
  }
}
