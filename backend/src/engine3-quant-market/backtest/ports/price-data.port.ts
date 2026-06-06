import { DailyPrice } from './backtest.types';
import { AssetClass } from '../../../common/asset/asset-class';

/**
 * 백테스트 가격 데이터 포트
 * 실제 구현은 DB 어댑터로 교체한다.
 * lookahead bias 방지: asOfDate 이전 데이터만 반환해야 함.
 *
 * DAR-77: 다자산 추상화를 위해 assetClass 를 가산형(선택, 기본 KR_STOCK)으로 확장.
 * 자산군을 넘기지 않는 현행 KR 호출은 그대로 동작한다.
 */
export abstract class PriceDataPort {
  /** stockCode의 startDate~endDate 일봉 조회 (asOfDate 이후 데이터 포함 금지) */
  abstract getDailyPrices(
    stockCode: string,
    startDate: string,
    endDate: string,
    assetClass?: AssetClass,
  ): Promise<DailyPrice[]>;

  /** 특정 날짜의 시가 조회 */
  abstract getOpenPrice(
    stockCode: string,
    date: string,
    assetClass?: AssetClass,
  ): Promise<number | null>;

  /** 거래일 목록 조회 (휴장일 제외) */
  abstract getTradingDays(
    startDate: string,
    endDate: string,
    assetClass?: AssetClass,
  ): Promise<string[]>;
}
