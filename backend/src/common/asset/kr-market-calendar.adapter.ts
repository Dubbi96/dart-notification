/**
 * kr-market-calendar.adapter.ts — KR 거래캘린더 어댑터 (DAR-77)
 *
 * 현행 거래일 목록(정렬된 YYYY-MM-DD 배열) 기반으로 IMarketCalendarPort 를 구현.
 * KR_STOCK 만 지원하며, 비-KR 자산군 호출은 AssetClassNotImplementedError 로 스텁 경계를 표시한다.
 * US/CRYPTO 캘린더 어댑터(거래소 휴장일·24/7 등)는 후속 항목에서 별도 구현.
 */
import {
  AssetClass,
  assertSupportedAssetClass,
} from './asset-class';
import { IMarketCalendarPort } from './market-calendar.port';

export class KrMarketCalendarAdapter implements IMarketCalendarPort {
  private readonly tradingDays: string[];
  private readonly tradingDaySet: ReadonlySet<string>;

  /** @param tradingDays 거래일 목록(YYYY-MM-DD). 내부에서 정렬·중복제거. */
  constructor(tradingDays: string[]) {
    this.tradingDays = Array.from(new Set(tradingDays)).sort();
    this.tradingDaySet = new Set(this.tradingDays);
  }

  isTradingDay(assetClass: AssetClass, date: string): boolean {
    assertSupportedAssetClass(assetClass, 'KrMarketCalendarAdapter.isTradingDay');
    return this.tradingDaySet.has(date);
  }

  getNextTradingDay(assetClass: AssetClass, date: string): string | null {
    assertSupportedAssetClass(
      assetClass,
      'KrMarketCalendarAdapter.getNextTradingDay',
    );
    return this.tradingDays.find((d) => d > date) ?? null;
  }
}
