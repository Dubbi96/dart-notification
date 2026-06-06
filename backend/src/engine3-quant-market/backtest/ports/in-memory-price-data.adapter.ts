import { DailyPrice } from './backtest.types';
import { PriceDataPort } from './price-data.port';
import {
  AssetClass,
  DEFAULT_ASSET_CLASS,
  assertSupportedAssetClass,
} from '../../../common/asset/asset-class';

/**
 * 테스트용 인메모리 가격 데이터 어댑터
 *
 * lookahead bias 감사 설계:
 * - 각 stockCode별 가격 시퀀스를 사전 로드
 * - getDailyPrices 호출 시 asOfDate 미래 데이터가 포함되면 에러 발생 (누수 감지)
 */
export class InMemoryPriceDataAdapter extends PriceDataPort {
  private readonly priceMap = new Map<string, DailyPrice[]>();
  private readonly tradingDayList: string[];

  /** lookahead bias 감사 모드: true이면 미래 데이터 접근 시 예외 */
  private lookaheadAuditEnabled = false;
  private currentSimulationDate: string | null = null;

  constructor(
    pricesPerStock: Record<string, DailyPrice[]>,
    tradingDays: string[],
  ) {
    super();
    for (const [code, prices] of Object.entries(pricesPerStock)) {
      this.priceMap.set(code, prices.sort((a, b) => a.date.localeCompare(b.date)));
    }
    this.tradingDayList = tradingDays.sort();
  }

  /** lookahead bias 감사 모드 활성화 */
  enableLookaheadAudit(currentDate: string): void {
    this.lookaheadAuditEnabled = true;
    this.currentSimulationDate = currentDate;
  }

  disableLookaheadAudit(): void {
    this.lookaheadAuditEnabled = false;
    this.currentSimulationDate = null;
  }

  async getDailyPrices(
    stockCode: string,
    startDate: string,
    endDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<DailyPrice[]> {
    assertSupportedAssetClass(assetClass, 'InMemoryPriceDataAdapter.getDailyPrices');
    if (this.lookaheadAuditEnabled && this.currentSimulationDate) {
      if (endDate > this.currentSimulationDate) {
        throw new Error(
          `[LOOKAHEAD BIAS DETECTED] ${stockCode}: endDate=${endDate} > currentDate=${this.currentSimulationDate}`,
        );
      }
    }

    const prices = this.priceMap.get(stockCode) ?? [];
    return prices.filter((p) => p.date >= startDate && p.date <= endDate);
  }

  async getOpenPrice(
    stockCode: string,
    date: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<number | null> {
    assertSupportedAssetClass(assetClass, 'InMemoryPriceDataAdapter.getOpenPrice');
    const prices = this.priceMap.get(stockCode) ?? [];
    const p = prices.find((p) => p.date === date);
    return p?.open ?? null;
  }

  async getTradingDays(
    startDate: string,
    endDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<string[]> {
    assertSupportedAssetClass(assetClass, 'InMemoryPriceDataAdapter.getTradingDays');
    return this.tradingDayList.filter((d) => d >= startDate && d <= endDate);
  }
}
