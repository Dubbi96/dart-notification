import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SignalGrade } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tradeDateFromMs } from '../engine3-quant-market/market-data/candle-query';
import {
  isTradingDay,
  prevTradingDay,
} from '../common/time/market-calendar';
import {
  DensityHistogramBucket,
  DensityStats,
  EDITION_DENSITY_FALLBACK_PROPOSAL_DOC,
  EDITION_DENSITY_THRESHOLDS,
  EditionDensityReport,
  EditionDensityVerdict,
  TradingDayCrossCheck,
} from './edition-density.types';

/** KST 오프셋(ms). 서버 TZ 무관 KST 벽시계 산출용(에디션 코드와 동일 규약). */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 신호 생성 크론 완료 임계(KST 19:15). 이 시각 전의 '오늘'은 미완료로 보고 윈도에서 제외. */
const SIGNAL_CYCLE_DONE_HOUR = 19;
const SIGNAL_CYCLE_DONE_MIN = 15;

/** 집계 거래일 수 기본/상한. 상한은 캘린더 정확도(2024~2026 동결)와 스캔량 균형. */
const DEFAULT_WINDOW_TRADING_DAYS = 60;
const MAX_WINDOW_TRADING_DAYS = 120;
const MIN_WINDOW_TRADING_DAYS = 1;

/** '에디션 신호' 정의(정직성 계약) — findDailyEditions 와 동일 규칙. */
export const EDITION_SIGNAL_DEFINITION =
  "에디션 신호 = 매수등급(STRONG_BUY+BUY) TradingSignal 중 백필 제외(disclosure.isBackfill=false). " +
  "귀속 거래일 = created_at 을 KST 로 환산한 날짜((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date). " +
  "이는 GET /signals/daily-editions 가 세는 '호'의 밀도와 1:1 일치한다. " +
  'allGrade 계열은 매수등급 필터만 뺀 전등급 신호(백필 제외)로, 파이프라인이 신호는 만들지만 ' +
  '매수등급이 아닐 뿐인지(폴백 여지)를 진단한다.';

/** $queryRaw 결과 1행(PostgreSQL COUNT/SUM 은 bigint). */
interface RawDensityRow {
  date: string;
  totalCount: bigint;
  buyCount: bigint;
}

// ────────────────────────────────────────────────────────────────────────────
// 순수 함수(테스트 결정론) — DB 무관
// ────────────────────────────────────────────────────────────────────────────

/** 소수 decimals 자리 반올림(음수/NaN 방어). */
export function roundTo(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** 산술 평균(빈 배열 → 0). */
export function meanOf(counts: number[]): number {
  if (counts.length === 0) return 0;
  return counts.reduce((a, b) => a + b, 0) / counts.length;
}

/** 중앙값 — 오름차순 정렬 배열. 짝수 표본은 두 중앙값 평균. 빈 배열 → 0. */
export function medianOfSorted(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2 : sortedAsc[mid];
}

/** nearest-rank 백분위 — 오름차순 정렬 배열. 빈 배열 → 0. */
export function percentileNearestRank(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAsc[rank - 1];
}

/** 건수 → 히스토그램 버킷 라벨. */
function bucketLabel(count: number): string {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count === 2) return '2';
  if (count <= 4) return '3-4';
  if (count <= 9) return '5-9';
  return '10+';
}

/** 고정 순서 히스토그램(0 버킷도 항상 노출 — 빈날 가시화). */
export function buildHistogram(counts: number[]): DensityHistogramBucket[] {
  const order = ['0', '1', '2', '3-4', '5-9', '10+'];
  const tally = new Map<string, number>(order.map((b) => [b, 0]));
  for (const c of counts) {
    const label = bucketLabel(c);
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  return order.map((bucket) => ({ bucket, days: tally.get(bucket) ?? 0 }));
}

/** 거래일별 건수 배열 → 분포 통계. */
export function computeDensityStats(counts: number[]): DensityStats {
  const days = counts.length;
  const sorted = [...counts].sort((a, b) => a - b);
  const totalSignals = counts.reduce((a, b) => a + b, 0);
  const zeroDays = counts.filter((c) => c === 0).length;
  return {
    days,
    totalSignals,
    mean: roundTo(meanOf(counts), 2),
    median: roundTo(medianOfSorted(sorted), 2),
    min: days > 0 ? sorted[0] : 0,
    max: days > 0 ? sorted[days - 1] : 0,
    p25: percentileNearestRank(sorted, 25),
    p75: percentileNearestRank(sorted, 75),
    zeroDays,
    zeroDayRatio: days > 0 ? roundTo(zeroDays / days, 4) : 0,
    histogram: buildHistogram(counts),
  };
}

/** 요청 days 클램프(비숫자/음수/거대값 방어). */
export function clampWindowDays(days: number | undefined): number {
  const n = Math.trunc(Number(days));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_TRADING_DAYS;
  return Math.min(MAX_WINDOW_TRADING_DAYS, Math.max(MIN_WINDOW_TRADING_DAYS, n));
}

/**
 * anchorEnd(최근 '완료된' 거래일) 산출.
 * - 오늘이 거래일 && KST 19:15 이후 → 오늘(오늘 크론 완료).
 * - 그 외(주말·공휴일·19:15 전) → 직전 거래일(오늘 미완료 에디션 제외 → 0건일 오염 차단).
 */
export function resolveAnchorEnd(now: Date): {
  todayDate: string;
  anchorEnd: string;
  todayIncluded: boolean;
} {
  const todayDate = tradeDateFromMs(now.getTime());
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const kstH = kstNow.getUTCHours();
  const kstM = kstNow.getUTCMinutes();
  const afterCycle =
    kstH > SIGNAL_CYCLE_DONE_HOUR ||
    (kstH === SIGNAL_CYCLE_DONE_HOUR && kstM >= SIGNAL_CYCLE_DONE_MIN);
  if (isTradingDay(todayDate) && afterCycle) {
    return { todayDate, anchorEnd: todayDate, todayIncluded: true };
  }
  return { todayDate, anchorEnd: prevTradingDay(todayDate), todayIncluded: false };
}

/**
 * anchorEnd 에서 과거로 count 개 거래일 열거(오름차순 반환: [oldest ... anchorEnd]).
 * market-calendar SSOT(isTradingDay/prevTradingDay)만 사용 — 주말·공휴일 자동 제외.
 */
export function enumerateTradingDays(anchorEnd: string, count: number): string[] {
  const out: string[] = [];
  let cursor = anchorEnd;
  // anchorEnd 자신이 거래일이 아닐 가능성 방어(호출부는 거래일을 넘기지만 안전망).
  if (!isTradingDay(cursor)) cursor = prevTradingDay(cursor);
  for (let i = 0; i < count; i++) {
    out.push(cursor);
    cursor = prevTradingDay(cursor);
  }
  return out.reverse();
}

/** 판정(수용기준 2). */
export function buildVerdict(buyGrade: DensityStats): EditionDensityVerdict {
  const medianBelowThreshold = buyGrade.median < EDITION_DENSITY_THRESHOLDS.medianLt;
  const zeroDayRatioAboveThreshold =
    buyGrade.zeroDayRatio > EDITION_DENSITY_THRESHOLDS.zeroDayRatioGt;
  const fallbackProposalTriggered =
    medianBelowThreshold || zeroDayRatioAboveThreshold;
  const reasons: string[] = [];
  if (medianBelowThreshold) {
    reasons.push(`중앙값 ${buyGrade.median} < ${EDITION_DENSITY_THRESHOLDS.medianLt}`);
  }
  if (zeroDayRatioAboveThreshold) {
    reasons.push(
      `0건일 비율 ${(buyGrade.zeroDayRatio * 100).toFixed(1)}% > ${EDITION_DENSITY_THRESHOLDS.zeroDayRatioGt * 100}%`,
    );
  }
  const summary = fallbackProposalTriggered
    ? `트리거: ${reasons.join(' · ')} → 비신호 콘텐츠 폴백 스코프 제안서 오너 판정 회부.`
    : `임계 미달: 에디션 밀도 충분(중앙값 ${buyGrade.median}, 0건일 ${(buyGrade.zeroDayRatio * 100).toFixed(1)}%). 폴백 불요.`;
  return {
    medianBelowThreshold,
    zeroDayRatioAboveThreshold,
    fallbackProposalTriggered,
    thresholds: EDITION_DENSITY_THRESHOLDS,
    proposalDoc: EDITION_DENSITY_FALLBACK_PROPOSAL_DOC,
    summary,
  };
}

/** YYYYMMDD → 'YYYY-MM-DD'(로그 가독). */
function dashed(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 서비스
// ────────────────────────────────────────────────────────────────────────────

/**
 * EditionDensityService — 에디션 밀도 실측(DAR-513, Wave A/A3).
 *
 * '1거래일=1호' 에디션이 '대부분 빈 신문'인지 판정할 데이터를 산출한다.
 * 최근 N(기본 60) 거래일의 일자별 매수등급(에디션) 신호 건수 분포:
 *   중앙값·평균·p25/p75·0건일 비율·히스토그램 + 판정(중앙값<2 또는 0건일>40%).
 *
 * ★read-only — SELECT/COUNT 만. 신규 테이블·수집·외부호출·체결·AI·마이그레이션 0.
 *   M10 무오염(읽기 API 한정) 준수. prod DB 에 읽기 전용으로 안전 실행 가능.
 */
@Injectable()
export class EditionDensityService {
  private readonly logger = new Logger(EditionDensityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 에디션 밀도 리포트 산출.
   * @param days 집계 거래일 수(1~120 클램프, 기본 60).
   * @param now  기준 시각(테스트 주입용, 기본 현재).
   */
  async getEditionDensity(
    days?: number,
    now: Date = new Date(),
  ): Promise<EditionDensityReport> {
    const windowTradingDays = clampWindowDays(days);
    const { todayDate, anchorEnd, todayIncluded } = resolveAnchorEnd(now);
    const tradingDays = enumerateTradingDays(anchorEnd, windowTradingDays);
    const oldestDate = tradingDays[0];

    const [countsByDate, marketDataTradingDays] = await Promise.all([
      this.countSignalsByKstDate(oldestDate, anchorEnd),
      this.countMarketDataTradingDays(oldestDate, anchorEnd),
    ]);

    // 거래일별 건수 배열(윈도 전 거래일 대상, 신호 없는 날 → 0).
    const daily = tradingDays
      .map((date) => {
        const row = countsByDate.get(date);
        return {
          date,
          buyCount: row?.buyCount ?? 0,
          totalCount: row?.totalCount ?? 0,
        };
      })
      // 최신 우선
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const buyCounts = tradingDays.map((d) => countsByDate.get(d)?.buyCount ?? 0);
    const totalCounts = tradingDays.map(
      (d) => countsByDate.get(d)?.totalCount ?? 0,
    );

    const buyGrade = computeDensityStats(buyCounts);
    const allGrade = computeDensityStats(totalCounts);
    const verdict = buildVerdict(buyGrade);

    const crossCheck: TradingDayCrossCheck = {
      calendarTradingDays: windowTradingDays,
      marketDataTradingDays,
      matches:
        marketDataTradingDays === null
          ? null
          : marketDataTradingDays === windowTradingDays,
      note:
        '캘린더 규칙(market-calendar SSOT, KRX 2024~2026 동결) 거래일 수와 ' +
        '윈도 구간 일봉(StockDailyPrice) 실재 거래일 distinct 수를 대조한다. ' +
        '불일치 시 캘린더 누락 공휴일 또는 시세 수집 공백을 의심(분모 신뢰도 진단).',
    };

    this.logger.log(
      `edition-density: window=${windowTradingDays}td [${dashed(oldestDate)}~${dashed(anchorEnd)}] ` +
        `buy median=${buyGrade.median} zero=${(buyGrade.zeroDayRatio * 100).toFixed(1)}% ` +
        `trigger=${verdict.fallbackProposalTriggered}`,
    );

    return {
      metric: 'edition-signal-density',
      definition: EDITION_SIGNAL_DEFINITION,
      windowTradingDays,
      anchorEndDate: anchorEnd,
      oldestDate,
      todayDate,
      todayIncludedInWindow: todayIncluded,
      generatedAt: now.toISOString(),
      buyGrade,
      allGrade,
      verdict,
      tradingDayCrossCheck: crossCheck,
      daily,
    };
  }

  /**
   * [oldestYmd, anchorEndYmd] KST 거래일 범위의 신호를 일자별로 집계.
   * 매수등급(buyCount)·전등급(totalCount)을 한 번의 $queryRaw 로 산출한다.
   * ★KST 환산은 findDailyEditions 와 동일한 이중 변환(AT TIME ZONE 'UTC' → 'Asia/Seoul').
   *   단순 단일 변환은 서버 TZ 에 따라 하루 어긋나므로 금지.
   * 신호 없는 날은 행이 없어 호출부에서 0 으로 채운다.
   */
  private async countSignalsByKstDate(
    oldestYmd: string,
    anchorEndYmd: string,
  ): Promise<Map<string, { buyCount: number; totalCount: number }>> {
    const STRONG_BUY = SignalGrade.STRONG_BUY_CANDIDATE;
    const BUY = SignalGrade.BUY_CANDIDATE;
    // ★컬럼명은 Prisma 기본(따옴표 camelCase) — 스키마에 per-field @map 이 없으므로
    //   실제 컬럼은 "createdAt"/"rcpNo"/"isBackfill" 이다. snake_case(created_at 등) 는
    //   존재하지 않아 런타임 에러가 난다(DAR-513 실측 중 발견 — findDailyEditions 참조).
    const rows = await this.prisma.$queryRaw<RawDensityRow[]>(Prisma.sql`
      SELECT
        to_char(
          (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
          'YYYYMMDD'
        )                                                                    AS date,
        COUNT(*)::bigint                                                     AS "totalCount",
        SUM(CASE WHEN ts.signal::text IN (${STRONG_BUY}, ${BUY}) THEN 1 ELSE 0 END)::bigint
                                                                            AS "buyCount"
      FROM trading_signals ts
      JOIN disclosures d ON d."rcpNo" = ts."rcpNo"
      WHERE d."isBackfill" = false
        AND (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
              >= to_date(${oldestYmd}, 'YYYYMMDD')
        AND (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
              <= to_date(${anchorEndYmd}, 'YYYYMMDD')
      GROUP BY (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
    `);

    const map = new Map<string, { buyCount: number; totalCount: number }>();
    for (const r of rows) {
      map.set(r.date, {
        buyCount: Number(r.buyCount),
        totalCount: Number(r.totalCount),
      });
    }
    return map;
  }

  /**
   * 윈도 구간 [oldestYmd, anchorEndYmd] 내 일봉 실재 거래일 distinct 수(교차검증용).
   * tradeDate 는 'YYYYMMDD' 문자열이라 사전식 비교가 날짜 비교와 동치.
   * 시세 데이터가 없거나 질의 실패 시 null(주계열 리포트를 깨지 않음).
   */
  private async countMarketDataTradingDays(
    oldestYmd: string,
    anchorEndYmd: string,
  ): Promise<number | null> {
    try {
      const rows = await this.prisma.stockDailyPrice.findMany({
        where: { tradeDate: { gte: oldestYmd, lte: anchorEndYmd } },
        distinct: ['tradeDate'],
        select: { tradeDate: true },
      });
      return rows.length;
    } catch (err) {
      this.logger.warn(
        `edition-density: 일봉 거래일 교차검증 실패(무시, marketDataTradingDays=null): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
