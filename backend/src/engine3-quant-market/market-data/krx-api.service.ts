import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { formatKstDateCompact } from '../../common/time/kst';

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

/** 종목 기본정보 (stk_isu_base_info / ksq_isu_base_info) */
export interface KrxStockBaseInfo {
  stockCode: string;
  stockName: string;
  marketType: 'KOSPI' | 'KOSDAQ' | 'KONEX';
  // TODO: isManagement, isHalted — 실응답 필드명 확인 후 매핑 (승인 후 확정)
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
    // KRX 데이터마켓플레이스는 HTTPS 전용 — http:// 입력 시 자동 보정
    const rawUrl = config.get<string>('KRX_BASE_URL') ?? 'https://data-dbg.krx.co.kr/svc/apis';
    this.baseUrl = rawUrl.replace(/^http:\/\//, 'https://');

    this.client = axios.create({
      timeout: 30_000,
      maxRedirects: 0, // HTTPS로 보정하므로 리다이렉트 불필요
    });
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

  private buildParams(base: Record<string, string>): Record<string, string> {
    // AUTH_KEY를 쿼리 파라미터에도 추가 (헤더+파라미터 이중 전송으로 호환성 확보)
    return { ...base, AUTH_KEY: this.getApiKey() };
  }

  /**
   * 종목 일봉 OHLCV 수집.
   * @param basDd 기준일 (YYYYMMDD)
   * @param stockCode 종목코드 6자리. 생략하면 전 종목.
   */
  async fetchStockDaily(basDd: string, stockCode?: string): Promise<KrxStockDailyRow[]> {
    const rawParams: Record<string, string> = { basDd };
    if (stockCode) rawParams['isuCd'] = stockCode;

    try {
      const { data } = await this.client.get(`${this.baseUrl}/sto/stk_bydd_trd`, {
        params: this.buildParams(rawParams),
        headers: this.buildHeaders(),
      });

      const rows = data?.['OutBlock_1'] ?? data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        stockCode: r['ISU_CD'] ?? r['MKSC_SHRN_ISCD'] ?? r['isuSrtCd'] ?? '',
        isuAbbrv: r['ISU_NM'] ?? r['ISU_ABBRV'] ?? r['isuAbbrv'] ?? '',
        openPrice: this.parseNum(r['TDD_OPNPRC'] ?? r['tddOpnprc'] ?? '0'),
        highPrice: this.parseNum(r['TDD_HGPRC'] ?? r['tddHgprc'] ?? '0'),
        lowPrice: this.parseNum(r['TDD_LWPRC'] ?? r['tddLwprc'] ?? '0'),
        closePrice: this.parseNum(r['TDD_CLSPRC'] ?? r['tddClsprc'] ?? '0'),
        volume: this.parseNum(r['ACC_TRDVOL'] ?? r['ACML_VOL'] ?? r['acmlVol'] ?? '0'),
        tradingValue: this.parseNum(r['ACC_TRDVAL'] ?? r['ACML_TRAD_PBMN'] ?? r['acmlTradPbmn'] ?? '0'),
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] stk_bydd_trd 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 코스닥 종목 일봉 OHLCV 수집 (sto/ksq_bydd_trd).
   * @param basDd 기준일 (YYYYMMDD)
   * @param stockCode 종목코드 6자리. 생략하면 전 코스닥 종목.
   */
  async fetchKosqdaqDaily(basDd: string, stockCode?: string): Promise<KrxStockDailyRow[]> {
    const rawParams: Record<string, string> = { basDd };
    if (stockCode) rawParams['isuCd'] = stockCode;

    try {
      const { data } = await this.client.get(`${this.baseUrl}/sto/ksq_bydd_trd`, {
        params: this.buildParams(rawParams),
        headers: this.buildHeaders(),
      });

      const rows = data?.['OutBlock_1'] ?? data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        stockCode: r['ISU_CD'] ?? r['MKSC_SHRN_ISCD'] ?? r['isuSrtCd'] ?? '',
        isuAbbrv: r['ISU_NM'] ?? r['ISU_ABBRV'] ?? r['isuAbbrv'] ?? '',
        openPrice: this.parseNum(r['TDD_OPNPRC'] ?? r['tddOpnprc'] ?? '0'),
        highPrice: this.parseNum(r['TDD_HGPRC'] ?? r['tddHgprc'] ?? '0'),
        lowPrice: this.parseNum(r['TDD_LWPRC'] ?? r['tddLwprc'] ?? '0'),
        closePrice: this.parseNum(r['TDD_CLSPRC'] ?? r['tddClsprc'] ?? '0'),
        volume: this.parseNum(r['ACC_TRDVOL'] ?? r['ACML_VOL'] ?? r['acmlVol'] ?? '0'),
        tradingValue: this.parseNum(r['ACC_TRDVAL'] ?? r['ACML_TRAD_PBMN'] ?? r['acmlTradPbmn'] ?? '0'),
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] ksq_bydd_trd 실패 basDd=${basDd}: ${(e as Error).message}`);
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
    // 종합지수 행 식별명. kospi_dd_trd/kosdaq_dd_trd 는 종합지수 외에 200·100·업종지수 등
    // 수십 개 시리즈를 함께 반환한다(IDX_NM 으로 구분). 종합지수만 선별해야 한다 (DAR-367).
    const compositeName = indexType === 'KOSPI' ? '코스피' : '코스닥';

    try {
      const { data } = await this.client.get(endpoint, {
        params: this.buildParams({ basDd }),
        headers: this.buildHeaders(),
      });

      const rows: Array<Record<string, string>> =
        data?.['OutBlock_1'] ?? data?.OutBlock1 ?? data?.output1 ?? [];

      // DAR-367 근본 원인 정정: 이전 구현은 응답의 모든 시리즈 행을 동일 indexCode('0001')로
      // 매핑해 적재했고, @@unique([indexCode,tradeDate]) upsert 에서 마지막 행(업종지수 등)이
      // 종합지수를 덮어써 일자별로 3132/8639 처럼 오염값이 저장됐다. 종합지수(IDX_NM=='코스피'/
      // '코스닥') 행 1건만 선별한다. 미발견 시 임의 행을 적재하지 않고 빈 배열로 스킵.
      const composite = rows.find(
        (r) => String(r['IDX_NM'] ?? r['idxNm'] ?? '').trim() === compositeName,
      );
      if (!composite) {
        this.logger.warn(
          `[KRX] ${indexType} 종합지수(IDX_NM=${compositeName}) 행 미발견 — rows=${rows.length}, 적재 스킵 basDd=${basDd}`,
        );
        return [];
      }

      return [
        {
          indexCode,
          indexName,
          openIndex: this.parseFloat(composite['OPNPRC_IDX'] ?? composite['opnprcIdx'] ?? '0'),
          highIndex: this.parseFloat(composite['HGPRC_IDX'] ?? composite['hgprcIdx'] ?? '0'),
          lowIndex: this.parseFloat(composite['LWPRC_IDX'] ?? composite['lwprcIdx'] ?? '0'),
          closeIndex: this.parseFloat(composite['CLSPRC_IDX'] ?? composite['clsprcIdx'] ?? '0'),
          volume: this.parseNum(composite['ACC_TRDVOL'] ?? composite['ACML_VOL'] ?? composite['acmlVol'] ?? '0'),
          tradingValue: this.parseNum(
            composite['ACC_TRDVAL'] ?? composite['ACML_TRAD_PBMN'] ?? composite['acmlTradPbmn'] ?? '0',
          ),
        },
      ];
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] ${indexType} 지수 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 유가증권(KOSPI) 종목기본정보 수집 (sto/stk_isu_base_info).
   * 종목코드·종목명·시장구분 매핑. Company.stockCode 정합용.
   * @param basDd 기준일
   */
  async fetchStkIsuBaseInfo(basDd: string): Promise<KrxStockBaseInfo[]> {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/sto/stk_isu_base_info`, {
        params: this.buildParams({ basDd }),
        headers: this.buildHeaders(),
      });

      const rows = data?.['OutBlock_1'] ?? data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        stockCode: r['ISU_SRT_CD'] ?? r['ISU_CD'] ?? r['MKSC_SHRN_ISCD'] ?? '',
        stockName: r['ISU_ABBRV'] ?? r['ISU_NM'] ?? r['isuAbbrv'] ?? '',
        marketType: 'KOSPI' as const,
        // TODO: isManagement, isHalted — 실응답 필드명 확인 후 매핑 (KRX 승인 후)
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] stk_isu_base_info 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 코스닥 종목기본정보 수집 (sto/ksq_isu_base_info).
   * 종목코드·종목명·시장구분 매핑. Company.stockCode 정합용.
   * @param basDd 기준일
   */
  async fetchKsqIsuBaseInfo(basDd: string): Promise<KrxStockBaseInfo[]> {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/sto/ksq_isu_base_info`, {
        params: this.buildParams({ basDd }),
        headers: this.buildHeaders(),
      });

      const rows = data?.['OutBlock_1'] ?? data?.OutBlock1 ?? data?.output1 ?? [];
      return rows.map((r: Record<string, string>) => ({
        stockCode: r['ISU_SRT_CD'] ?? r['ISU_CD'] ?? r['MKSC_SHRN_ISCD'] ?? '',
        stockName: r['ISU_ABBRV'] ?? r['ISU_NM'] ?? r['isuAbbrv'] ?? '',
        marketType: 'KOSDAQ' as const,
        // TODO: isManagement, isHalted — 실응답 필드명 확인 후 매핑 (KRX 승인 후)
      }));
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) throw e;
      this.logger.error(`[KRX] ksq_isu_base_info 실패 basDd=${basDd}: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 시장분류(KOSPI/KOSDAQ) 폴백 소스 — 일별매매정보(stk/ksq_bydd_trd)에서 도출 (DAR-330).
   *
   * 배경: stk/ksq_isu_base_info 가 (날짜 무관) 빈 응답을 반환하는 환경에서도
   * 일별매매정보 엔드포인트(stk_bydd_trd·ksq_bydd_trd)는 정상 동작이 입증되었다
   * (StockDailyPrice 수백만 행 적재). 동일 AUTH_KEY·베이스URL·파싱 경로를 공유하므로
   * 이를 시장분류 대체 소스로 사용한다.
   *
   * 분류 근거: 두 엔드포인트가 시장별로 분리되어 있으므로 "어느 엔드포인트에서
   * 반환되었는가"가 곧 시장구분이다. stk_bydd_trd → KOSPI, ksq_bydd_trd → KOSDAQ.
   * (KONEX 는 별도 엔드포인트가 없어 분류 대상 아님 — 기존 값 보존.)
   *
   * 반환 형식은 fetchStkIsuBaseInfo / fetchKsqIsuBaseInfo 와 동일(KrxStockBaseInfo[])
   * 이므로 호출부(syncCompanyMarkets)에서 동일 매핑 로직으로 처리할 수 있다.
   *
   * @param basDd 기준일 (YYYYMMDD)
   */
  async fetchMarketClassificationFallback(basDd: string): Promise<KrxStockBaseInfo[]> {
    const [kospiRows, kosdaqRows] = await Promise.all([
      this.fetchStockDaily(basDd),
      this.fetchKosqdaqDaily(basDd),
    ]);

    const toBaseInfo = (
      rows: KrxStockDailyRow[],
      marketType: 'KOSPI' | 'KOSDAQ',
    ): KrxStockBaseInfo[] =>
      rows
        .filter((r) => r.stockCode)
        .map((r) => ({ stockCode: r.stockCode, stockName: r.isuAbbrv, marketType }));

    return [...toBaseInfo(kospiRows, 'KOSPI'), ...toBaseInfo(kosdaqRows, 'KOSDAQ')];
  }

  /**
   * 종목 상태 수집.
   * isu_mrktact_info(404 확인) → stk_isu_base_info + ksq_isu_base_info로 교체.
   * 거래정지·관리종목 필드는 실응답 확인 후 매핑 예정 (TODO 참조).
   * @param basDd 기준일
   */
  async fetchStockStatus(basDd: string): Promise<KrxStockStatus[]> {
    try {
      const [stkRows, ksqRows] = await Promise.all([
        this.fetchStkIsuBaseInfo(basDd),
        this.fetchKsqIsuBaseInfo(basDd),
      ]);

      return [...stkRows, ...ksqRows].map((info) => ({
        stockCode: info.stockCode,
        corpName: info.stockName,
        // TODO: KRX 승인 후 실응답에서 거래정지/관리종목 필드명 확인하여 매핑
        isHalted: false,
        isManagement: false,
        isWarning: false,
        isSurge: false,
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

  /**
   * YYYYMMDD 포맷 → Date
   *
   * DAR-329: undefined/빈문자/형식불량 입력은 `.slice` 크래시(TypeError) 대신 명확한
   * 에러로 거절한다 — 호출부(수동 컨트롤러 등)가 기준일을 누락하면 8자리 숫자 기본값을
   * 먼저 채워 넘기도록 강제하기 위함.
   */
  parseDate(yyyymmdd: string): Date {
    if (typeof yyyymmdd !== 'string' || !/^[0-9]{8}$/.test(yyyymmdd)) {
      throw new Error(
        `[KRX] parseDate: 기준일은 8자리 YYYYMMDD 문자열이어야 합니다 (받음: ${JSON.stringify(yyyymmdd)})`,
      );
    }
    return new Date(
      parseInt(yyyymmdd.slice(0, 4)),
      parseInt(yyyymmdd.slice(4, 6)) - 1,
      parseInt(yyyymmdd.slice(6, 8)),
    );
  }

  /** Date → YYYYMMDD(KST 거래일). 시스템 TZ 무관 — UTC 새벽 전일 반환 방지(DAR-199). */
  formatDate(date: Date): string {
    return formatKstDateCompact(date);
  }

  private parseNum(raw: string): number {
    return parseInt(String(raw).replace(/,/g, '')) || 0;
  }

  private parseFloat(raw: string): number {
    return parseFloat(String(raw).replace(/,/g, '')) || 0;
  }
}
