import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { isTradingDay, KRX_HOLIDAYS } from '../../../common/time/market-calendar';
import { formatKstDateCompact } from '../../../common/time/kst';
import {
  CoverageAggregates,
  DataCoverageReport,
  PriceYearAggregate,
  DisclosureYearAggregate,
  buildCoverageReport,
} from './data-coverage';

/** 백테스트 검증 창 확장 기본값 — 11년(2015~2026). DAR-544. */
export const DEFAULT_COVERAGE_START_YEAR = 2015;
export const DEFAULT_COVERAGE_END_YEAR = 2026;

export interface CoverageAuditOptions {
  /** 감사 시작 연도(포함). 기본 2015. */
  startYear?: number;
  /** 감사 종료 연도(포함). 기본 2026. */
  endYear?: number;
  /**
   * 기대 거래일 산정 상한 YYYYMMDD(포함). 진행 중인 마지막 연도를 미래 거래일까지 과대계상하지
   * 않도록 절단한다. 기본 = 현재 KST 날짜. (DB 질의는 이 값과 무관하게 연도 전체를 집계 —
   * 존재 데이터는 정직하게 세고, '기대치'만 오늘까지로 절단해 충족률을 왜곡하지 않는다.)
   */
  asOfCompact?: string;
}

interface PriceAggRow {
  year: string;
  rows: bigint;
  tradingDays: bigint;
  stocks: bigint;
}

interface DisclosureAggRow {
  year: string;
  rows: bigint;
  corps: bigint;
}

/** YYYYMMDD → UTC Date(자정). */
function compactToUtc(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}

/** UTC Date → YYYYMMDD. */
function utcToCompact(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * DataCoverageService — 백테스트 검증 창(11년) 데이터 커버리지 감사 (DAR-544, 견고화 데이터게이트).
 *
 * 무엇: 확장 창 전 구간에 대해 연도별 가격(stock_daily_prices)·공시(disclosures) 커버리지를
 *   집계 질의(bounded groupBy)로 뽑고, KRX 달력(SSOT)의 연도별 기대 거래일로 충족률을 계산해
 *   '연도별 결측 리포트' + 11년 게이트 준비도 판정을 낸다.
 *
 * ★ read-only(불가침): SELECT 집계만 수행. 어떤 테이블에도 쓰지 않는다(BacktestRun/PaperTrade
 *   영속 0 — M10 측정 트랙 무접촉). 리포트는 응답으로만 반환하는 휘발 산출물.
 * ★ 측정 인프라만: 전략 파라미터를 만들거나 바꾸지 않는다. 결과의 코드 반영은 오직 룰북 §8
 *   변경 절차(문서 개정→재검증→사람 승인)로. AI 개입 0(§8.4).
 * ★ 성능: 연도 프리픽스 groupBy 2건(전건 적재 금지 — 반환 행수 ≤ 연도 수). 기대 거래일 산정은
 *   순수 달력 반복(≈4천 일, DB 무관).
 */
@Injectable()
export class DataCoverageService {
  private readonly logger = new Logger(DataCoverageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async audit(options: CoverageAuditOptions = {}): Promise<DataCoverageReport> {
    const startYear = options.startYear ?? DEFAULT_COVERAGE_START_YEAR;
    const endYear = options.endYear ?? DEFAULT_COVERAGE_END_YEAR;
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
      throw new BadRequestException(
        `유효하지 않은 연도 창: startYear=${startYear}, endYear=${endYear}`,
      );
    }

    const startCompact = `${startYear}0101`;
    const endCompact = `${endYear}1231`;
    // rcpDt 는 8/14자리 혼재 — 상한은 연도 프리픽스 이후 최대치로 두어 14자리도 포함한다.
    const disclosureCeil = `${endYear}9999`;

    const [priceRows, disclosureRows] = await Promise.all([
      this.prisma.$queryRaw<PriceAggRow[]>(Prisma.sql`
        SELECT LEFT("tradeDate", 4)           AS "year",
               COUNT(*)::bigint               AS "rows",
               COUNT(DISTINCT "tradeDate")::bigint AS "tradingDays",
               COUNT(DISTINCT "stockCode")::bigint AS "stocks"
        FROM "stock_daily_prices"
        WHERE "tradeDate" >= ${startCompact} AND "tradeDate" <= ${endCompact}
        GROUP BY LEFT("tradeDate", 4)
        ORDER BY "year"
      `),
      this.prisma.$queryRaw<DisclosureAggRow[]>(Prisma.sql`
        SELECT LEFT("rcpDt", 4)             AS "year",
               COUNT(*)::bigint             AS "rows",
               COUNT(DISTINCT "corpCode")::bigint AS "corps"
        FROM "disclosures"
        WHERE "rcpDt" >= ${startCompact} AND "rcpDt" <= ${disclosureCeil}
        GROUP BY LEFT("rcpDt", 4)
        ORDER BY "year"
      `),
    ]);

    const price: PriceYearAggregate[] = priceRows.map((r) => ({
      year: Number(r.year),
      rows: Number(r.rows),
      tradingDays: Number(r.tradingDays),
      stocks: Number(r.stocks),
    }));
    const disclosure: DisclosureYearAggregate[] = disclosureRows.map((r) => ({
      year: Number(r.year),
      rows: Number(r.rows),
      corps: Number(r.corps),
    }));

    const asOfCompact = options.asOfCompact ?? formatKstDateCompact(new Date());
    const expectedTradingDaysByYear = this.expectedTradingDaysByYear(
      startYear,
      endYear,
      asOfCompact,
    );

    // 완전 연도(연말까지 창·asOf 안) vs 부분 연도, 달력(KRX_HOLIDAYS) 공휴일 등재 여부.
    const effectiveEnd = asOfCompact < endCompact ? asOfCompact : endCompact;
    const fullYearByYear: Record<number, boolean> = {};
    const calendarCompleteByYear: Record<number, boolean> = {};
    for (let y = startYear; y <= endYear; y++) {
      fullYearByYear[y] = `${y}1231` <= effectiveEnd;
      calendarCompleteByYear[y] = this.calendarHasYear(y);
    }

    const aggregates: CoverageAggregates = {
      startYear,
      endYear,
      price,
      disclosure,
      expectedTradingDaysByYear,
      fullYearByYear,
      calendarCompleteByYear,
    };
    const report = buildCoverageReport(aggregates);

    this.logger.log(
      `[커버리지 감사 ${startYear}~${endYear}] 판정=${report.summary.verdict} · ` +
        `가격 ${report.summary.totalPriceRows.toLocaleString()}행 · 공시 ${report.summary.totalDisclosureRows.toLocaleString()}행 · ` +
        `결측연도=[${report.summary.missingYears.join(',') || '-'}] · 부분=[${report.summary.partialYears.join(',') || '-'}]`,
    );
    return report;
  }

  /** 달력(KRX_HOLIDAYS)에 해당 연도 공휴일이 하나라도 등재됐는지. 미등재면 충족률%가 과대. */
  private calendarHasYear(year: number): boolean {
    const prefix = String(year);
    for (const ymd of KRX_HOLIDAYS) {
      if (ymd.startsWith(prefix)) return true;
    }
    return false;
  }

  /**
   * 창 [startYear, endYear] 각 연도의 KRX 기대 거래일 수를 달력 SSOT 로 산출한다.
   * 진행 중 연도는 asOfCompact(포함)까지만 계상 — 미래 거래일을 결측으로 오판하지 않기 위함.
   */
  private expectedTradingDaysByYear(
    startYear: number,
    endYear: number,
    asOfCompact: string,
  ): Record<number, number> {
    const counts: Record<number, number> = {};
    for (let y = startYear; y <= endYear; y++) counts[y] = 0;

    const start = compactToUtc(`${startYear}0101`);
    const hardEnd = compactToUtc(`${endYear}1231`);
    const asOf = compactToUtc(asOfCompact);
    const end = asOf.getTime() < hardEnd.getTime() ? asOf : hardEnd;

    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const ymd = utcToCompact(new Date(t));
      if (isTradingDay(ymd)) {
        const year = Number(ymd.slice(0, 4));
        if (counts[year] !== undefined) counts[year] += 1;
      }
    }
    return counts;
  }
}
