import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import * as AdmZip from 'adm-zip';
import { DISCLOSURE_TYPE_IDS } from '../disclosures/constants/disclosure-types.constant';

/**
 * DART API 키 미설정 또는 오프라인 환경에서 downloadDocument 호출 시 throw되는 에러
 */
export class DartApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DartApiUnavailableError';
  }
}

export interface DartDisclosureItem {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  corp_cls: string; // Y(유가), K(코스닥), N(코넥스), E(기타)
  report_nm: string;
  rcept_no: string;
  flr_nm: string;
  rcept_dt: string; // YYYYMMDD
  rm: string; // 비고
}

export interface DartListResponse {
  status: string; // "000" = 정상
  message: string;
  page_no: number;
  page_count: number;
  total_count: number;
  total_page: number;
  list: DartDisclosureItem[];
}

/**
 * DART 재무제표 보고서 코드 (정기공시)
 * - 11011: 사업보고서(연간) / 11012: 반기보고서 / 11013: 1분기 / 11014: 3분기
 */
export const DART_REPORT_CODE = {
  ANNUAL: '11011',
  HALF: '11012',
  Q1: '11013',
  Q3: '11014',
} as const;
export type DartReportCode = (typeof DART_REPORT_CODE)[keyof typeof DART_REPORT_CODE];

/** 재무제표 구분: CFS(연결) / OFS(별도) */
export type DartFsDiv = 'CFS' | 'OFS';

/** DART 단일회사 전체 재무제표(fnlttSinglAcntAll) 개별 계정 행 */
export interface DartFinancialStatementItem {
  rcept_no: string;
  reprt_code: string;
  bsns_year: string;
  corp_code: string;
  sj_div: string; // BS(재무상태표) | IS(손익) | CIS(포괄손익) | CF | SCE
  sj_nm: string;
  account_id: string; // 표준 XBRL 태그 (예: ifrs-full_Revenue). 비표준은 '-dart_...' 또는 '-'
  account_nm: string; // 계정명 (예: 매출액)
  account_detail?: string;
  thstrm_nm?: string; // 당기명
  thstrm_amount: string; // 당기금액 (콤마 포함 문자열)
  frmtrm_amount?: string; // 전기금액
  bfefrmtrm_amount?: string; // 전전기금액
  fs_div?: string;
  fs_nm?: string;
}

export interface DartFinancialResponse {
  status: string; // "000" 정상 / "013" 데이터 없음
  message: string;
  list?: DartFinancialStatementItem[];
}

/**
 * 재무제표에서 추출한 핵심 지표 + 파생비율.
 * 금액 단위는 원(KRW). 시세 결합이 필요한 PER·PBR은 여기서 산출하지 않는다(수집 서비스에서 보강).
 */
export interface CompanyFinancialMetrics {
  revenue: number | null; // 매출액
  operatingProfit: number | null; // 영업이익
  netIncome: number | null; // 당기순이익
  totalAssets: number | null; // 자산총계
  totalLiabilities: number | null; // 부채총계
  totalEquity: number | null; // 자본총계
  eps: number | null; // 기본주당이익 (원)
  roe: number | null; // 자기자본이익률 (%) = 순이익/자본 × 100
  roa: number | null; // 총자산이익률 (%) = 순이익/자산 × 100
  debtRatio: number | null; // 부채비율 (%) = 부채/자본 × 100
}

/**
 * 주식등의 대량보유상황보고(majorstock.json) 개별 행 — 5%룰 지분공시.
 * DART 정형 응답 필드(콤마 포함 문자열 금액/비율). 결측은 빈 문자열/'-'.
 */
export interface DartMajorStockItem {
  rcept_no: string; // 접수번호
  rcept_dt?: string; // 접수일자 YYYYMMDD
  corp_code: string; // 고유번호
  corp_name?: string;
  report_tp?: string; // 보고구분 (신규/변동/변경)
  repror?: string; // 보고자
  stkqy?: string; // 보유 주식등의 수
  stkqy_irds?: string; // 보유 주식등의 증감
  stkrt?: string; // 보유 비율(%)
  stkrt_irds?: string; // 보유 비율 증감(%p)
  ctr_stkqy?: string; // 주요체결 주식등의 수
  ctr_stkrt?: string; // 주요체결 비율
  report_resn?: string; // 보고사유
}

/**
 * 임원·주요주주 특정증권등 소유상황보고(elestock.json) 개별 행 — 내부자 매매.
 */
export interface DartExecutiveStockItem {
  rcept_no: string; // 접수번호
  rcept_dt?: string; // 접수일자 YYYYMMDD
  corp_code: string;
  corp_name?: string;
  repror?: string; // 보고자(성명)
  isu_exctv_rgist_at?: string; // 등기임원 여부 (등기/비등기)
  isu_exctv_ofcps?: string; // 임원 직위
  isu_main_shrholdr?: string; // 주요주주 여부 (예: '10%이상주주')
  sp_stock_lmp_cnt?: string; // 특정증권등 소유 수
  sp_stock_lmp_irds_cnt?: string; // 특정증권등 소유 증감 수
  sp_stock_lmp_rate?: string; // 특정증권등 소유 비율(%)
  sp_stock_lmp_irds_rate?: string; // 특정증권등 소유 비율 증감(%p)
}

export interface DartHoldingListResponse<T> {
  status: string; // "000" 정상 / "013" 데이터 없음
  message: string;
  list?: T[];
}

export interface DartCompanyOverview {
  status: string;
  message: string;
  corp_code: string;
  corp_name: string;
  corp_name_eng: string;
  stock_name: string;
  stock_code: string;
  ceo_nm: string;
  corp_cls: string;
  jurir_no: string;
  bizr_no: string;
  adres: string;
  hm_url: string;
  ir_url: string;
  phn_no: string;
  fax_no: string;
  induty_code: string;
  est_dt: string;
  acc_mt: string;
}

@Injectable()
export class DartApiService {
  private readonly logger = new Logger(DartApiService.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DART_API_KEY', '');

    this.httpClient = axios.create({
      baseURL: 'https://opendart.fss.or.kr/api',
      timeout: 30000,
    });

    axiosRetry(this.httpClient, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  /**
   * DART 공시 목록 조회
   */
  async getDisclosureList(params: {
    bgn_de: string;
    end_de: string;
    page_no?: number;
    page_count?: number;
  }): Promise<DartListResponse> {
    try {
      const response = await this.httpClient.get('/list.json', {
        params: {
          crtfc_key: this.apiKey,
          ...params,
          page_count: params.page_count || 100,
        },
      });

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to fetch disclosure list from DART API',
        error,
      );
      throw error;
    }
  }

  /**
   * 모든 페이지의 공시 목록 조회
   */
  async getAllDisclosures(
    bgnDe: string,
    endDe: string,
  ): Promise<DartDisclosureItem[]> {
    const allItems: DartDisclosureItem[] = [];
    let pageNo = 1;
    const pageCount = 100;

    while (true) {
      const response = await this.getDisclosureList({
        bgn_de: bgnDe,
        end_de: endDe,
        page_no: pageNo,
        page_count: pageCount,
      });

      // "000" = 정상, "013" = 조회된 데이터 없음
      if (response.status === '013') {
        break;
      }

      if (response.status !== '000') {
        this.logger.warn(
          `DART API 응답 오류: ${response.status} - ${response.message}`,
        );
        break;
      }

      allItems.push(...response.list);

      if (pageNo >= response.total_page) {
        break;
      }

      pageNo++;
    }

    return allItems;
  }

  /**
   * DART 기업개황 조회
   */
  async getCompanyOverview(corpCode: string): Promise<DartCompanyOverview | null> {
    try {
      const response = await this.httpClient.get('/company.json', {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpCode,
        },
      });

      if (response.data.status !== '000') {
        this.logger.warn(`기업개황 조회 실패: ${response.data.status} - ${response.data.message}`);
        return null;
      }

      return response.data;
    } catch (error) {
      this.logger.error(`기업개황 조회 오류 (${corpCode})`, error);
      return null;
    }
  }

  /**
   * DART 단일회사 전체 재무제표 조회 (fnlttSinglAcntAll.json).
   * 정기공시(사업/반기/분기) 제출 재무제표의 표준 XBRL 계정을 전부 반환한다.
   *
   * API 키 미설정 시 DartApiUnavailableError를 throw(다른 수집 경로와 동일 graceful 계약).
   * DART 응답 status가 "013"(데이터 없음)이면 빈 list로 정상 반환한다.
   *
   * @param params.corpCode  DART 고유번호(8자리)
   * @param params.bsnsYear  사업연도 (예: '2025')
   * @param params.reprtCode 보고서코드 (DART_REPORT_CODE)
   * @param params.fsDiv     CFS(연결, 기본) | OFS(별도)
   */
  async fetchSingleCompanyFinancials(params: {
    corpCode: string;
    bsnsYear: string;
    reprtCode: DartReportCode;
    fsDiv?: DartFsDiv;
  }): Promise<DartFinancialResponse> {
    if (!this.apiKey) {
      throw new DartApiUnavailableError('DART_API_KEY가 설정되지 않았습니다');
    }

    const fsDiv = params.fsDiv ?? 'CFS';
    try {
      const response = await this.httpClient.get('/fnlttSinglAcntAll.json', {
        params: {
          crtfc_key: this.apiKey,
          corp_code: params.corpCode,
          bsns_year: params.bsnsYear,
          reprt_code: params.reprtCode,
          fs_div: fsDiv,
        },
      });

      const data = response.data as DartFinancialResponse;

      // "013" = 조회된 데이터 없음(미제출 등) → 정상 흐름. 그 외 비정상 status만 경고.
      if (data.status !== '000' && data.status !== '013') {
        this.logger.warn(
          `재무제표 조회 비정상 응답: ${data.status} - ${data.message} (${params.corpCode}/${params.bsnsYear}/${params.reprtCode}/${fsDiv})`,
        );
      }

      return { ...data, list: data.list ?? [] };
    } catch (error) {
      if (error instanceof DartApiUnavailableError) throw error;
      this.logger.error(
        `재무제표 조회 오류 (${params.corpCode}/${params.bsnsYear}/${params.reprtCode})`,
        error as Error,
      );
      throw error;
    }
  }

  /**
   * 재무제표 계정 행 배열에서 핵심 지표(매출·영업이익·순이익·자산·부채·자본·EPS)를 추출하고
   * 파생비율(ROE·ROA·부채비율)을 산출한다. 순수 함수(Rule) — AI 미개입.
   *
   * 표준 XBRL account_id 우선 매칭, 비표준 제출분은 account_nm(한글 계정명) 폴백.
   */
  extractFinancialMetrics(
    items: DartFinancialStatementItem[],
  ): CompanyFinancialMetrics {
    const revenue = this.pickAmount(
      items,
      ['ifrs-full_Revenue', 'ifrs_Revenue', 'dart_OperatingRevenue'],
      ['매출액', '수익(매출액)', '영업수익'],
    );
    const operatingProfit = this.pickAmount(
      items,
      ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'],
      ['영업이익', '영업이익(손실)'],
    );
    const netIncome = this.pickAmount(
      items,
      ['ifrs-full_ProfitLoss'],
      ['당기순이익', '당기순이익(손실)', '분기순이익', '반기순이익'],
    );
    const totalAssets = this.pickAmount(
      items,
      ['ifrs-full_Assets'],
      ['자산총계'],
    );
    const totalLiabilities = this.pickAmount(
      items,
      ['ifrs-full_Liabilities'],
      ['부채총계'],
    );
    const totalEquity = this.pickAmount(
      items,
      ['ifrs-full_Equity'],
      ['자본총계'],
    );
    const eps = this.pickAmount(
      items,
      ['ifrs-full_BasicEarningsLossPerShare', 'dart_BasicEarningsLossPerShare'],
      ['기본주당이익', '주당순이익', '기본주당순이익'],
    );

    const ratio = (numer: number | null, denom: number | null): number | null =>
      numer != null && denom != null && denom !== 0
        ? Math.round((numer / denom) * 10000) / 100 // 소수 2자리 % 반올림
        : null;

    return {
      revenue,
      operatingProfit,
      netIncome,
      totalAssets,
      totalLiabilities,
      totalEquity,
      eps,
      roe: ratio(netIncome, totalEquity),
      roa: ratio(netIncome, totalAssets),
      debtRatio: ratio(totalLiabilities, totalEquity),
    };
  }

  /**
   * account_id(표준 우선) 또는 account_nm(폴백)으로 당기금액을 찾아 숫자로 파싱.
   * 콤마 제거, 괄호 표기 음수 처리. 일치 행이 없으면 null.
   */
  private pickAmount(
    items: DartFinancialStatementItem[],
    accountIds: string[],
    accountNames: string[],
  ): number | null {
    const idSet = new Set(accountIds);
    let row = items.find((it) => idSet.has(it.account_id));
    if (!row) {
      row = items.find((it) =>
        accountNames.some((nm) => (it.account_nm ?? '').replace(/\s/g, '') === nm),
      );
    }
    if (!row) return null;
    return this.parseAmount(row.thstrm_amount);
  }

  /** DART 금액 문자열("1,234" / "(1,234)" / "-1,234")을 숫자로 파싱. 빈 값/비수치 → null */
  private parseAmount(raw: string | undefined | null): number | null {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (trimmed === '' || trimmed === '-') return null;
    const negative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed.replace(/[(),\s]/g, '');
    const n = Number(cleaned);
    if (isNaN(n)) return null;
    return negative ? -n : n;
  }

  /**
   * 주식등의 대량보유상황보고 조회 (majorstock.json) — 5%룰 지분공시.
   * 기존 DART 인증/호출 패턴 동일(crtfc_key). KRX 불요.
   *
   * API 키 미설정 시 DartApiUnavailableError throw(다른 수집 경로와 동일 graceful 계약).
   * status "013"(데이터 없음)이면 빈 list로 정상 반환.
   */
  async fetchMajorStockHoldings(
    corpCode: string,
  ): Promise<DartHoldingListResponse<DartMajorStockItem>> {
    return this.fetchHoldingReport<DartMajorStockItem>('/majorstock.json', corpCode);
  }

  /**
   * 임원·주요주주 특정증권등 소유상황보고 조회 (elestock.json) — 내부자 매매.
   * 기존 DART 인증/호출 패턴 동일(crtfc_key). KRX 불요.
   *
   * API 키 미설정 시 DartApiUnavailableError throw. status "013"이면 빈 list 반환.
   */
  async fetchExecutiveStockHoldings(
    corpCode: string,
  ): Promise<DartHoldingListResponse<DartExecutiveStockItem>> {
    return this.fetchHoldingReport<DartExecutiveStockItem>('/elestock.json', corpCode);
  }

  /** 지분공시 정형 엔드포인트(majorstock/elestock) 공통 호출. */
  private async fetchHoldingReport<T>(
    path: string,
    corpCode: string,
  ): Promise<DartHoldingListResponse<T>> {
    if (!this.apiKey) {
      throw new DartApiUnavailableError('DART_API_KEY가 설정되지 않았습니다');
    }

    try {
      const response = await this.httpClient.get(path, {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpCode,
        },
      });

      const data = response.data as DartHoldingListResponse<T>;

      // "013" = 조회된 데이터 없음 → 정상 흐름. 그 외 비정상 status만 경고.
      if (data.status !== '000' && data.status !== '013') {
        this.logger.warn(
          `지분공시 조회 비정상 응답: ${data.status} - ${data.message} (${path} ${corpCode})`,
        );
      }

      return { ...data, list: data.list ?? [] };
    } catch (error) {
      if (error instanceof DartApiUnavailableError) throw error;
      this.logger.error(`지분공시 조회 오류 (${path} ${corpCode})`, error as Error);
      throw error;
    }
  }

  /**
   * DART document.xml API로 원문 ZIP 다운로드
   * URL: GET https://opendart.fss.or.kr/api/document.xml?crtfc_key=KEY&rcept_no=RCPNO
   * 응답: application/zip (binary)
   *
   * API 키 미설정(DART_API_KEY 빈 값) 또는 오프라인 환경에서는
   * DartApiUnavailableError를 throw한다.
   */
  async downloadDocument(rcpNo: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new DartApiUnavailableError('DART_API_KEY가 설정되지 않았습니다');
    }

    const response = await this.httpClient.get('/document.xml', {
      params: {
        crtfc_key: this.apiKey,
        rcept_no: rcpNo,
      },
      responseType: 'arraybuffer',
    });

    const buf = Buffer.from(response.data);

    // DART는 ZIP을 application/x-msdownload 등 다양한 content-type으로 내려준다.
    // content-type 대신 ZIP 매직바이트(PK\x03\x04)로 판별하고,
    // 오류 시엔 XML(<result><status>...)이 오므로 그 메시지를 노출한다.
    const isZip =
      buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // 'PK'
    if (response.status !== 200 || !isZip) {
      const head = buf.toString('utf-8', 0, 400);
      const statusMatch = head.match(/<status>(\d+)<\/status>/);
      const msgMatch = head.match(/<message>([^<]*)<\/message>/);
      throw new Error(
        `DART document.xml 응답이 ZIP이 아님: httpStatus=${response.status}` +
          (statusMatch ? `, dartStatus=${statusMatch[1]}` : '') +
          (msgMatch ? `, message=${msgMatch[1]}` : ''),
      );
    }

    return buf;
  }

  /**
   * ZIP Buffer에서 본문 HTML/XML 파일을 추출한다.
   * adm-zip 사용.
   *
   * 추출 우선순위:
   *   1. 파일명이 {rcpNo}.xml 또는 {rcpNo}.html 인 파일
   *   2. 확장자 .xml 중 가장 파일 크기가 큰 파일
   *   3. 확장자 .html/.htm 중 가장 파일 크기가 큰 파일
   *   4. 위 모두 없으면 첫 번째 파일 (이름순 정렬)
   *
   * ZIP 내 파일이 없거나 html/xml 모두 없으면 빈 객체 반환.
   */
  async extractDocumentFromZip(
    zipBuffer: Buffer,
    rcpNo?: string,
  ): Promise<{ html?: string; xml?: string }> {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    if (entries.length === 0) {
      return {};
    }

    // rcpNo 기준 정확 매칭 우선
    if (rcpNo) {
      const exactXml = entries.find(
        (e) => e.entryName.toLowerCase() === `${rcpNo}.xml`,
      );
      const exactHtml = entries.find(
        (e) =>
          e.entryName.toLowerCase() === `${rcpNo}.html` ||
          e.entryName.toLowerCase() === `${rcpNo}.htm`,
      );
      if (exactXml || exactHtml) {
        return {
          xml: exactXml ? exactXml.getData().toString('utf-8') : undefined,
          html: exactHtml ? exactHtml.getData().toString('utf-8') : undefined,
        };
      }
    }

    // 확장자별 분류
    const xmlEntries = entries.filter((e) =>
      e.entryName.toLowerCase().endsWith('.xml'),
    );
    const htmlEntries = entries.filter(
      (e) =>
        e.entryName.toLowerCase().endsWith('.html') ||
        e.entryName.toLowerCase().endsWith('.htm'),
    );

    // 크기가 가장 큰 XML 파일 우선
    const bestXml =
      xmlEntries.length > 0
        ? xmlEntries.reduce((a, b) =>
            a.getData().length >= b.getData().length ? a : b,
          )
        : null;

    // 크기가 가장 큰 HTML 파일 우선
    const bestHtml =
      htmlEntries.length > 0
        ? htmlEntries.reduce((a, b) =>
            a.getData().length >= b.getData().length ? a : b,
          )
        : null;

    if (!bestXml && !bestHtml) {
      // 첫 번째 파일 fallback
      const first = entries.sort((a, b) =>
        a.entryName.localeCompare(b.entryName),
      )[0];
      const content = first.getData().toString('utf-8');
      return { xml: content };
    }

    return {
      xml: bestXml ? bestXml.getData().toString('utf-8') : undefined,
      html: bestHtml ? bestHtml.getData().toString('utf-8') : undefined,
    };
  }

  /**
   * 보고서명으로 공시 유형 분류 (DART 공식 체계 기반 7분류)
   */
  classifyDisclosureType(reportName: string): string {
    const name = reportName;

    // 정기공시 (A) - 정기적으로 제출하는 재무 보고서
    if (/사업보고서|반기보고서|분기보고서/.test(name)) {
      return 'REGULAR';
    }

    // 주요사항보고 (B) - 기업의 중요한 경영 변동사항
    if (
      /주요사항보고|자산양수도|영업양수도|합병|분할|해산사유|주식교환|주식이전/.test(name)
    ) {
      return 'MATERIAL';
    }

    // 발행공시 (C) - 증권 발행 관련
    if (
      /증권신고서|투자설명서|증권발행실적|소액공모|채권발행/.test(name)
    ) {
      return 'ISSUANCE';
    }

    // 지분공시 (D) - 지분 변동 관련
    if (
      /대량보유|소유상황|공개매수|의결권대리행사|주식등의/.test(name)
    ) {
      return 'EQUITY';
    }

    // 감사공시 (F) - 외부감사 및 감사 관련
    if (
      /감사보고서|외부감사|내부회계|회계감사/.test(name)
    ) {
      return 'AUDIT';
    }

    // 거래소공시 (I) - 한국거래소 관련 공시
    if (
      /거래소|상장폐지|거래정지|투자주의|시장조치|불성실공시|조회공시/.test(name)
    ) {
      return 'EXCHANGE';
    }

    // 기타공시 - 위에 해당하지 않는 모든 공시 (E, G, H, J 등)
    return 'OTHER';
  }
}
