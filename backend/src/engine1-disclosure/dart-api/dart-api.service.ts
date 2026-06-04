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
