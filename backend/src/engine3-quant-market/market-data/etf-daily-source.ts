/**
 * ETF 일봉 소스 어댑터 (DAR-484 [견고화 W1·P10]) — 포트/어댑터 분리.
 *
 * ETF 일봉을 어디서 받는지(KIS 기간별시세 / KRX etp)를 인터페이스로 추상화한다. 수집기는 이
 * 인터페이스에만 의존하고, 구독 상태에 따라 구현체를 갈아끼운다(현재 KIS, 승인 시 KRX_ETP).
 *
 * **소스 결정(2026-07-03 실검증)**: KRX /etp/etf_bydd_trd 는 HTTP 401 — 현재 API 키가 ETF 상품
 *   미구독(주식 일봉 /sto/stk_bydd_trd 는 200 정상). 따라서 1차 소스 = KIS 기간별시세(일봉).
 *   KIS 는 ETF 단축코드를 주식과 동일 엔드포인트(FID_COND_MRKT_DIV_CODE='J')로 지원하며 P08
 *   하드닝(EGW00201 유량초과 200 본문 검사·지수 백오프)이 완료돼 있어 재시도·백오프를 재사용한다.
 */

/** ETF 일봉 1행(소스 중립). KIS/KRX 어느 소스든 이 형태로 정규화해 반환한다. */
export interface EtfDailyBar {
  tradeDate: string; // 거래일 YYYYMMDD
  open: number; // 시가(원)
  high: number; // 고가(원)
  low: number; // 저가(원)
  close: number; // 종가(원)
  volume: number; // 거래량
  tradingValue: number; // 거래대금(원)
}

/** ETF 일봉 소스 조회 옵션 — [startYmd, endYmd] 구간(YYYYMMDD). */
export interface EtfDailyFetchOptions {
  startYmd: string;
  endYmd: string;
  /** 현재 epoch ms(테스트 주입 가능). */
  nowMs?: number;
}

/**
 * ETF 일봉 소스 어댑터 포트. 구현체(KIS/KRX)는 sourceName 으로 자신을 식별하고,
 * [startYmd, endYmd] 구간의 일봉을 거래일 오름차순으로 반환한다.
 * ★graceful: 키 미설정 등 '비활성'은 throw(수집기가 스킵 판단), 그 외 실패는 [] 로 정직 표면화.
 */
export interface EtfDailyPriceSource {
  /** 소스 식별자 — EtfDailyPrice.source 컬럼에 기록('KIS' | 'KRX_ETP'). */
  readonly sourceName: string;
  /** 소스가 실제 조회 가능한지(키/구독 상태). false 면 수집기가 no-op 스킵. */
  isAvailable(): boolean;
  /** 구간 일봉 조회(거래일 오름차순). */
  fetchDailyBars(etfCode: string, opts: EtfDailyFetchOptions): Promise<EtfDailyBar[]>;
}

/** KRX etp 어댑터 미구현(구독 미승인) 접근 시 던지는 에러 — 사고 배선을 조용히 삼키지 않는다. */
export class EtfEtpSourceNotSubscribedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtfEtpSourceNotSubscribedError';
  }
}

/**
 * KRX etp(ETF 일별매매정보) 어댑터 — **인터페이스만·미구현**(DAR-484).
 *
 * 2026-07-03 실검증: KRX 데이터마켓플레이스 /etp/etf_bydd_trd 는 HTTP 401(현재 키 ETF 상품 미구독).
 * 주식 일봉(/sto/stk_bydd_trd)은 200 정상이므로 키 자체 문제가 아니라 상품 구독 범위 문제다.
 * ETF 상품 구독 승인 시 이 어댑터의 fetchDailyBars 를 KrxApiService.fetchEtfDaily(신설)로 채우고,
 * 수집기의 소스를 KIS→KRX_ETP 로 교체(또는 폴백 체인 구성)하면 된다.
 *
 * 현재는 isAvailable()=false + 호출 시 명시적 throw 로, 실수로 활성화돼 조용히 빈 데이터가 되는 것을
 * 방지한다. 수집기는 KIS 소스를 사용하므로 이 어댑터는 호출되지 않는다.
 */
export class KrxEtpDailySource implements EtfDailyPriceSource {
  readonly sourceName = 'KRX_ETP';

  isAvailable(): boolean {
    return false; // ETF 상품 미구독(401) — 승인 시 true 로 전환하고 fetchDailyBars 구현.
  }

  fetchDailyBars(etfCode: string, opts: EtfDailyFetchOptions): Promise<EtfDailyBar[]> {
    void etfCode;
    void opts;
    return Promise.reject(
      new EtfEtpSourceNotSubscribedError(
        'KRX /etp/etf_bydd_trd 미구독(2026-07-03 실검증 HTTP 401) — 미구현. ' +
          'ETF 상품 구독 승인 후 KrxApiService.fetchEtfDaily 로 채우고 수집기 소스를 전환하라.',
      ),
    );
  }
}
