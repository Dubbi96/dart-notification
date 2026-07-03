import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';

/**
 * KIS 유량초과(초당 거래건수 초과) 응답코드. KIS 는 초당 호출 제한 초과를 HTTP 429 가 아니라
 * **HTTP 200 본문 msg_cd=EGW00201** 로 반환하는 경우가 많다(DAR-480). 상태코드만 보는 재시도
 * 조건으로는 잡히지 않아 유량초과 시 재시도 없이 데이터가 조용히 소실됐다.
 */
const KIS_RATE_LIMIT_MSG_CD = 'EGW00201';

/**
 * KIS 응답(본문)이 유량초과(EGW00201)인지 판정. 본문(any)에서 msg_cd 를 안전 추출한다.
 * HTTP 200/4xx/5xx 어느 상태로 오든 본문 코드로 유량초과를 식별한다.
 */
export function isKisRateLimitedBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const msgCd = (data as { msg_cd?: unknown }).msg_cd;
  return typeof msgCd === 'string' && msgCd.trim().toUpperCase() === KIS_RATE_LIMIT_MSG_CD;
}

/**
 * axios-retry `validateResponse` — 성공으로 처리 가능한 응답인지 판정(axios-retry v4).
 * 이 옵션을 켜면 모든 HTTP 응답(200 포함)이 에러 인터셉터를 먼저 거치므로, HTTP 200 본문으로
 * 오는 유량초과(EGW00201)를 실패로 되돌려 retryCondition 으로 넘길 수 있다.
 *  - 2xx 이면서 유량초과 본문이 아니면 성공(true).
 *  - 2xx 밖이거나 유량초과 본문이면 실패(false) → retryCondition 판정 대상.
 */
export function validateKisResponse(response: AxiosResponse): boolean {
  const status = response.status;
  if (status < 200 || status >= 300) return false;
  if (isKisRateLimitedBody(response.data)) return false;
  return true;
}

/**
 * 재시도 대상 판정. 네트워크 오류·HTTP 429/503, 그리고 **유량초과(EGW00201)** 를 포함한다.
 * 유량초과가 HTTP 200 본문으로 오는 경우는 validateResponse 가 실패로 변환해 여기로 넘어온다.
 */
export function shouldRetryKisError(error: AxiosError): boolean {
  if (axiosRetry.isNetworkError(error)) return true;
  const status = error.response?.status;
  if (status === 429 || status === 503) return true;
  if (isKisRateLimitedBody(error.response?.data)) return true;
  return false;
}

/**
 * KIS(한국투자증권) OpenAPI 어댑터 — 실시간 현재가·분봉 (DAR-140).
 *
 * env: KIS_APP_KEY · KIS_APP_SECRET (필수) · KIS_BASE_URL(기본 실서버) · KIS_ACCOUNT_NO(선택).
 * 키 미설정 시 호출 시점에 KisApiUnavailableError — 앱 부팅은 허용, 실제 호출만 차단(KRX 어댑터 패턴).
 *
 * ★정직(불가침): 여기서 받은 현재가/분봉은 '실제 시장 실시간가'다. 환경 시계(2026)와 실제 현재가의
 *   시점이 다를 수 있음을 소비측(라벨 REALTIME·ts)에서 고지한다. 합성(SYNTHETIC)과 혼동 금지.
 *
 * AI 금지영역: 시세 수집은 순수 HTTP. 체결·주문수량·하드룰과 무관(읽기 전용 시세).
 */
export class KisApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KisApiUnavailableError';
  }
}

/** 실시간 현재가(체결가) 1행. price 는 원 단위 정수. */
export interface KisCurrentPrice {
  stockCode: string;
  price: number; // 현재가(체결가) stck_prpr
  open: number; // 시가 stck_oprc
  high: number; // 고가 stck_hgpr
  low: number; // 저가 stck_lwpr
  volume: number; // 누적 거래량 acml_vol
}

/**
 * 업종(시장)지수 현재값 1행 (DAR-371). 지수는 소수 2자리이므로 정수 반올림하지 않는다.
 * 0001=KOSPI 종합, 1001=KOSDAQ 종합.
 */
export interface KisIndexPrice {
  indexCode: string; // '0001' KOSPI | '1001' KOSDAQ
  price: number; // 현재 지수(bstp_nmix_prpr)
  prevClose: number; // 전일 종가지수(현재값 − 전일대비). 등락률 산출 기준.
  change: number; // 전일대비 등락폭(부호 적용)
  changePercent: number; // 전일대비 등락률(%) 소수 2자리
  open: number; // 시가지수(bstp_nmix_oprc)
  high: number; // 고가지수(bstp_nmix_hgpr)
  low: number; // 저가지수(bstp_nmix_lwpr)
}

/** 분봉 1캔들. */
export interface KisMinuteCandle {
  time: string; // 체결시각 HHMMSS (stck_cntg_hour)
  open: number;
  high: number;
  low: number;
  close: number; // 해당 분 종가(체결가) stck_prpr
  volume: number; // 분 거래량 cntg_vol
}

/**
 * 일봉 1행 (기간별시세, DAR-484). 주식·ETF 공용 — 종목/ETF 단축코드로 동일 엔드포인트 조회.
 * price 는 원 단위 정수, tradingValue 는 거래대금(원).
 */
export interface KisDailyBar {
  tradeDate: string; // 거래일 YYYYMMDD (stck_bsop_date)
  open: number; // 시가 stck_oprc
  high: number; // 고가 stck_hgpr
  low: number; // 저가 stck_lwpr
  close: number; // 종가 stck_clpr
  volume: number; // 누적 거래량 acml_vol
  tradingValue: number; // 누적 거래대금(원) acml_tr_pbmn
}

interface CachedToken {
  token: string;
  /** epoch ms 만료시각(주입된 now 기준 안전 마진 적용). */
  expiresAtMs: number;
}

@Injectable()
export class KisApiService {
  private readonly logger = new Logger(KisApiService.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private cachedToken: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {
    const rawUrl =
      config.get<string>('KIS_BASE_URL') ?? 'https://openapi.koreainvestment.com:9443';
    this.baseUrl = rawUrl.replace(/^http:\/\//, 'https://').replace(/\/+$/, '');

    this.client = axios.create({ timeout: 15_000, maxRedirects: 0 });
    axiosRetry(this.client, {
      retries: 3,
      // engine1(dart-api.service.ts)의 검증된 패턴 준용: 지수 백오프(2^n·100ms + 지터, Retry-After 존중).
      // 이전 선형(retryCount×1000)에서 교체 — 유량초과 폭주 시 서버 부하를 지수적으로 완화(DAR-480).
      retryDelay: axiosRetry.exponentialDelay,
      // 유량초과가 HTTP 200 본문(EGW00201)으로 오는 경우까지 재시도하기 위해 200 응답도 검사한다.
      validateResponse: validateKisResponse,
      retryCondition: shouldRetryKisError,
      onRetry: (retryCount, error) => {
        const reason = isKisRateLimitedBody((error as AxiosError).response?.data)
          ? '유량초과(EGW00201)'
          : error.message;
        this.logger.warn(`[KIS] 재시도 ${retryCount}/3: ${reason}`);
      },
    });
  }

  /** 키 설정 여부 — 미설정이면 폴러/소비측이 graceful 비활성한다(실호출 0). */
  get isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('KIS_APP_KEY') && this.config.get<string>('KIS_APP_SECRET'),
    );
  }

  private appKey(): string {
    const key = this.config.get<string>('KIS_APP_KEY');
    const secret = this.config.get<string>('KIS_APP_SECRET');
    if (!key || !secret) {
      throw new KisApiUnavailableError(
        'KIS_APP_KEY/KIS_APP_SECRET 미설정 — 실시간 시세 비활성. .env 주입 후 활성화(DAR-140).',
      );
    }
    return key;
  }

  /**
   * OAuth2 접근토큰 발급(client_credentials) — 만료 전까지 캐시 재사용.
   * @param nowMs 현재 epoch ms(테스트 주입 가능). 미지정 시 Date.now().
   */
  async getAccessToken(nowMs: number = Date.now()): Promise<string> {
    const appkey = this.appKey();
    const appsecret = this.config.get<string>('KIS_APP_SECRET')!;

    if (this.cachedToken && this.cachedToken.expiresAtMs > nowMs) {
      return this.cachedToken.token;
    }

    const { data } = await this.client.post(`${this.baseUrl}/oauth2/tokenP`, {
      grant_type: 'client_credentials',
      appkey,
      appsecret,
    });
    const token = data?.access_token as string | undefined;
    if (!token) {
      throw new KisApiUnavailableError('KIS 토큰 발급 응답에 access_token 없음');
    }
    // expires_in(초) − 60초 안전 마진. 응답 결측 시 보수적으로 60초만 캐시.
    const ttlSec = Number(data?.expires_in ?? 0);
    const safeTtlMs = (ttlSec > 60 ? ttlSec - 60 : 60) * 1_000;
    this.cachedToken = { token, expiresAtMs: nowMs + safeTtlMs };
    return token;
  }

  private async authHeaders(trId: string, nowMs?: number): Promise<Record<string, string>> {
    const token = await this.getAccessToken(nowMs);
    return {
      authorization: `Bearer ${token}`,
      appkey: this.appKey(),
      appsecret: this.config.get<string>('KIS_APP_SECRET')!,
      tr_id: trId,
      custtype: 'P',
    };
  }

  /** 국내주식 실시간 현재가(inquire-price, tr_id FHKST01010100). */
  async fetchCurrentPrice(stockCode: string, nowMs?: number): Promise<KisCurrentPrice | null> {
    try {
      const headers = await this.authHeaders('FHKST01010100', nowMs);
      const { data } = await this.client.get(
        `${this.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price`,
        {
          headers,
          params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: stockCode },
        },
      );
      const o = data?.output;
      if (!o || o.stck_prpr == null) return null;
      return {
        stockCode,
        price: this.parseNum(o.stck_prpr),
        open: this.parseNum(o.stck_oprc),
        high: this.parseNum(o.stck_hgpr),
        low: this.parseNum(o.stck_lwpr),
        volume: this.parseNum(o.acml_vol),
      };
    } catch (e) {
      if (e instanceof KisApiUnavailableError) throw e;
      this.logger.error(`[KIS] inquire-price 현재가 소실 ${stockCode}: ${this.failureReason(e)}`);
      return null;
    }
  }

  /** 국내주식 당일 분봉(inquire-time-itemchartprice, tr_id FHKST03010200). 최신순 → 오름차순 반환. */
  async fetchMinuteCandles(
    stockCode: string,
    hhmmss = '',
    nowMs?: number,
  ): Promise<KisMinuteCandle[]> {
    try {
      const headers = await this.authHeaders('FHKST03010200', nowMs);
      const { data } = await this.client.get(
        `${this.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`,
        {
          headers,
          params: {
            FID_ETC_CLS_CODE: '',
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_INPUT_ISCD: stockCode,
            FID_INPUT_HOUR_1: hhmmss,
            FID_PW_DATA_INCU_YN: 'N',
          },
        },
      );
      const rows: Array<Record<string, string>> = data?.output2 ?? [];
      const candles = rows.map((r) => ({
        time: r['stck_cntg_hour'] ?? '',
        open: this.parseNum(r['stck_oprc']),
        high: this.parseNum(r['stck_hgpr']),
        low: this.parseNum(r['stck_lwpr']),
        close: this.parseNum(r['stck_prpr']),
        volume: this.parseNum(r['cntg_vol']),
      }));
      // KIS 는 최신→과거 순으로 준다 → 오름차순(시간순)으로 뒤집어 일관성 확보.
      return candles.reverse();
    } catch (e) {
      if (e instanceof KisApiUnavailableError) throw e;
      this.logger.error(
        `[KIS] inquire-time-itemchartprice 분봉 소실 ${stockCode}: ${this.failureReason(e)}`,
      );
      return [];
    }
  }

  /**
   * 국내주식 당일 분봉 '전 구간' 수집 (DAR-377) — forward 축적 적재용.
   *
   * KIS inquire-time-itemchartprice 는 한 호출당 최신 ~30분(output2) 만 반환한다. 당일 세션 전체
   * (09:00~15:30 ≈ 390분)를 모으려면 FID_INPUT_HOUR_1(앵커 시각)을 과거로 옮기며 페이지네이션해야
   * 한다. 가장 이른 캔들 시각(earliest)을 다음 페이지 앵커로 삼아 과거로 거슬러 올라가고,
   * 더 이른 캔들이 나오지 않으면(진전 없음) 종료한다. time(HHMMSS) 키로 중복 제거 후 오름차순 반환.
   *
   * ★레이트리밋: 페이지 간 pageDelayMs(기본 150ms) 지연 + maxPages(기본 20) 상한으로 KIS 초당 제한을
   *   넘지 않게 가드한다. 단일 호출(fetchMinuteCandles)과 동일하게 키 미설정은 throw, 그 외 실패는
   *   graceful(그때까지 모은 캔들 반환).
   *
   * @param maxPages 최대 페이지 수(기본 20 — 30분×20=600분, 세션 390분 + 여유)
   * @param pageDelayMs 페이지 호출 간 지연 ms(기본 150 — 레이트리밋 스로틀)
   * @param sleep 지연 주입(테스트용 — 미지정 시 실제 setTimeout)
   */
  async fetchMinuteCandlesFullDay(
    stockCode: string,
    opts: { maxPages?: number; pageDelayMs?: number; nowMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<KisMinuteCandle[]> {
    const maxPages = opts.maxPages ?? 20;
    const pageDelayMs = opts.pageDelayMs ?? 150;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const byTime = new Map<string, KisMinuteCandle>();
    let anchor = ''; // 최초 페이지: 빈 앵커 = 최신 캔들부터.
    let prevEarliest: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const candles = await this.fetchMinuteCandles(stockCode, anchor, opts.nowMs);
      if (candles.length === 0) break; // 더 이상 데이터 없음(장 시작 이전·휴장).

      for (const c of candles) {
        if (c.time) byTime.set(c.time, c);
      }

      // 오름차순이므로 [0] 이 이 페이지의 가장 이른 시각.
      const earliest = candles[0]?.time ?? '';
      // 진전 없음(같은 earliest 반복) 또는 장 시작(09:00) 도달 시 종료.
      if (!earliest || (prevEarliest !== null && earliest >= prevEarliest)) break;
      prevEarliest = earliest;
      if (earliest <= '090000') break;

      // 다음 페이지는 가장 이른 시각을 앵커로 과거를 더 받는다(중복은 byTime 으로 제거).
      anchor = earliest;
      if (page < maxPages - 1 && pageDelayMs > 0) await sleep(pageDelayMs);
    }

    return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  /**
   * 국내 업종(시장)지수 현재값(inquire-index-price, tr_id FHPUP02100000) — DAR-371.
   *
   * 홈 배지가 '6/5 종가(stale)'를 '현재'처럼 표시하던 신뢰 문제를 해소하기 위해, 주식 실시간가와
   * 동일 정신으로 지수의 '실시간/실가'를 확보한다(소비측 source=REALTIME 라벨).
   *
   * 지수코드: KOSPI 종합 '0001' · KOSDAQ 종합 '1001'. FID_COND_MRKT_DIV_CODE='U'(업종).
   * 응답 output: bstp_nmix_prpr(현재지수)·bstp_nmix_prdy_vrss(전일대비 절대값)·prdy_vrss_sign
   *   (부호 1상한·2상승·3보합·4하한·5하락)·bstp_nmix_oprc/hgpr/lwpr.
   * 등락률은 KIS ctrt 의 부호 모호성을 피하기 위해 prevClose=price−change 로 자체 산출한다.
   *
   * ★정직: 받은 값은 '실제 시장 실시간가'다. 키 미설정 예외(KisApiUnavailableError)는 throw,
   *   파싱 불가/응답 결측/네트워크 실패는 null 로 graceful — 소비측이 EOD 폴백으로 전환한다.
   */
  async fetchIndexPrice(indexCode: string, nowMs?: number): Promise<KisIndexPrice | null> {
    try {
      const headers = await this.authHeaders('FHPUP02100000', nowMs);
      const { data } = await this.client.get(
        `${this.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-index-price`,
        {
          headers,
          params: { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: indexCode },
        },
      );
      const o = data?.output;
      const price = this.parseDecimal(o?.bstp_nmix_prpr);
      if (!o || o.bstp_nmix_prpr == null || price <= 0) return null;

      // 전일대비는 절대값 + 별도 부호(prdy_vrss_sign). 4=하한·5=하락 → 음수.
      const vrssMag = this.parseDecimal(o.bstp_nmix_prdy_vrss);
      const sign = ['4', '5'].includes(String(o.prdy_vrss_sign ?? '').trim()) ? -1 : 1;
      const change = round2(sign * Math.abs(vrssMag));
      const prevClose = round2(price - change);
      const changePercent =
        prevClose > 0 ? round2((change / prevClose) * 100) : 0;

      return {
        indexCode,
        price,
        prevClose,
        change,
        changePercent,
        open: this.parseDecimal(o.bstp_nmix_oprc),
        high: this.parseDecimal(o.bstp_nmix_hgpr),
        low: this.parseDecimal(o.bstp_nmix_lwpr),
      };
    } catch (e) {
      if (e instanceof KisApiUnavailableError) throw e;
      this.logger.error(`[KIS] inquire-index-price 지수 소실 ${indexCode}: ${this.failureReason(e)}`);
      return null;
    }
  }

  /**
   * 국내주식/ETF 기간별시세(일봉) — inquire-daily-itemchartprice, tr_id FHKST03010100 (DAR-484).
   *
   * 주식·ETF·ETN 모두 FID_COND_MRKT_DIV_CODE='J' 로 동일 엔드포인트를 쓴다. ETF 단축코드(예:
   * 069500 KODEX 200)를 그대로 넘기면 일봉 OHLCV + 거래대금이 온다. 기존 재시도·백오프(EGW00201
   * 유량초과 200 본문 검사 포함)는 공유 client 를 경유하므로 자동 재사용된다(P08 하드닝 계승).
   *
   * KIS 는 한 호출당 최대 ~100영업일을 최신→과거 순으로 준다. 여기선 [startYmd, endYmd] 구간을
   * 한 번에 요청하고 오름차순(거래일순)으로 뒤집어 반환한다. 유니버스가 4~5종이라 유량 부담 극소.
   *
   * @param code    ETF/종목 6자리 단축코드
   * @param startYmd 조회 시작일 YYYYMMDD (FID_INPUT_DATE_1)
   * @param endYmd   조회 종료일 YYYYMMDD (FID_INPUT_DATE_2)
   * @param nowMs    현재 epoch ms(테스트 주입 가능)
   *
   * ★graceful: 키 미설정 예외(KisApiUnavailableError)는 throw, 그 외 실패는 [](빈배열) 로 —
   *   소비측(수집기)이 커버리지 정직 로그로 표면화한다. 유량초과 소진도 [] + failureReason 로깅.
   */
  async fetchDailyPrices(
    code: string,
    startYmd: string,
    endYmd: string,
    nowMs?: number,
  ): Promise<KisDailyBar[]> {
    try {
      const headers = await this.authHeaders('FHKST03010100', nowMs);
      const { data } = await this.client.get(
        `${this.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,
        {
          headers,
          params: {
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_INPUT_ISCD: code,
            FID_INPUT_DATE_1: startYmd,
            FID_INPUT_DATE_2: endYmd,
            FID_PERIOD_DIV_CODE: 'D', // 일봉
            FID_ORG_ADJ_PRC: '0', // 0=수정주가 반영
          },
        },
      );
      const rows: Array<Record<string, string>> = data?.output2 ?? [];
      const bars = rows
        .filter((r) => r && r['stck_bsop_date'] && r['stck_clpr'] != null)
        .map((r) => ({
          tradeDate: String(r['stck_bsop_date']).trim(),
          open: this.parseNum(r['stck_oprc']),
          high: this.parseNum(r['stck_hgpr']),
          low: this.parseNum(r['stck_lwpr']),
          close: this.parseNum(r['stck_clpr']),
          volume: this.parseNum(r['acml_vol']),
          tradingValue: this.parseNum(r['acml_tr_pbmn']),
        }));
      // KIS 는 최신→과거 순으로 준다 → 거래일 오름차순으로 정렬(일관성).
      return bars.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    } catch (e) {
      if (e instanceof KisApiUnavailableError) throw e;
      this.logger.error(
        `[KIS] inquire-daily-itemchartprice 일봉 소실 ${code}: ${this.failureReason(e)}`,
      );
      return [];
    }
  }

  /**
   * fetch 실패 사유를 사람이 읽을 수 있게 분류(로깅용, DAR-480). 유량초과 소진은 명시 플래그로
   * 표기해 '조용한 데이터 소실'을 관측 가능하게 한다. 반환 계약(null/빈배열)은 호출부에서 유지.
   */
  private failureReason(e: unknown): string {
    const err = e as AxiosError;
    if (isKisRateLimitedBody(err?.response?.data)) {
      return '유량초과(EGW00201) 재시도 소진';
    }
    const status = err?.response?.status;
    if (status === 429 || status === 503) {
      return `레이트리밋(HTTP ${status}) 재시도 소진`;
    }
    if (status) return `HTTP ${status}`;
    return (e as Error)?.message ?? 'unknown';
  }

  private parseNum(v: string | number | null | undefined): number {
    if (v == null) return 0;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  /** 지수·등락폭처럼 소수 2자리가 의미 있는 값 파싱(반올림 없이 소수 2자리 유지). */
  private parseDecimal(v: string | number | null | undefined): number {
    if (v == null) return 0;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? round2(n) : 0;
  }
}

/** 소수 2자리 반올림(지수·등락 표시용). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
