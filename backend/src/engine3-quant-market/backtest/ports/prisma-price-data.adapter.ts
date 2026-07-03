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
 *  - 거래정지/관리종목 일별 플래그는 StockStatusDaily(DAR-486, forward-only 이력)에서 공급한다.
 *    현재 StockStatus 단일행(현재 상태)을 과거에 소급 적용하는 것은 lookahead 이므로 절대 배제하고,
 *    수집일(tradeDate) 스냅샷으로 기록된 일별 이력만 point-in-time 으로 참조한다. 이력이 없는
 *    과거 거래일은 기존과 동일하게 미설정(false) — 일봉이 존재하면 거래 성립으로 간주(보수적·정직).
 *    forward-only 라 과거 백테스트 거동은 무변경이고, 이력이 쌓일수록 상한가 추격·정지종목 진입을
 *    실제로 걸러 낙관 편향을 줄인다. 상하한가 플래그는 미저장 → 미설정(가격 유래 판정, 이력 대상 아님).
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

    // DAR-486: 일별 종목상태 이력(거래정지/관리종목)을 같은 구간(asOf 절단 동일)에서 공급.
    //   이상상태 행만 저장돼 있어 대부분의 (stockCode, tradeDate) 는 부재 → 미설정(false)로 처리.
    //   이력이 없는 과거 거래일은 빈 맵 → 기존 거동과 완전 동일(forward-only, 회귀 0).
    const statusRows = await this.prisma.stockStatusDaily.findMany({
      where: {
        stockCode,
        tradeDate: { gte: toTradeDate(startDate), lte: toTradeDate(cappedEnd) },
      },
      select: { tradeDate: true, isTradingSuspended: true, isManagement: true },
    });
    const statusByDate = new Map(statusRows.map((s) => [s.tradeDate, s]));

    return rows.map((r) => {
      const status = statusByDate.get(r.tradeDate);
      return {
        date: toIsoDate(r.tradeDate),
        open: r.openPrice,
        high: r.highPrice,
        low: r.lowPrice,
        close: r.closePrice,
        volume: Number(r.volume),
        // 일별 이력이 있으면 point-in-time 플래그 공급, 없으면 미설정(false).
        isTradingSuspended: status?.isTradingSuspended ?? false,
        isAdminStock: status?.isManagement ?? false,
        // 상하한가는 가격 유래 판정 — 이력 미저장 → 미설정(false).
      };
    });
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
