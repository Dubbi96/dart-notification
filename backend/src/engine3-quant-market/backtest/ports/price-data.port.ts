import { DailyPrice } from './backtest.types';

/**
 * 백테스트 가격 데이터 포트
 * 실제 구현은 DB 어댑터로 교체한다.
 * lookahead bias 방지: asOfDate 이전 데이터만 반환해야 함.
 */
export abstract class PriceDataPort {
  /** stockCode의 startDate~endDate 일봉 조회 (asOfDate 이후 데이터 포함 금지) */
  abstract getDailyPrices(
    stockCode: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyPrice[]>;

  /** 특정 날짜의 시가 조회 */
  abstract getOpenPrice(stockCode: string, date: string): Promise<number | null>;

  /** 거래일 목록 조회 (휴장일 제외) */
  abstract getTradingDays(startDate: string, endDate: string): Promise<string[]>;
}
