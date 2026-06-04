import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

/**
 * KRX_API_KEY 미설정 또는 오프라인 시 throw.
 * DART 어댑터와 동일 패턴 — 앱 부팅은 허용, 실제 호출만 차단.
 */
export class KrxApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KrxApiUnavailableError';
  }
}

export interface KrxStockDailyRow {
  stockCode: string;
  isuAbbrv: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  tradingValue: number;
}

export interface KrxIndexDailyRow {
  indexCode: string;
  indexName: string;
  openIndex: number;
  highIndex: number;
  lowIndex: number;
  closeIndex: number;
  volume: number;
  tradingValue: number;
}

/** 종목 상태 (거래정지·관리종목·투자주의·이상급등) */
export interface KrxStockStatus {
  stockCode: string;
  corpName: string;
  isHalted: boolean;       // 거래정지
  isManagement: boolean;   // 관리종목
  isWarning: boolean;      // 투자주의
  isSurge: boolean;        // 이상급등
}

/**
 * KRX 데이터마켓플레이스 HTTP 클라이언트.
 * env: KRX_API_KEY(필수) · KRX_BASE_URL(기본값 제공)
 * 키 미설정 시 호출 시점에 KrxApiUnavailableError — graceful 처리.
 * 재시도: exponential backoff 3회, 레이트리밋 대응.
 */
@Injectable()
export class KrxApiService {
  private readonly logger = new Logger(KrxApiService.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('KRX_BASE_URL') ?? 'http://data-dbg.krx.co.kr/svc/apis';

    this.client = axios.create({ timeout: 30_000 });
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: (retryCount) => retryCount * 2_000,
      retryCondition: (error) => {
        const status = error.response?.status;
        return axiosRetry.isNetworkError(error) || status === 429 || status === 503;
      },
      onRetry: (retryCount, error) => {
        this.logger.warn(`[KRX] 재시도 ${retryCount}/3: ${error.message}`);
      },
    });
  }

  private getApiKey(): string {
    const key = this.config.get<string>('KRX_API_KEY');
    if (!key) {
      throw new KrxApiUnavailableError(
        'KRX_API_KEY 미설정 — Engine3 시세 수집 불가. .env에 KRX_API_KEY / KRX_BASE_URL 설정 필요 (M4).',
      );
    }
    return key;
  }

  private buildHeaders() {
    return { AUTH_KEY: this.getApiKey() };
  }

  /**
   * 종목 일봉 OHLCV 수집.
   * @param basDd 기준일 (YYYYMMDD)
   * @param stockCode 종목코드 6자리. 생략하면 전 종목.
   */
  async fetchStockDaily(basDd: string, stockCode?: string): Promise<KrxStockDailyRow[]> {
    const params: Record<string, string> = { basDd };
    if (stockCode) params['isuCd'] = stockCode;

    try {
      const { data } = await this.client.get(`${this.baseUrl}/sto/stk_bydd_trd`, {
        params,
        headers: this.buildHeaders(),
      });

      const rows = data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        stockCode: r['MKSC_SHRN_ISCD'] ?? r['isuSrtCd'] ?? '',
        isuAbbrv: r['ISU_ABBRV'] ?? r['isuAbbrv'] ?? '',
        openPrice: this.parseNum(r['TDD_OPNPRC'] ?? r['tddOpnprc'] ?? '0'),
        highPrice: this.parseNum(r['TDD_HGPRC'] ?? r['tddHgprc'] ?? '0'),
        lowPrice: this.parseNum(r['TDD_LWPRC'] ?? r['tddLwprc'] ?? '0'),
        closePrice: this.parseNum(r['TDD_CLSPRC'] ?? r['tddClsprc'] ?? '0'),
        volume: this.parseNum(r['ACML_VOL'] ?? r['acmlVol'] ?? '0'),
        tradingValue: this.parseNum(r['ACML_TRAD_PBMN'] ?? r['acmlTradPbmn'] ?? '0'),
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] stk_bydd_trd 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 시장지수 일봉 수집 (KOSPI/KOSDAQ).
   * @param indexType 'KOSPI' | 'KOSDAQ'
   * @param basDd 기준일 (YYYYMMDD)
   */
  async fetchIndexDaily(indexType: 'KOSPI' | 'KOSDAQ', basDd: string): Promise<KrxIndexDailyRow[]> {
    const endpoint =
      indexType === 'KOSPI'
        ? `${this.baseUrl}/idx/kospi_dd_trd`
        : `${this.baseUrl}/idx/kosdaq_dd_trd`;

    const indexCode = indexType === 'KOSPI' ? '0001' : '1001';
    const indexName = indexType === 'KOSPI' ? 'KOSPI' : 'KOSDAQ';

    try {
      const { data } = await this.client.get(endpoint, {
        params: { basDd },
        headers: this.buildHeaders(),
      });

      const rows = data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        indexCode,
        indexName,
        openIndex: this.parseFloat(r['OPNPRC_IDX'] ?? r['opnprcIdx'] ?? '0'),
        highIndex: this.parseFloat(r['HGPRC_IDX'] ?? r['hgprcIdx'] ?? '0'),
        lowIndex: this.parseFloat(r['LWPRC_IDX'] ?? r['lwprcIdx'] ?? '0'),
        closeIndex: this.parseFloat(r['CLSPRC_IDX'] ?? r['clsprcIdx'] ?? '0'),
        volume: this.parseNum(r['ACML_VOL'] ?? r['acmlVol'] ?? '0'),
        tradingValue: this.parseNum(r['ACML_TRAD_PBMN'] ?? r['acmlTradPbmn'] ?? '0'),
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] ${indexType} 지수 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 종목 상태 수집 (거래정지·관리종목·투자주의·이상급등).
   * @param basDd 기준일
   */
  async fetchStockStatus(basDd: string): Promise<KrxStockStatus[]> {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/sto/isu_mrktact_info`, {
        params: { basDd },
        headers: this.buildHeaders(),
      });

      const rows = data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        stockCode: r['MKSC_SHRN_ISCD'] ?? r['isuSrtCd'] ?? '',
        corpName: r['ISU_ABBRV'] ?? r['isuAbbrv'] ?? '',
        isHalted: (r['MKT_ACT_TP_CD'] ?? r['mktActTpCd'] ?? '') === '11',
        isManagement: (r['MKT_ACT_TP_CD'] ?? r['mktActTpCd'] ?? '') === '12',
        isWarning: (r['MKT_ACT_TP_CD'] ?? r['mktActTpCd'] ?? '') === '21',
        isSurge: (r['MKT_ACT_TP_CD'] ?? r['mktActTpCd'] ?? '') === '31',
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] 종목상태 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /** 거래일 여부 확인 — 토·일 + 단순 규칙(공휴일은 수집 실패로 자동 스킵) */
  isWeekend(date: Date): boolean {
    const day = date.getDay(); // 0=일, 6=토
    return day === 0 || day === 6;
  }

  /** YYYYMMDD 포맷 → Date */
  parseDate(yyyymmdd: string): Date {
    return new Date(
      parseInt(yyyymmdd.slice(0, 4)),
      parseInt(yyyymmdd.slice(4, 6)) - 1,
      parseInt(yyyymmdd.slice(6, 8)),
    );
  }

  /** Date → YYYYMMDD */
  formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private parseNum(raw: string): number {
    return parseInt(String(raw).replace(/,/g, '')) || 0;
  }

  private parseFloat(raw: string): number {
    return parseFloat(String(raw).replace(/,/g, '')) || 0;
  }
}
