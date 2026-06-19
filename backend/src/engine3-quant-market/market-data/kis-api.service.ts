import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

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
      retryDelay: (retryCount) => retryCount * 1_000,
      retryCondition: (error) => {
        const status = error.response?.status;
        return axiosRetry.isNetworkError(error) || status === 429 || status === 503;
      },
      onRetry: (retryCount, error) => {
        this.logger.warn(`[KIS] 재시도 ${retryCount}/3: ${error.message}`);
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
      this.logger.error(`[KIS] inquire-price 실패 ${stockCode}: ${(e as Error).message}`);
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
      this.logger.error(`[KIS] inquire-time-itemchartprice 실패 ${stockCode}: ${(e as Error).message}`);
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
      this.logger.error(`[KIS] inquire-index-price 실패 ${indexCode}: ${(e as Error).message}`);
      return null;
    }
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
