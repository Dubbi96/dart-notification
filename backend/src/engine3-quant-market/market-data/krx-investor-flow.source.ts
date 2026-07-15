/**
 * KRX 수급·공매도 어댑터 — **인터페이스만·미가용** (갭분석 W16).
 *
 * 2026-07-16 실검증(scripts/live-investor-flow-smoke.ts): KRX 정보데이터시스템 오픈API
 * (data-dbg.krx.co.kr/svc/apis)에 투자자별 거래실적·공매도 상품이 존재하지 않는다 —
 * 후보 슬러그(sto/stk_invstr_trd·sto/stk_bydd_invstr_trd·srt/stk_srtsell_bal_bydd) 전부
 * HTTP 404(상품/슬러그 부재), 대조군 sto/stk_bydd_trd 는 200(키·일봉 구독 정상).
 * ETF 401(미구독) 선례와 달리 404 이므로 구독 신청으로도 열리지 않는 카탈로그 밖 상품이다.
 *
 * KRX 가 오픈API 에 해당 상품을 추가(또는 별도 공매도 통계 API 제공)하면 이 어댑터의
 * fetch* 를 채우고 수집기의 소스 체인(KRX 1차 → KIS 폴백)이 자동으로 KRX 를 쓴다.
 * 현재는 isAvailable()=false + 호출 시 명시 throw 로, 실수 활성화가 조용히 빈 데이터가
 * 되는 것을 방지한다(KrxEtpDailySource 패턴 — DAR-484).
 */

import {
  InvestorFlowBar,
  InvestorFlowFetchOptions,
  InvestorFlowSource,
  ShortSellingBar,
} from './investor-flow-source';

/** KRX 수급 상품 미가용 접근 시 던지는 에러 — 사고 배선을 조용히 삼키지 않는다. */
export class KrxInvestorFlowNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KrxInvestorFlowNotAvailableError';
  }
}

export class KrxInvestorFlowSource implements InvestorFlowSource {
  readonly sourceName = 'KRX';

  isAvailable(): boolean {
    return false; // 오픈API 상품 부재(2026-07-16 실검증 HTTP 404) — 상품 추가 시 구현 후 전환.
  }

  fetchInvestorFlow(
    stockCode: string,
    opts: InvestorFlowFetchOptions,
  ): Promise<InvestorFlowBar[]> {
    void stockCode;
    void opts;
    return Promise.reject(
      new KrxInvestorFlowNotAvailableError(
        'KRX 오픈API 투자자별 거래실적 상품 부재(2026-07-16 실검증 404) — 미구현. ' +
          '상품 제공 시 KrxApiService 에 fetch 를 추가하고 이 어댑터를 채워라.',
      ),
    );
  }

  fetchShortSelling(
    stockCode: string,
    opts: InvestorFlowFetchOptions,
  ): Promise<ShortSellingBar[]> {
    void stockCode;
    void opts;
    return Promise.reject(
      new KrxInvestorFlowNotAvailableError(
        'KRX 오픈API 공매도 상품 부재(2026-07-16 실검증 404) — 미구현. ' +
          '상품 제공 시 KrxApiService 에 fetch 를 추가하고 이 어댑터를 채워라.',
      ),
    );
  }
}
