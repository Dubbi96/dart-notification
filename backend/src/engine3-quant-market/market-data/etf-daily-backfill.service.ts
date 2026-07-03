import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KisApiService } from './kis-api.service';
import { EtfDailyRawStoreService } from '../../common/storage/etf-daily-raw-store.service';
import { ETF_UNIVERSE_CODES, etfByCode } from './etf-universe';
import { isValidDailyOhlc } from './daily-price-sanity';
import { isTradingDay } from '../../common/time/market-calendar';
import { formatKstDateCompact } from '../../common/time/kst';

/**
 * EtfDailyBackfillService — ETF 과거 일봉 백필 (DAR-490 [견고화 W1·P11]).
 *
 * P10(DAR-484)이 EtfDailyPrice 모델 + KIS 소스 + 일일 증분(19:10 크론)을 세웠다. 백테스트 검증(P16)에는
 * 3년+, 듀얼모멘텀 12개월 모멘텀(P12)에는 최소 13개월 이력이 필요하다. 이 서비스는 KIS 기간별시세
 * (fetchDailyPricesRaw, FHKST03010100)를 날짜 구간 페이지네이션으로 반복 호출해 유니버스 과거 일봉을
 * '가능한 최장'(목표 3년+)으로 적재한다.
 *
 *   - **페이지네이션**: KIS 는 한 호출당 최대 ~100영업일을 최신→과거 순으로 준다. endYmd 부터 과거로
 *     chunkDays(달력일) 창을 물려가며 호출한다(창당 ~100행 이내). 유니버스 상장월 이전은 빈 창이 되므로
 *     연속 빈 창(maxEmptyWindows)에 도달하면 그 종목은 종료 → 콜 수를 종목당 ~12콜 수준으로 억제.
 *   - **S3 원본 보관**: 창별 KIS 원본 응답(JSON)을 EtfDailyRawStoreService 로 콜드 보관(결정적 키,
 *     DAR-401 원칙). 보관은 best-effort — 실패해도 DB 적재는 진행(관측 카운터로 표면화).
 *   - **멱등**: EtfDailyPrice.createMany(skipDuplicates)·(etfCode,tradeDate) 유니크. isValidDailyOhlc 로
 *     손상행 배제(P10 검증 로직 재사용). 재실행 안전(EOD 종가는 마감 후 불변).
 *   - **커버리지 리포트**: 백필 후 종목별 시작일·행수·갭(누락 거래일 추정)을 산출 → P16 게이트 근거.
 *
 * 실행: 수동 러너(etf-daily-backfill.manual.ts) — 상시 크론 금지(일일 증분은 P10 크론 담당).
 *
 * AI 금지영역: 순수 HTTP/적재/집계. 점수·체결·하드룰과 무관(읽기 전용 시세·데이터층 전용).
 *   측정 트랙 매매 행동 무변경(M10 클록 안전) — 과거 데이터 적재이므로 룩어헤드 이슈 없음(신호 생성 아님).
 */

/** 백필 하한 기본값(YYYYMMDD) — 이보다 과거로는 내려가지 않는다(런어웨이 방지·안전 바닥). */
export const ETF_BACKFILL_MIN_START_DEFAULT = '20100101';
/** 창(window) 크기 기본값(달력일) — ~100행 KIS 한도 아래 여유(달력 100일 ≈ 거래일 ~70). */
export const ETF_BACKFILL_CHUNK_DAYS_DEFAULT = 100;
/** 종목당 최대 창 수(콜 상한 — 40창 × 4종 = 최대 160콜 상한. 빈 창 조기종료가 대부분 먼저 걸린다). */
export const ETF_BACKFILL_MAX_WINDOWS_DEFAULT = 40;
/** 연속 빈 창 임계 — 이만큼 연속 빈 창이면 상장 이전 도달로 보고 그 종목 종료. */
export const ETF_BACKFILL_MAX_EMPTY_WINDOWS_DEFAULT = 2;
/** 커버리지 갭 의심 임계(달력일) — 인접 거래일 간격이 이보다 크면 '누락 의심 홀'로 표기. */
export const ETF_COVERAGE_SUSPICIOUS_GAP_DAYS = 7;

/**
 * 알려진 상장월(YYYY-MM) — 상장 이전 구간 부재가 '정상'임을 커버리지 리포트에 정직 고지하기 위한 참조.
 * (etf-universe.ts 는 데이터 수집 대상 상수라 상장일을 두지 않는다 → 리포트 전용 주석 맵.)
 */
export const KNOWN_ETF_LISTINGS: Readonly<Record<string, string>> = {
  '360750': '2020-08', // TIGER 미국S&P500 — 2020-08 상장. 그 이전 일봉 부재는 정상(백테스트 표본 시작일).
};

/** 종목 1종의 백필 실행 결과(정직 카운터). */
export interface EtfDailyBackfillCodeResult {
  code: string;
  name: string;
  role: string;
  /** 실제 KIS 호출(창) 수 — 콜 수. */
  windowsFetched: number;
  /** 바 1행 이상 받은 창 수. */
  windowsWithData: number;
  /** 신규로 적재된 일봉 행 수(멱등 — 이미 있던 행 제외). */
  rowsSaved: number;
  /** OHLC 정합성 검사에서 거른 손상행 수. */
  invalidSkipped: number;
  /** S3 원본 보관 성공 창 수. */
  rawStored: number;
  /** S3 원본 보관 실패 창 수(best-effort — DB 적재는 진행). */
  rawFailed: number;
  /** 이번 실행에서 받은 가장 이른/늦은 거래일(YYYYMMDD). */
  earliest: string | null;
  latest: string | null;
}

/** 종목 1종의 커버리지(백필 후 DB 상태 요약 — P16 데이터 품질 근거). */
export interface EtfDailyCoverageEntry {
  code: string;
  name: string;
  role: string;
  /** DB 적재 행수. */
  rowCount: number;
  /** DB 최소/최대 거래일(YYYYMMDD). */
  startDate: string | null;
  endDate: string | null;
  /** [startDate,endDate] 추정 거래일수(주말·알려진 공휴일 제외). ★상한 추정: 과거 공휴일 캘린더 불완전 시 과대. */
  expectedTradingDays: number;
  /** expectedTradingDays − rowCount(상한 추정). 0 이면 홀 없음(추정), 클수록 누락 의심. */
  missingVsExpected: number;
  /** 인접 거래일 간 최대 달력일 간격(구조적 홀 탐지 — 캘린더 완전성 무관하게 견고). */
  maxGapCalendarDays: number;
  /** 임계(ETF_COVERAGE_SUSPICIOUS_GAP_DAYS) 초과 인접 간격 목록(누락 의심 홀). 최대 10개. */
  suspiciousGaps: Array<{ from: string; to: string; calendarDays: number }>;
  /** 상장월 등 정직 고지(상장 이전 부재는 정상). */
  note?: string;
}

/** 백필 1회 전체 결과. */
export interface EtfDailyBackfillResult {
  /** 실행 기준일(KST 오늘, YYYYMMDD). */
  asOf: string;
  /** 백필 하한(YYYYMMDD). */
  startFloor: string;
  /** 조회 종료일(YYYYMMDD). */
  endYmd: string;
  /** KIS 키 구성 여부 — false 면 적재 0(coverage 는 기존 DB 로 산출). */
  configured: boolean;
  perCode: EtfDailyBackfillCodeResult[];
  coverage: EtfDailyCoverageEntry[];
  totals: {
    rowsSaved: number;
    windowsFetched: number;
    rawStored: number;
    rawFailed: number;
    invalidSkipped: number;
  };
  message?: string;
}

@Injectable()
export class EtfDailyBackfillService {
  private readonly logger = new Logger(EtfDailyBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kis: KisApiService,
    private readonly rawStore: EtfDailyRawStoreService,
  ) {}

  /**
   * 유니버스 과거 일봉을 '가능한 최장'(목표 3년+)으로 백필한다.
   *
   * @param opts.codes           대상 코드(미지정 시 ETF_UNIVERSE_CODES).
   * @param opts.endYmd          조회 종료일(미지정 시 KST 오늘).
   * @param opts.minStartYmd     백필 하한(미지정 시 ETF_BACKFILL_MIN_START_DEFAULT).
   * @param opts.chunkDays       창 크기(달력일, 미지정 시 기본 100).
   * @param opts.maxWindows      종목당 최대 창 수(콜 상한, 미지정 시 40).
   * @param opts.maxEmptyWindows 연속 빈 창 조기종료 임계(미지정 시 2).
   * @param opts.etfDelayMs      창 호출 간 지연 ms(레이트리밋 스로틀, 기본 200).
   * @param opts.persistRaw      S3 원본 보관 여부(기본 true).
   * @param opts.now             기준 시각(KST '오늘' 산정, 테스트 주입).
   * @param opts.sleep           지연 주입(테스트용).
   */
  async backfill(
    opts: {
      codes?: readonly string[];
      endYmd?: string;
      minStartYmd?: string;
      chunkDays?: number;
      maxWindows?: number;
      maxEmptyWindows?: number;
      etfDelayMs?: number;
      persistRaw?: boolean;
      now?: Date;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ): Promise<EtfDailyBackfillResult> {
    const now = opts.now ?? new Date();
    const asOf = formatKstDateCompact(now);
    const endYmd = opts.endYmd ?? asOf;
    const startFloor = opts.minStartYmd ?? ETF_BACKFILL_MIN_START_DEFAULT;
    const chunkDays = opts.chunkDays ?? ETF_BACKFILL_CHUNK_DAYS_DEFAULT;
    const maxWindows = opts.maxWindows ?? ETF_BACKFILL_MAX_WINDOWS_DEFAULT;
    const maxEmptyWindows = opts.maxEmptyWindows ?? ETF_BACKFILL_MAX_EMPTY_WINDOWS_DEFAULT;
    const etfDelayMs = opts.etfDelayMs ?? 200;
    const persistRaw = opts.persistRaw ?? true;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const codes = opts.codes ?? ETF_UNIVERSE_CODES;

    const perCode: EtfDailyBackfillCodeResult[] = [];

    if (!this.kis.isConfigured) {
      this.logger.warn('[ETF백필] KIS 키 미설정 — 적재 0. 기존 DB 로 커버리지만 산출.');
      const coverage = await this.buildCoverage(codes);
      return {
        asOf,
        startFloor,
        endYmd,
        configured: false,
        perCode,
        coverage,
        totals: { rowsSaved: 0, windowsFetched: 0, rawStored: 0, rawFailed: 0, invalidSkipped: 0 },
        message: 'KIS 키 미설정 — 백필 스킵(.env 주입 후 재실행)',
      };
    }

    this.logger.log(
      `[ETF백필] 시작 종료일=${endYmd} 하한=${startFloor} 창=${chunkDays}일 유니버스=${codes.length}종 원본보관=${persistRaw}`,
    );

    for (const code of codes) {
      const entry = etfByCode(code);
      const cr: EtfDailyBackfillCodeResult = {
        code,
        name: entry?.name ?? code,
        role: entry?.role ?? 'UNKNOWN',
        windowsFetched: 0,
        windowsWithData: 0,
        rowsSaved: 0,
        invalidSkipped: 0,
        rawStored: 0,
        rawFailed: 0,
        earliest: null,
        latest: null,
      };

      let windowEnd = endYmd;
      let emptyStreak = 0;

      for (let w = 0; w < maxWindows; w++) {
        // 창 시작 = max(하한, 종료−(chunkDays−1)). chunkDays 일 폭(양끝 포함).
        const windowStart = maxYmd(startFloor, addDaysYmd(windowEnd, -(chunkDays - 1)));
        const { bars, raw } = await this.kis.fetchDailyPricesRaw(
          code,
          windowStart,
          windowEnd,
          now.getTime(),
        );
        cr.windowsFetched++;

        if (bars.length > 0) {
          cr.windowsWithData++;
          emptyStreak = 0;
          const first = bars[0].tradeDate;
          const last = bars[bars.length - 1].tradeDate;
          cr.earliest = cr.earliest ? minYmd(cr.earliest, first) : first;
          cr.latest = cr.latest ? maxYmd(cr.latest, last) : last;

          if (persistRaw && raw != null) {
            try {
              await this.rawStore.save(code, windowStart, windowEnd, raw);
              cr.rawStored++;
            } catch (e) {
              cr.rawFailed++;
              this.logger.warn(
                `[ETF백필] 원본 보관 실패 ${code} ${windowStart}-${windowEnd}: ${(e as Error).message}`,
              );
            }
          }

          const { saved, invalid } = await this.persistBars(code, bars);
          cr.rowsSaved += saved;
          cr.invalidSkipped += invalid;
          this.logger.log(
            `[ETF백필] ${code} 창 ${windowStart}~${windowEnd} 받음=${bars.length}행 신규=${saved} 손상제외=${invalid}`,
          );
        } else {
          emptyStreak++;
        }

        // 상장 이전 도달(연속 빈 창) 또는 하한 도달 → 그 종목 종료.
        if (emptyStreak >= maxEmptyWindows) break;
        if (windowStart <= startFloor) break;

        windowEnd = addDaysYmd(windowStart, -1);
        if (etfDelayMs > 0) await sleep(etfDelayMs);
      }

      this.logger.log(
        `[ETF백필] ${code} 완료 콜=${cr.windowsFetched} 신규적재=${cr.rowsSaved}행 구간=${cr.earliest ?? '-'}~${cr.latest ?? '-'} 원본=${cr.rawStored}/${cr.rawStored + cr.rawFailed}`,
      );
      perCode.push(cr);
    }

    const coverage = await this.buildCoverage(codes);
    const totals = perCode.reduce(
      (acc, c) => ({
        rowsSaved: acc.rowsSaved + c.rowsSaved,
        windowsFetched: acc.windowsFetched + c.windowsFetched,
        rawStored: acc.rawStored + c.rawStored,
        rawFailed: acc.rawFailed + c.rawFailed,
        invalidSkipped: acc.invalidSkipped + c.invalidSkipped,
      }),
      { rowsSaved: 0, windowsFetched: 0, rawStored: 0, rawFailed: 0, invalidSkipped: 0 },
    );

    this.logger.log(
      `[ETF백필] 전체 완료 총콜=${totals.windowsFetched} 총신규=${totals.rowsSaved}행 원본=${totals.rawStored} 손상제외=${totals.invalidSkipped}`,
    );

    return { asOf, startFloor, endYmd, configured: true, perCode, coverage, totals };
  }

  /**
   * 커버리지 리포트 산출(적재 없이 현재 DB 상태만) — 재실행 없이 품질 재판단용.
   * 종목별 시작일·행수·갭(누락 거래일 추정)·의심 홀을 요약한다.
   */
  async coverageReport(codes: readonly string[] = ETF_UNIVERSE_CODES): Promise<EtfDailyCoverageEntry[]> {
    return this.buildCoverage(codes);
  }

  /**
   * ETF 일봉을 EtfDailyPrice 에 멱등 적재(P10 EtfDailyPriceCollector.persistBars 와 동일 규약).
   * OHLC 물리 정합성(daily-price-sanity)을 행 단위 검사해 손상행을 배제하고, (etfCode,tradeDate)
   * 충돌은 createMany skipDuplicates 로 누락일만 신규 삽입. 반환=신규 삽입 행수·손상수.
   */
  private async persistBars(
    etfCode: string,
    bars: Array<{
      tradeDate: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      tradingValue: number;
    }>,
  ): Promise<{ saved: number; invalid: number }> {
    const data: import('@prisma/client').Prisma.EtfDailyPriceCreateManyInput[] = [];
    let invalid = 0;
    for (const b of bars) {
      if (!/^\d{8}$/.test(b.tradeDate)) {
        invalid++;
        continue;
      }
      const ohlc = {
        openPrice: Math.round(b.open),
        highPrice: Math.round(b.high),
        lowPrice: Math.round(b.low),
        closePrice: Math.round(b.close),
      };
      if (!isValidDailyOhlc(ohlc)) {
        invalid++;
        continue;
      }
      const tv = Math.round(b.tradingValue);
      data.push({
        etfCode,
        tradeDate: b.tradeDate,
        ...ohlc,
        volume: BigInt(Math.max(0, Math.round(b.volume))),
        tradingValue: tv > 0 ? BigInt(tv) : null,
        // 이 백필은 KIS 기간별시세를 직접 호출한다 → source 는 항상 'KIS'(증분 크론과 동일 어댑터).
        source: 'KIS',
      });
    }
    if (data.length === 0) return { saved: 0, invalid };
    const result = await this.prisma.etfDailyPrice.createMany({ data, skipDuplicates: true });
    return { saved: result.count, invalid };
  }

  /** 종목별 커버리지 집계(DB 조회 → 시작일·행수·갭 추정). */
  private async buildCoverage(
    codes: readonly string[],
  ): Promise<EtfDailyCoverageEntry[]> {
    const out: EtfDailyCoverageEntry[] = [];
    for (const code of codes) {
      const rows = await this.prisma.etfDailyPrice.findMany({
        where: { etfCode: code },
        select: { tradeDate: true },
        orderBy: { tradeDate: 'asc' },
      });
      const dates = rows.map((r) => r.tradeDate);
      const rowCount = dates.length;
      const startDate = dates[0] ?? null;
      const endDate = dates[dates.length - 1] ?? null;

      let expectedTradingDays = 0;
      let maxGapCalendarDays = 0;
      const suspiciousGaps: Array<{ from: string; to: string; calendarDays: number }> = [];

      if (startDate && endDate) {
        expectedTradingDays = countTradingDays(startDate, endDate);
        for (let i = 1; i < dates.length; i++) {
          const gap = calendarDaysBetween(dates[i - 1], dates[i]);
          if (gap > maxGapCalendarDays) maxGapCalendarDays = gap;
          if (gap > ETF_COVERAGE_SUSPICIOUS_GAP_DAYS) {
            suspiciousGaps.push({ from: dates[i - 1], to: dates[i], calendarDays: gap });
          }
        }
      }

      const entry = etfByCode(code);
      const listing = KNOWN_ETF_LISTINGS[code];
      out.push({
        code,
        name: entry?.name ?? code,
        role: entry?.role ?? 'UNKNOWN',
        rowCount,
        startDate,
        endDate,
        expectedTradingDays,
        missingVsExpected: Math.max(0, expectedTradingDays - rowCount),
        maxGapCalendarDays,
        suspiciousGaps: suspiciousGaps.slice(0, 10),
        note: listing
          ? `${listing} 상장 — 그 이전 일봉 부재는 정상(백테스트 표본 시작일).`
          : undefined,
      });
    }
    return out;
  }
}

// ── 순수 날짜 헬퍼(UTC 기준 — TZ/DST 드리프트 없이 YYYYMMDD 산술) ──────────────────

function ymdToUtcMs(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return Date.UTC(y, m - 1, d);
}

function utcMsToYmd(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${y}${pad2(m)}${pad2(d)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ymd 에 n 일 가감(음수 가능). */
function addDaysYmd(ymd: string, n: number): string {
  return utcMsToYmd(ymdToUtcMs(ymd) + n * 86_400_000);
}

/** 두 거래일 사이 달력일 간격(b − a, 일). */
function calendarDaysBetween(a: string, b: string): number {
  return Math.round((ymdToUtcMs(b) - ymdToUtcMs(a)) / 86_400_000);
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/** [startYmd,endYmd] 구간의 거래일 수(주말·알려진 공휴일 제외 — 상한 추정). 양끝 포함. */
function countTradingDays(startYmd: string, endYmd: string): number {
  let count = 0;
  let cur = startYmd;
  // 6년(≈2200일) × 4종도 O(수천)라 부담 없음. 무한루프 방지 상한(20년).
  for (let i = 0; i < 20 * 366 && cur <= endYmd; i++) {
    if (isTradingDay(cur)) count++;
    cur = addDaysYmd(cur, 1);
  }
  return count;
}
