/**
 * market-calendar.port.ts — 자산군 무관 거래캘린더 포트 (DAR-77, §6-2)
 *
 * 헥사고날 확장: 엔진은 이 인터페이스에만 의존하고, 자산군별 어댑터를 주입한다.
 * 현행은 KR 어댑터만 존재(거래일 목록 기반). US/CRYPTO 캘린더는 후속 항목에서 추가.
 */
import { AssetClass } from './asset-class';

export interface IMarketCalendarPort {
  /** 해당 자산군 기준 date(YYYY-MM-DD)가 거래일인지 여부. */
  isTradingDay(assetClass: AssetClass, date: string): boolean;

  /** 해당 자산군 기준 date 다음 거래일(YYYY-MM-DD). 없으면 null. */
  getNextTradingDay(assetClass: AssetClass, date: string): string | null;
}

/** DI 토큰 (후속 모듈 배선용). */
export const MARKET_CALENDAR_PORT = 'MARKET_CALENDAR_PORT';
