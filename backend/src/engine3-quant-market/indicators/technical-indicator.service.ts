import { Injectable } from '@nestjs/common';
import { calcAllIndicators, Candle } from './indicators';
import { AllIndicators } from './indicators';

export interface TechnicalIndicator extends AllIndicators {
  stockCode: string;
  baseDate: string;
}

/**
 * 기술지표 계산 서비스.
 * 외부 수집 없이 캔들 데이터를 받아 순수 함수로 지표를 계산한다.
 * 데이터 부족 구간은 null 반환 (에러 없음).
 */
@Injectable()
export class TechnicalIndicatorService {
  calculateIndicators(
    stockCode: string,
    baseDate: string,
    candles: Candle[],
    disclosureIdx: number | null = null,
  ): TechnicalIndicator {
    const indicators = calcAllIndicators(candles, disclosureIdx);
    return {
      stockCode,
      baseDate,
      ...indicators,
    };
  }
}
