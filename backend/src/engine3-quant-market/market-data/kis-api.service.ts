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

  private parseNum(v: string | number | null | undefined): number {
    if (v == null) return 0;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
}
