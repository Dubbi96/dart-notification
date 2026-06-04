import { Injectable } from '@nestjs/common';

export interface TechnicalIndicator {
  stockCode: string;
  baseDate: string;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerMid: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  vwap: number | null;
}

/**
 * 기술지표 계산 서비스 — M4 스켈레톤.
 * MA5/20/60/120, RSI14, MACD(12,26,9), Bollinger(20,2), ATR14, VWAP.
 * TODO(M6): 실제 계산 로직 구현 (BullMQ 컨슈머 트리거).
 */
@Injectable()
export class TechnicalIndicatorService {
  async calculateIndicators(
    stockCode: string,
    baseDate: string,
  ): Promise<TechnicalIndicator> {
    // TODO(M6): 일봉 데이터 조회 후 지표 계산
    return {
      stockCode,
      baseDate,
      ma5: null,
      ma20: null,
      ma60: null,
      ma120: null,
      rsi14: null,
      macdLine: null,
      macdSignal: null,
      macdHistogram: null,
      bollingerUpper: null,
      bollingerMid: null,
      bollingerLower: null,
      atr14: null,
      vwap: null,
    };
  }
}
