import { Injectable } from '@nestjs/common';

export interface StockDailyPrice {
  stockCode: string;
  baseDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  marketCap?: number;
}

/**
 * 시세 수집 서비스 — M4 스켈레톤.
 * 1차 소스: KRX 데이터마켓플레이스 (Phase 5 M5에서 실제 구현).
 * 현재는 포트 인터페이스만 노출하고 빈 구현으로 대체한다.
 */
@Injectable()
export class MarketDataService {
  async fetchDailyPrice(
    stockCode: string,
    from: string,
    to: string,
  ): Promise<StockDailyPrice[]> {
    // TODO(M5): KRX 데이터마켓플레이스 어댑터 구현
    void stockCode;
    void from;
    void to;
    return [];
  }

  async fetchCurrentPrice(stockCode: string): Promise<number> {
    // TODO(M5): KRX or KIS OpenAPI 실시간 현재가
    void stockCode;
    return 0;
  }
}
