import { Logger } from '@nestjs/common';
import { DailyPrice } from './backtest.types';
import { PriceDataPort } from './price-data.port';
import {
  AssetClass,
  DEFAULT_ASSET_CLASS,
  assertSupportedAssetClass,
} from '../../../common/asset/asset-class';
import { PrismaService } from '../../../prisma/prisma.service';

/** YYYY-MM-DD → YYYYMMDD (StockDailyPrice.tradeDate 저장 포맷) */
function toTradeDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** YYYYMMDD → YYYY-MM-DD */
function toIsoDate(tradeDate: string): string {
  return `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;
}

/**
 * DB 백엔드 가격 데이터 어댑터 — StockDailyPrice(일봉 백필 ~8.5M행)를 백테스트 PriceDataPort 로 노출.
 *
 * ★ lookahead bias 방지(불가침):
 *  - 선택적 `asOf` 상한(YYYY-MM-DD)을 받으면, 그 날짜를 초과하는 일봉을 절대 반환하지 않는다.
 *    (백테스트 러너는 일자별로 [day, day] 만 조회하므로 구조적으로 미래 미참조이나,
 *     상한 가드를 명시해 회귀·오용을 차단한다.)
 *  - 현재 StockStatus(거래정지/관리종목)는 stockCode 단일행(현재 상태)이라 과거 시점 상태가
 *    아니므로, 과거 백테스트에 현재 상태를 소급 적용하지 않는다(=lookahead 금지). 일봉이
 *    존재하면 그 날 거래가 성립한 것으로 간주(보수적·정직). 상하한가 플래그도 미저장 → 미설정.
 *
 * AI 금지영역: 순수 데이터 어댑터. AI 개입 0.
 */
export class PrismaBacktestPriceAdapter extends PriceDataPort {
  private readonly logger = new Logger(PrismaBacktestPriceAdapter.name);

  /**
   * @param prisma PrismaService
   * @param asOf   (선택) 조회 허용 상한 YYYY-MM-DD. 초과 조회는 경고 후 상한으로 절단.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly asOf?: string,
  ) {
    super();
  }

  async getDailyPrices(
    stockCode: string,
    startDate: string,
    endDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<DailyPrice[]> {
    assertSupportedAssetClass(assetClass, 'PrismaBacktestPriceAdapter.getDailyPrices');

    // lookahead 가드: asOf 초과 구간은 절단
    let cappedEnd = endDate;
    if (this.asOf && endDate > this.asOf) {
      this.logger.warn(
        `[LOOKAHEAD GUARD] ${stockCode}: endDate=${endDate} > asOf=${this.asOf} → ${this.asOf} 로 절단`,
      );
      cappedEnd = this.asOf;
    }
    if (cappedEnd < startDate) return [];

    const rows = await this.prisma.stockDailyPrice.findMany({
      where: {
        stockCode,
        tradeDate: { gte: toTradeDate(startDate), lte: toTradeDate(cappedEnd) },
      },
      orderBy: { tradeDate: 'asc' },
      select: {
        tradeDate: true,
        openPrice: true,
        highPrice: true,
        lowPrice: true,
        closePrice: true,
        volume: true,
      },
    });

    return rows.map((r) => ({
      date: toIsoDate(r.tradeDate),
      open: r.openPrice,
      high: r.highPrice,
      low: r.lowPrice,
      close: r.closePrice,
      volume: Number(r.volume),
      // 상하한가·거래정지·관리종목 일별 이력 미저장 → 미설정(러너는 false 로 처리).
      // 현재 StockStatus 소급 적용은 lookahead 이므로 의도적으로 배제.
    }));
  }

  async getOpenPrice(
    stockCode: string,
    date: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<number | null> {
    assertSupportedAssetClass(assetClass, 'PrismaBacktestPriceAdapter.getOpenPrice');
    if (this.asOf && date > this.asOf) return null;

    const row = await this.prisma.stockDailyPrice.findUnique({
      where: { stockCode_tradeDate: { stockCode, tradeDate: toTradeDate(date) } },
      select: { openPrice: true },
    });
    return row?.openPrice ?? null;
  }

  async getTradingDays(
    startDate: string,
    endDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<string[]> {
    assertSupportedAssetClass(assetClass, 'PrismaBacktestPriceAdapter.getTradingDays');

    let cappedEnd = endDate;
    if (this.asOf && endDate > this.asOf) cappedEnd = this.asOf;
    if (cappedEnd < startDate) return [];

    // 일봉이 존재하는 날 = 실제 거래일. groupBy 로 distinct tradeDate 만 끌어온다(전건 적재 방지).
    const groups = await this.prisma.stockDailyPrice.groupBy({
      by: ['tradeDate'],
      where: { tradeDate: { gte: toTradeDate(startDate), lte: toTradeDate(cappedEnd) } },
      orderBy: { tradeDate: 'asc' },
    });

    return groups.map((g) => toIsoDate(g.tradeDate));
  }
}
