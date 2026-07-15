/**
 * KIS 수급·공매도 어댑터 (갭분석 W16) — 1차 소스.
 *
 * 2026-07-16 실검증(scripts/live-investor-flow-smoke.ts):
 *   - inquire-investor(FHKST01010900): 종목당 최근 ~30영업일 투자자별 순매수(주·백만원) 200 OK.
 *   - daily-short-sale(FHPST04830000): 구간 일별 공매도 체결수량·거래대금(원) 200 OK.
 * 단위 환산·placeholder 필터는 KisApiService 가 책임진다(이 어댑터는 소스 중립형으로 매핑만).
 *
 * ★공매도 잔고(shortBalanceQty/Ratio)는 KIS 미제공 — null 반환(합성 금지·정직).
 * ★기존 P08 하드닝(EGW00201 유량초과 200 본문 검사·지수 백오프·토큰 캐시)을 그대로 계승한다.
 */

import { Injectable } from '@nestjs/common';
import { KisApiService } from './kis-api.service';
import {
  InvestorFlowBar,
  InvestorFlowFetchOptions,
  InvestorFlowSource,
  ShortSellingBar,
} from './investor-flow-source';

@Injectable()
export class KisInvestorFlowSource implements InvestorFlowSource {
  readonly sourceName = 'KIS';

  constructor(private readonly kis: KisApiService) {}

  isAvailable(): boolean {
    return this.kis.isConfigured;
  }

  /**
   * 투자자별 매매동향 — KIS 는 구간 파라미터가 없어 최근 ~30영업일을 받으므로
   * [startYmd, endYmd] 구간으로 잘라 반환한다(수집기 계약 준수).
   */
  async fetchInvestorFlow(
    stockCode: string,
    opts: InvestorFlowFetchOptions,
  ): Promise<InvestorFlowBar[]> {
    const rows = await this.kis.fetchInvestorDaily(stockCode, opts.nowMs);
    return rows.filter((r) => r.tradeDate >= opts.startYmd && r.tradeDate <= opts.endYmd);
  }

  async fetchShortSelling(
    stockCode: string,
    opts: InvestorFlowFetchOptions,
  ): Promise<ShortSellingBar[]> {
    const rows = await this.kis.fetchShortSaleDaily(
      stockCode,
      opts.startYmd,
      opts.endYmd,
      opts.nowMs,
    );
    return rows.map((r) => ({
      tradeDate: r.tradeDate,
      shortSellingVolume: r.shortSellingVolume,
      shortSellingAmount: r.shortSellingAmount > 0 ? r.shortSellingAmount : null,
      shortBalanceQty: null, // KIS 미제공(잔고는 KRX T+2 공표 별도 상품) — 합성 금지
      shortBalanceRatio: null,
    }));
  }
}
