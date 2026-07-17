import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import * as AdmZip from 'adm-zip';
import { DISCLOSURE_TYPE_IDS } from '../disclosures/constants/disclosure-types.constant';
import { formatKstDateCompact } from '../../common/time/kst';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DART API 키 미설정 또는 오프라인 환경에서 downloadDocument 호출 시 throw되는 에러
 */
export class DartApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DartApiUnavailableError';
  }
}

/**
 * DAR-445: 일일 쿼터 예약분 보호로 ★벌크(문서fetch·백필·재무) 호출이 사전 차단될 때 throw.
 *
 * ★F1 근본수정: DART 무료키 일일한도(20,000콜)는 list·document·financials 가 공유한다.
 *   문서 파싱 드레인(분당 최대 200 fetch)이 한도를 먼저 전부 태우면, 그 뒤 ★저렴한
 *   라이브 목록수집(오늘치 list, 수십 콜)까지 020 을 맞아 신규 공시 유입이 굶는다
 *   (관측: prod 공시 6/19 정체, documents 7,200건 전부 미파싱).
 *   → 일일 예산에서 LIVE_RESERVE 를 라이브 목록수집 전용으로 남기고, 벌크 호출은
 *     예산이 예약분에 닿으면 이 에러로 사전 중단한다(HTTP 미발생 = 쿼터 비소모).
 *
 * message 에 'dartStatus=020' 마커를 포함해 기존 classifyFetchError 가 QUOTA 로 분류하게 한다
 * (retryCount 비소모 → 멀쩡한 문서가 영구 SKIPPED 되지 않음).
 */
export class DartQuotaReservedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DartQuotaReservedError';
  }
}

/**
 * DAR-445 → 2026-07 라이브 파싱 기아 후속: DART 일일 콜 예산(KST 자정 리셋) 3단 분할.
 * - DAILY_BUDGET: DART 무료키 한도(20,000) 아래 보수 상한(시계 오차·키 공유 마진).
 * - LIVE_RESERVE: ★라이브 목록수집(오늘치 공시 list) 전용 예약분. 최우선 — 아무도 침범 못 함.
 *   라이브 list 1회 ≈ 수십 콜 × (10분 카덴스 ~60회/일) ≈ 1,200 콜 → 2,000 예약이면 충분.
 * - LIVE_PARSE_RESERVE: ★라이브(비백필) 문서 fetch 전용 예약분(신설).
 *   ★근본원인: DAR-445 는 라이브 '목록 수집'만 보호했고 문서 fetch 는 전부 벌크로 분류돼
 *     야간 벌크 소비(이벤트 백필 03:00·지분 03:30·재무 등)가 자정 리셋 직후 벌크 상한을
 *     소진하면 낮의 라이브 공시 문서 fetch 까지 매일 차단됐다(prod 물증: 성공 추출
 *     extractedAt 전부 KST 00:00~04:00 → 라이브 이벤트 추출 0 → 매수 신호 0).
 *   일 500~600건 라이브 공시 + 재시도 여유 → 3,000 예약.
 * - LIVE_PARSE_CEILING = DAILY_BUDGET - LIVE_RESERVE: 라이브 문서 fetch 누적 상한(17,000).
 * - BULK_CEILING = LIVE_PARSE_CEILING - LIVE_PARSE_RESERVE: 벌크(문서/백필/재무) 누적 상한(14,000).
 */
const DART_DAILY_BUDGET = 19_000;
const DART_LIVE_RESERVE = 2_000;
const DART_LIVE_PARSE_RESERVE = 3_000;
const DART_LIVE_PARSE_CEILING = DART_DAILY_BUDGET - DART_LIVE_RESERVE;
const DART_BULK_CEILING = DART_LIVE_PARSE_CEILING - DART_LIVE_PARSE_RESERVE;

/**
 * W5 리얼타임성 ④: 라이브 목록수집 예약분(LIVE_RESERVE) 소진 임계 알람.
 * 예약분 잔여(= DAILY_BUDGET - callsToday, 17,000 초과분부터 예약분 잠식)가 임계(20%)
 * 이하로 떨어지면 OPS_ALERT 를 1회/일 발행한다 — 과거 2회 기아 장애(6/24·7/15)의 증상이
 * '조용한 알림 침묵'이라, 예약분이 실제로 잠식되기 시작하는 시점을 능동 표면화한다.
 * 임계 콜수: LIVE_RESERVE × 20% = 400콜 잔여 시점(callsToday ≥ 18,600).
 */
const DART_LIVE_RESERVE_ALERT_RATIO = 0.2;
const DART_LIVE_RESERVE_ALERT_REMAINING = Math.floor(
  DART_LIVE_RESERVE * DART_LIVE_RESERVE_ALERT_RATIO,
); // 400

/**
 * DAR-532: 쿼터 소비 상태 DB 영속화 스로틀 — N콜마다 최대 1회만 flush 해 핫패스 DB 쓰기를
 * 최소화한다(실제 020 관측 시엔 스로틀 무시하고 즉시 영속). 재기동 시 최대 이 스텝만큼만
 * 저평가(항상 실소비 이하 → 예약분을 더 보호하는 안전 방향)될 수 있다.
 */
const DART_QUOTA_PERSIST_STEP = 200;

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
export class DartApiService implements OnModuleInit {
  private readonly logger = new Logger(DartApiService.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;

  /** DAR-445: 일일 콜 예산 상태(KST 자정 리셋). 프로세스 메모리 — 단, DAR-532 로 당일 소비/소진을
   *  DB(dart_quota_state)에 영속화해 재기동 후 onModuleInit 에서 복원한다(재시작 0 리셋 결함 차단). */
  private callDayKey = '';
  private callsToday = 0;
  /** 실제 DART 020/021(쿼터 소진) 을 관측한 KST 일자. 그 날은 벌크 호출을 하드스톱. */
  private quotaExhaustedDay = '';
  /** W5 ④: 라이브 예약분 소진 임계 OPS_ALERT 를 발행한 KST 일자(1회/일 dedupe). */
  private reserveAlertDay = '';
  /** DAR-532: 마지막으로 DB 에 flush 한 callsToday(스로틀 기준). -1 = 미영속(당일 첫 flush 전). */
  private lastPersistedCalls = -1;

  constructor(
    private readonly configService: ConfigService,
    /**
     * @Optional: W5 ④ 라이브 예약분 소진 임계 알람용 producer.
     * 미주입 환경(단위 테스트·큐 비활성)에서도 쿼터 가드 본업은 그대로 동작한다.
     */
    @Optional()
    private readonly notificationProducer?: NotificationProducerService,
    /**
     * @Optional: DAR-532 쿼터 상태 영속화(재기동 복원)용 Prisma. 미주입 시(단위 테스트 등)엔
     * in-memory 만으로 기존 가드가 동작하고 영속화·복원은 no-op 으로 자연 강등된다.
     */
    @Optional()
    private readonly prisma?: PrismaService,
  ) {
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
   * DAR-532: 재기동 직후 당일(KST) 쿼터 상태를 DB 에서 복원한다(핫패스 진입 전 1회).
   *
   * ★근본원인: DAR-445 3단 예산 상한은 in-memory callsToday/quotaExhaustedDay 에만 걸려 있어
   *   프로세스 재기동 시 0/'' 로 리셋됐다 — 상한이 '한 프로세스 소비'만 묶고 '당일 실 DART 쿼터'는
   *   못 묶어, 야간 다중 재기동이 매번 신규 벌크 예산(14,000)을 다시 열어 라이브 예약분까지 소진했다
   *   (2026-07-17 08:29 재기동 첫 콜 020). 복원으로 상한이 '당일 실소비'를 묶게 만든다.
   *
   * 복원값은 항상 실소비 이하(스로틀 저평가)라 예약분을 더 보호하는 단조·안전 방향이다.
   * prisma 미주입/조회 실패는 무시(in-memory 기본값 유지) — 발송/수집 본업을 막지 않는다.
   */
  async onModuleInit(): Promise<void> {
    if (!this.prisma) return;
    const day = this.currentDayKey();
    try {
      const row = await this.prisma.dartQuotaState.findUnique({ where: { day } });
      if (!row) return;
      this.callDayKey = day;
      this.callsToday = Math.max(this.callsToday, row.callsToday ?? 0);
      this.lastPersistedCalls = this.callsToday;
      if (row.quotaExhausted) {
        this.quotaExhaustedDay = day;
        this.logger.warn(
          `DART 쿼터 상태 복원(재기동): ${day} callsToday=${this.callsToday} quotaExhausted=true — ` +
            `벌크 하드스톱 재적용(자정 KST 리셋까지 라이브 예약분 보호).`,
        );
      } else {
        this.logger.log(
          `DART 쿼터 상태 복원(재기동): ${day} callsToday=${this.callsToday}(상한 대비 실소비 반영).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `DART 쿼터 상태 복원 실패(무시·in-memory 기본값 유지): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * DAR-532: 당일 쿼터 상태를 dart_quota_state 에 upsert(1행/KST일). fire-and-forget —
   * 실패해도 throw 없이 삼켜 핫패스를 막지 않는다. `force=true`(실제 020 관측)면 스로틀 무시.
   * quotaExhausted 는 true 로만 승격(false 로 되돌리지 않음) — 관측된 하드스톱을 후퇴시키지 않는다.
   */
  private async persistQuotaState(force: boolean): Promise<void> {
    if (!this.prisma) return;
    if (!force && this.callsToday - this.lastPersistedCalls < DART_QUOTA_PERSIST_STEP) return;
    const day = this.callDayKey || this.currentDayKey();
    const callsToday = this.callsToday;
    const exhausted = this.quotaExhaustedDay === day;
    this.lastPersistedCalls = callsToday;
    try {
      await this.prisma.dartQuotaState.upsert({
        where: { day },
        create: { day, callsToday, quotaExhausted: exhausted },
        update: {
          callsToday,
          ...(exhausted ? { quotaExhausted: true } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `DART 쿼터 상태 영속화 실패(무시): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 현재 KST 일자(YYYYMMDD). 테스트 결정론을 위해 분리(spyOn 대체 가능). */
  private currentDayKey(): string {
    return formatKstDateCompact(new Date());
  }

  /** KST 일자가 바뀌면 카운터·하드스톱을 리셋(자정 자동 재개). */
  private rollDayIfNeeded(): void {
    const day = this.currentDayKey();
    if (day !== this.callDayKey) {
      if (this.callDayKey) {
        this.logger.log(
          `DART 일일 콜 예산 리셋: ${this.callDayKey}(${this.callsToday}콜) → ${day}`,
        );
      }
      this.callDayKey = day;
      this.callsToday = 0;
      // DAR-532: 새 KST일 → 영속 스로틀 기준도 리셋(새 날 첫 flush 부터 다시 적재).
      this.lastPersistedCalls = -1;
    }
  }

  /** 1콜 소비 기록(모든 DART API 호출 직전 호출). */
  private recordCall(): void {
    this.rollDayIfNeeded();
    this.callsToday += 1;
    this.maybeAlertLiveReserveLow();
    // DAR-532: 스로틀된 상태 영속화(N콜마다 1회) — 재기동에도 당일 실소비를 잃지 않는다.
    void this.persistQuotaState(false);
  }

  /**
   * W5 ④: 라이브 목록수집 예약분 잔여가 임계(20% = 400콜) 이하로 떨어지면 OPS_ALERT
   * 를 1회/일 발행한다(기존 enqueueOpsAlert 재사용 — 실패해도 throw 없음, fire-and-forget).
   * 과거 기아 장애(6/24·7/15)는 증상이 '조용한 알림 침묵'이라 소진을 늦게 발견했다 —
   * 예약분이 실제 잠식되는 시점(callsToday ≥ 18,600)을 능동 표면화하는 이중 방어다.
   */
  private maybeAlertLiveReserveLow(): void {
    const remaining = DART_DAILY_BUDGET - this.callsToday;
    if (remaining > DART_LIVE_RESERVE_ALERT_REMAINING) return;
    if (this.reserveAlertDay === this.callDayKey) return; // 1회/일
    this.reserveAlertDay = this.callDayKey;
    this.logger.warn(
      `DART 라이브 목록수집 예약분 임계 도달: 잔여 ${remaining}콜(임계 ${DART_LIVE_RESERVE_ALERT_REMAINING}) — ` +
        `델타/풀스캔 라이브 수집이 곧 굶을 수 있음(당일 ${this.callDayKey})`,
    );
    // enqueueOpsAlert 는 내부에서 절대 throw 하지 않는다(비임계 경로) — fire-and-forget.
    void this.notificationProducer?.enqueueOpsAlert(
      'WARNING',
      'dart-quota-live-reserve',
      `DART 라이브 목록수집 예약분 잔여 ${remaining}콜(임계 ${DART_LIVE_RESERVE_ALERT_REMAINING}콜 이하) — ` +
        `일일 예산 ${DART_DAILY_BUDGET}콜 중 ${this.callsToday}콜 소비. 라이브 공시 수집이 곧 중단될 수 있습니다.`,
      {
        // 반복 발화 이벤트 — 일자 버킷 dedupeKey 로 하루 1건 멱등(재기동 재발행도 차단).
        dedupeKey: `dart-quota-live-reserve:${this.callDayKey}`,
        data: {
          day: this.callDayKey,
          callsToday: this.callsToday,
          remaining,
          dailyBudget: DART_DAILY_BUDGET,
          liveReserve: DART_LIVE_RESERVE,
        },
      },
    );
  }

  /** DART 020/021(일일 쿼터·조회회사수 초과) 관측 시 그 날 벌크 호출을 하드스톱. */
  private markQuotaExhausted(): void {
    this.rollDayIfNeeded();
    if (this.quotaExhaustedDay !== this.callDayKey) {
      this.quotaExhaustedDay = this.callDayKey;
      this.logger.warn(
        `DART 일일 쿼터 소진 관측(${this.callDayKey}) — 벌크(문서/백필/재무) 호출 하드스톱. ` +
          `라이브 목록수집만 시도, 자정(KST) 리셋 후 자동 재개.`,
      );
      // DAR-532: 소진 관측을 즉시 영속화(스로틀 무시) — 재기동해도 하드스톱이 유지된다.
      void this.persistQuotaState(true);
    }
  }

  /**
   * 벌크(문서fetch·백필·재무) 호출을 지금 시도해도 되는가(DAR-445).
   * false 면 라이브 목록수집용 예약분 보호 — 벌크는 사전 차단(쿼터 비소모).
   *  - 그 날 020 관측 → 하드스톱.
   *  - 또는 누적 콜이 BULK_CEILING(=예산-예약) 도달.
   */
  private canSpendBulk(): boolean {
    this.rollDayIfNeeded();
    if (this.quotaExhaustedDay === this.callDayKey) return false;
    return this.callsToday < DART_BULK_CEILING;
  }

  /**
   * 라이브(비백필) 문서 fetch 를 지금 시도해도 되는가(라이브 파싱 기아 후속).
   * 벌크 상한(BULK_CEILING)보다 높은 LIVE_PARSE_CEILING 까지 허용해, 야간 벌크가 벌크 상한을
   * 소진해도 낮의 라이브 공시 문서 fetch 는 예약분(LIVE_PARSE_RESERVE)으로 계속 진행된다.
   *  - 그 날 020/021 관측 → 하드스톱(실쿼터 소진은 라이브도 못 살림).
   *  - 또는 누적 콜이 LIVE_PARSE_CEILING(=예산-목록수집 예약) 도달.
   */
  private canSpendLiveParse(): boolean {
    this.rollDayIfNeeded();
    if (this.quotaExhaustedDay === this.callDayKey) return false;
    return this.callsToday < DART_LIVE_PARSE_CEILING;
  }

  /** DAR-445: 쿼터 예산 현황(관측·디버깅용). */
  getQuotaBudgetStatus(): {
    day: string;
    callsToday: number;
    dailyBudget: number;
    liveReserve: number;
    bulkCeiling: number;
    bulkAllowed: boolean;
    liveParseCeiling: number;
    liveParseAllowed: boolean;
    quotaExhausted: boolean;
  } {
    this.rollDayIfNeeded();
    return {
      day: this.callDayKey,
      callsToday: this.callsToday,
      dailyBudget: DART_DAILY_BUDGET,
      liveReserve: DART_LIVE_RESERVE,
      bulkCeiling: DART_BULK_CEILING,
      bulkAllowed: this.canSpendBulk(),
      liveParseCeiling: DART_LIVE_PARSE_CEILING,
      liveParseAllowed: this.canSpendLiveParse(),
      quotaExhausted: this.quotaExhaustedDay === this.callDayKey,
    };
  }

  /**
   * DART 공시 목록 조회
   */
  async getDisclosureList(
    params: {
      bgn_de: string;
      end_de: string;
      page_no?: number;
      page_count?: number;
      /** 정렬 기준(date=접수일자). 미지정 시 DART 기본(date). */
      sort?: string;
      /** 정렬 방향(desc=최신순). 미지정 시 DART 기본. */
      sort_mth?: 'asc' | 'desc';
    },
    /**
     * DAR-445: bulk=true(과거 백필 list)는 라이브 수집 예약분에 닿으면 사전 차단된다
     *   — HTTP 미발생, 합성 020 응답을 반환해 호출자(getAllDisclosuresWithMeta)의
     *     기존 quotaExceeded 경로가 깔끔히 멈춘다. bulk=false(라이브 오늘치 list, 기본)는
     *     예약분으로 보호되어 절대 사전 차단되지 않는다.
     */
    opts: { bulk?: boolean } = {},
  ): Promise<DartListResponse> {
    // DAR-445: 벌크 list 는 예약분 보호 — 예산 소진 시 합성 020 으로 즉시 종료(쿼터 비소모).
    if (opts.bulk && !this.canSpendBulk()) {
      return {
        status: '020',
        message: '일일 쿼터 예약분 보호(벌크 list 사전 중단) — 라이브 수집 우선',
        page_no: params.page_no ?? 1,
        page_count: params.page_count ?? 100,
        total_count: 0,
        total_page: 0,
        list: [],
      };
    }

    try {
      this.recordCall();
      const response = await this.httpClient.get('/list.json', {
        params: {
          crtfc_key: this.apiKey,
          ...params,
          page_count: params.page_count || 100,
        },
      });

      // DAR-445: 실제 020/021 관측 시 그 날 벌크 하드스톱(라이브는 계속 시도).
      const status = (response.data as DartListResponse)?.status;
      if (status === '020' || status === '021') {
        this.markQuotaExhausted();
      }

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
   * DART 공시 목록 전체 조회 — 쿼터 인지(quota-aware) 변형 (DAR-396).
   *
   * getAllDisclosures 와 동일하게 전 페이지를 모으되, ★종료 사유를 호출자에게 노출한다:
   *  - status "020"(일일 요청한도 20,000건 초과)·"021"(조회 가능 회사수 초과) → quotaExceeded=true.
   *    일일 쿼터 소진 신호다. 이 경우 누적된 (그때까지 받은) 페이지만 반환하고 페이지네이션을 멈춘다.
   *  - 그 외 비정상 status(예: 800/900대) → abnormalStatus 로 노출(throw 금지, 누적분 반환).
   *  - "013"(데이터 없음)·정상 완주 → quotaExceeded=false, abnormalStatus=null.
   *
   * ★정렬을 date/desc(최신순)로 고정한다. 과거 확장 백필 드레이너는 쿼터가 페이지네이션을
   *   중도 끊었을 때 '받은 페이지 = 윈도의 최신 구간'임을 전제로 안전 재개하므로, 정렬 방향을
   *   명시해 그 전제를 보장한다(미지정 시 DART 기본도 date/desc 이나 의존하지 않고 고정).
   *
   * 기존 getAllDisclosures(라이브 수집 경로)는 변경하지 않는다 — 본 메서드는 백필 전용.
   */
  async getAllDisclosuresWithMeta(
    bgnDe: string,
    endDe: string,
  ): Promise<{
    items: DartDisclosureItem[];
    /** 일일 쿼터(020/021) 소진으로 페이지네이션이 중단되었는가. true면 백오프 신호. */
    quotaExceeded: boolean;
    /** 쿼터 외 비정상 종료 status(있으면). 정상/데이터없음/쿼터면 null. */
    abnormalStatus: string | null;
  }> {
    const allItems: DartDisclosureItem[] = [];
    let pageNo = 1;
    const pageCount = 100;
    let quotaExceeded = false;
    let abnormalStatus: string | null = null;

    while (true) {
      const response = await this.getDisclosureList(
        {
          bgn_de: bgnDe,
          end_de: endDe,
          page_no: pageNo,
          page_count: pageCount,
          sort: 'date',
          sort_mth: 'desc',
        },
        // DAR-445: 과거 백필 list 는 벌크 — 라이브 수집 예약분에 닿으면 사전 중단.
        { bulk: true },
      );

      // "000" = 정상, "013" = 조회된 데이터 없음(정상 종료).
      if (response.status === '013') {
        break;
      }

      if (response.status !== '000') {
        // 020/021 = 일일 쿼터·조회회사수 초과 → 백오프 신호.
        if (response.status === '020' || response.status === '021') {
          quotaExceeded = true;
          this.logger.warn(
            `DART list 쿼터 소진 감지(status=${response.status}) — ${bgnDe}~${endDe} ` +
              `page ${pageNo}까지 누적(${allItems.length}건) 후 중단. 다음 리셋 후 재개.`,
          );
        } else {
          abnormalStatus = response.status;
          this.logger.warn(
            `DART list 비정상 응답: ${response.status} - ${response.message} (${bgnDe}~${endDe})`,
          );
        }
        break;
      }

      allItems.push(...response.list);

      if (pageNo >= response.total_page) {
        break;
      }

      pageNo++;
    }

    return { items: allItems, quotaExceeded, abnormalStatus };
  }

  /**
   * DART 기업개황 조회
   */
  async getCompanyOverview(corpCode: string): Promise<DartCompanyOverview | null> {
    // DAR-445: 기업개황은 벌크 — 예약분 보호. 블록 시 null(이 메서드의 실패=null 계약과 일치).
    if (!this.canSpendBulk()) {
      this.logger.debug(
        `기업개황 조회 예약분 보호로 건너뜀(벌크 중단, 라이브 수집 우선): ${corpCode}`,
      );
      return null;
    }

    try {
      this.recordCall();
      const response = await this.httpClient.get('/company.json', {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpCode,
        },
      });

      // DAR-445: 020/021 관측 시 그 날 벌크 하드스톱.
      if (response.data?.status === '020' || response.data?.status === '021') {
        this.markQuotaExhausted();
      }

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

    // DAR-445: 재무제표 수집은 벌크 — 라이브 목록수집 예약분 보호.
    if (!this.canSpendBulk()) {
      throw new DartQuotaReservedError(
        `DART 재무제표 예약분 보호(벌크 중단): dartStatus=020, 요청 제한`,
      );
    }

    const fsDiv = params.fsDiv ?? 'CFS';
    try {
      this.recordCall();
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

      // DAR-445: 020/021 관측 시 그 날 벌크 하드스톱.
      if (data.status === '020' || data.status === '021') {
        this.markQuotaExhausted();
      }

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

    // DAR-445: 지분공시 수집은 벌크 — 라이브 목록수집 예약분 보호.
    if (!this.canSpendBulk()) {
      throw new DartQuotaReservedError(
        `DART 지분공시 예약분 보호(벌크 중단): dartStatus=020, 요청 제한 (${path})`,
      );
    }

    try {
      this.recordCall();
      const response = await this.httpClient.get(path, {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpCode,
        },
      });

      const data = response.data as DartHoldingListResponse<T>;

      // DAR-445: 020/021 관측 시 그 날 벌크 하드스톱.
      if (data.status === '020' || data.status === '021') {
        this.markQuotaExhausted();
      }

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
   *
   * @param opts.priority 쿼터 분류 — 'live'(비백필 라이브 공시, LIVE_PARSE_CEILING 게이트) |
   *   'bulk'(백필·기본값 보수, BULK_CEILING 게이트). 라이브 파싱 기아 후속: 야간 벌크가
   *   벌크 상한을 소진해도 라이브 문서 fetch 는 예약분(LIVE_PARSE_RESERVE)으로 계속 진행.
   */
  async downloadDocument(
    rcpNo: string,
    opts: { priority?: 'live' | 'bulk' } = {},
  ): Promise<Buffer> {
    if (!this.apiKey) {
      throw new DartApiUnavailableError('DART_API_KEY가 설정되지 않았습니다');
    }

    // DAR-445: 문서 fetch 는 일일 쿼터의 최대 소비자다. 상한에 닿으면 사전 차단해
    //   라이브 목록수집 몫을 남긴다(HTTP 미발생 = 쿼터 비소모). message 의 dartStatus=020
    //   마커로 classifyFetchError 가 QUOTA 로 분류 → retryCount 비소모(영구 SKIPPED 방지).
    //   ★마커 유지 필수: disclosure-documents 의 QUOTA 분류가 이 문자열에 의존한다.
    const priority = opts.priority ?? 'bulk';
    const allowed =
      priority === 'live' ? this.canSpendLiveParse() : this.canSpendBulk();
    if (!allowed) {
      const ceiling =
        priority === 'live' ? DART_LIVE_PARSE_CEILING : DART_BULK_CEILING;
      throw new DartQuotaReservedError(
        `DART 문서 fetch 예약분 보호(${priority} 중단, 라이브 수집 우선): dartStatus=020, ` +
          `요청 제한(callsToday=${this.callsToday}/${ceiling})`,
      );
    }

    this.recordCall();
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
      // DAR-445: 실제 020/021 관측 시 그 날 벌크 하드스톱.
      if (statusMatch && (statusMatch[1] === '020' || statusMatch[1] === '021')) {
        this.markQuotaExhausted();
      }
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
