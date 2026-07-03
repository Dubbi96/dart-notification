import { Injectable } from '@nestjs/common';
import { KisApiService } from './kis-api.service';
import {
  EtfDailyBar,
  EtfDailyFetchOptions,
  EtfDailyPriceSource,
} from './etf-daily-source';

/**
 * KisEtfDailySource (DAR-484 [견고화 W1·P10]) — ETF 일봉 1차 소스(KIS 기간별시세).
 *
 * KisApiService.fetchDailyPrices(기간별시세 inquire-daily-itemchartprice)를 감싸 ETF 단축코드로
 * 구간 일봉을 받는다. KIS 는 주식·ETF·ETN 을 동일 엔드포인트(FID_COND_MRKT_DIV_CODE='J')로
 * 지원하므로 별도 경로가 아니라 기존 일봉 조회를 그대로 재사용한다(재시도·백오프 P08 하드닝 계승).
 *
 * ★graceful: KIS 키 미설정 시 isAvailable()=false → 수집기가 no-op. 조회 실패는 KisApiService 가
 *   [] 로 정직 반환(유량초과 소진 로깅 포함). 순수 읽기 전용 시세 — AI·체결·하드룰 무관.
 */
@Injectable()
export class KisEtfDailySource implements EtfDailyPriceSource {
  readonly sourceName = 'KIS';

  constructor(private readonly kis: KisApiService) {}

  isAvailable(): boolean {
    return this.kis.isConfigured;
  }

  async fetchDailyBars(
    etfCode: string,
    opts: EtfDailyFetchOptions,
  ): Promise<EtfDailyBar[]> {
    const bars = await this.kis.fetchDailyPrices(
      etfCode,
      opts.startYmd,
      opts.endYmd,
      opts.nowMs,
    );
    // KisDailyBar 와 EtfDailyBar 는 동일 형태 — 소스 중립 타입으로 그대로 통과.
    return bars.map((b) => ({
      tradeDate: b.tradeDate,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      tradingValue: b.tradingValue,
    }));
  }
}
