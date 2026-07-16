import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MIN_SAMPLE_SIZE } from './event-study.service';
import { formatKstDateCompact } from '../../common/time/kst';

/**
 * 유사공시 반응 통계 (DAR-511 / 플랜 Wave A·A1).
 *
 * 공시(rcpNo)의 이벤트 유형에 대한 **과거 유사공시 실제 주가 반응**(D+1/D+5/D+20 누적
 * 평균수익률·상승비율·표본수 n)을 조회한다. 점수(권고)가 아니라 과거 사실(통계)이라
 * 유사투자자문 게이트 밖 — '봉인된 신호'의 합법 대체 셀링포인트(플랜 §2-2).
 *
 * 산출 원천(관측을 집계):
 *   `EventStudyObservation`(공시별 관측치, 이벤트당 1행)을 eventType으로 직접 집계한다.
 *   - `dailyReturns`(종목 일별 단순수익률)를 D+N까지 합산 → 실제 주가 반응(누적 단순수익률).
 *   - `cumulativeAR`(누적 초과수익)을 그대로 → 시장 대비 초과수익(정직: 시장 등락과 분리).
 *   - 상승비율 = 누적 단순수익률 > 0 관측치 비율.
 *   표본수 n은 signals의 `sampleCountByEventType`가 코어스 버킷(marketType='ALL',
 *   bucketKey='__ALL__')에 집계하는 것과 **동일한 EventStudy 표본**을 eventType별 관측치에서
 *   직접 센 값이다 — 코어스 버킷이 없는 단일버킷 유형까지 포함해 결정적이며, D+1/D+20 상승비율
 *   처럼 코어스 집계행이 보유하지 않는 지표까지 같은 표본에서 일관되게 산출한다.
 *
 * 정직 규약(수용기준 1): 계산기(event-study-calculation.service)는 n<10 → INSUFFICIENT,
 *   10≤n<30 → PRELIMINARY(통계값 채워짐), n≥30 → READY 로 tier를 판정한다. PRELIMINARY는
 *   통계값이 있어 status만 보면 "승률 100% (n=3)" 같은 소표본 허수가 노출될 수 있다. 따라서
 *   노출 게이트는 status가 아니라 **표본수 n ≥ MIN_SAMPLE_SIZE(=30)** 로 강제한다
 *   (n<30 → stats=null + reason='INSUFFICIENT_SAMPLE'). MIN_SAMPLE_SIZE는 통계 유의 READY
 *   임계와 동일 상수를 재사용 — "노출 가능 = 통계적으로 준비됨"을 SSOT로 묶는다.
 *
 * 읽기 전용(M10 무오염) · 마이그레이션 0 · eventType별 스냅샷 일1회(KST) 캐시.
 */

/** 반응 통계 지평(거래일). */
const HORIZONS = [1, 5, 20] as const;
type Horizon = (typeof HORIZONS)[number];

@Injectable()
export class DisclosureReactionStatsService {
  /** 반응 통계 노출 최소 표본수 — 통계 유의 READY 임계와 동일(허수 방지). */
  static readonly MIN_SAMPLE_SIZE = MIN_SAMPLE_SIZE;

  /** eventType별 산출 결과 캐시 — KST '일1회'. 값이 무거운 관측치 집계를 하루 1회로 제한. */
  private cache = new Map<string, { day: string; result: DisclosureReactionResult }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 공시(rcpNo)의 이벤트 유형별 반응 통계.
   *
   * `DisclosureEvent.rcpNo`는 `@unique`(공시 1건=이벤트 1건 원칙) — 대표 eventType 1개.
   * 이벤트 미추출(=신규/미수집) 공시는 `results:[]`(빈 상태, 에러 아님)로 반환한다.
   */
  async getReactionStatsByRcpNo(rcpNo: string): Promise<DisclosureReactionStatsResponse> {
    const generatedAt = new Date(this.now()).toISOString();
    const event = await this.prisma.disclosureEvent.findUnique({
      where: { rcpNo },
      select: { eventType: true },
    });

    if (!event) {
      return {
        rcpNo,
        minSampleSize: DisclosureReactionStatsService.MIN_SAMPLE_SIZE,
        generatedAt,
        results: [],
      };
    }

    const result = await this.reactionForEventType(event.eventType);
    return {
      rcpNo,
      minSampleSize: DisclosureReactionStatsService.MIN_SAMPLE_SIZE,
      generatedAt,
      results: [result],
    };
  }

  /**
   * eventType 반응 통계(일1회 캐시). 캐시 미스 시 관측치를 로드·집계한다.
   * status 무관 전량을 세어 n<30 유형도 n·산출기간·기준일을 정직 노출(게이트는 n≥30).
   */
  private async reactionForEventType(eventType: string): Promise<DisclosureReactionResult> {
    const day = formatKstDateCompact(new Date(this.now()));
    const cached = this.cache.get(eventType);
    if (cached && cached.day === day) return cached.result;

    const rows = await this.prisma.eventStudyObservation.findMany({
      where: { eventType },
      select: { dailyReturns: true, cumulativeAR: true, d0Date: true, createdAt: true },
    });

    const result = buildReactionResult(
      eventType,
      rows,
      DisclosureReactionStatsService.MIN_SAMPLE_SIZE,
    );
    this.cache.set(eventType, { day, result });
    return result;
  }

  /** 테스트 대체점. 런타임은 벽시계(캐시 일자 판정 전용 — 응답 데이터엔 절대날짜 미포함). */
  protected now(): number {
    return Date.now();
  }
}

// ─── 순수 집계(테스트 표적) ──────────────────────────────────────────

/** 반응 통계 집계 입력(EventStudyObservation 슬림). JSON 필드는 관측치 계산 산출물. */
export interface ReactionObservation {
  /** 종목 일별 단순수익률(%) {"d1":..,"d20":..}. */
  dailyReturns: unknown;
  /** 누적 초과수익(AR, %) {"d1":..,"d20":..}. */
  cumulativeAR: unknown;
  /** 실제 D0 날짜(YYYYMMDD) — 산출기간 경계. */
  d0Date: string;
  /** 관측치 영속 시각 — 기준일(as-of). */
  createdAt: Date;
}

/** 단일 지평(D+N) 반응 요약. */
export interface HorizonReaction {
  /** 실제 주가 반응 — 종목 단순수익률 D0→D+N 누적 평균(%). */
  avgReturn: number;
  /** 시장 대비 초과수익(AR) D+N 누적 평균(%). 표본 결측 시 null. */
  avgAbnormalReturn: number | null;
  /** 상승비율 — 누적 단순수익률>0 관측치 비율(0~1). */
  winRate: number;
}

/** 이벤트 유형 반응 통계(n≥30 게이트 통과 시). */
export interface ReactionStats {
  d1: HorizonReaction;
  d5: HorizonReaction;
  d20: HorizonReaction;
}

export interface DisclosureReactionResult {
  eventType: string;
  /** 집계 표본수 n. 관측치가 없으면 0. */
  sampleCount: number;
  /** n≥30 통과 시 통계, 아니면 null. */
  stats: ReactionStats | null;
  /** stats=null 사유. n≥30 통과 시 null. */
  reason: 'INSUFFICIENT_SAMPLE' | null;
  /** 산출기간(YYYYMMDD). 표본 없으면 null. */
  period: { fromDate: string; toDate: string } | null;
  /** 기준일(관측치 최신 영속 시각 ISO). 표본 없으면 null. */
  calculatedAt: string | null;
}

export interface DisclosureReactionStatsResponse {
  rcpNo: string;
  minSampleSize: number;
  /** 응답 생성 시각(ISO) — 일1회 캐시 표면. */
  generatedAt: string;
  results: DisclosureReactionResult[];
}

/** JsonValue → 숫자 맵(방어적). 배열·비객체·null은 빈 맵. */
function asNumberMap(json: unknown): Record<string, number> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  return json as Record<string, number>;
}

/** 종목 일별 단순수익률(dailyReturns)을 D0→D+n 까지 산술 합산(누적 AR과 동일 방식). */
function cumulativeRawReturn(dailyReturns: Record<string, number>, n: number): number {
  let sum = 0;
  for (let k = 1; k <= n; k++) {
    const v = dailyReturns[`d${k}`];
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** 소수 자릿수 반올림(부동소수 잡음 제거 — 결정론적 응답). */
function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 단일 지평 집계: 누적 단순수익률 평균·초과수익 평균·상승비율. */
function computeHorizon(rows: ReactionObservation[], n: Horizon): HorizonReaction {
  const rawCums: number[] = [];
  const abnCums: number[] = [];
  for (const r of rows) {
    rawCums.push(cumulativeRawReturn(asNumberMap(r.dailyReturns), n));
    const ar = asNumberMap(r.cumulativeAR)[`d${n}`];
    if (typeof ar === 'number' && Number.isFinite(ar)) abnCums.push(ar);
  }
  const ups = rawCums.filter((v) => v > 0).length;
  return {
    avgReturn: round(mean(rawCums), 2),
    avgAbnormalReturn: abnCums.length > 0 ? round(mean(abnCums), 2) : null,
    winRate: rawCums.length > 0 ? round(ups / rawCums.length, 4) : 0,
  };
}

/**
 * 순수 함수(테스트 표적): 관측치 배열 → 반응 통계 결과.
 *
 * 게이트는 오직 표본수 n ≥ minSampleSize — status/부호 무관. n<30(표본 0 포함)은
 * stats=null + reason='INSUFFICIENT_SAMPLE'. n·산출기간·기준일은 있는 그대로 노출(투명성).
 */
export function buildReactionResult(
  eventType: string,
  rows: ReactionObservation[],
  minSampleSize: number,
): DisclosureReactionResult {
  const sampleCount = rows.length;

  // 산출기간·기준일: 관측치 D0 최소/최대 + 최신 영속 시각(표본 있을 때만).
  let period: { fromDate: string; toDate: string } | null = null;
  let calculatedAt: string | null = null;
  if (sampleCount > 0) {
    let from = rows[0].d0Date;
    let to = rows[0].d0Date;
    let latest = rows[0].createdAt;
    for (const r of rows) {
      if (r.d0Date < from) from = r.d0Date;
      if (r.d0Date > to) to = r.d0Date;
      if (r.createdAt > latest) latest = r.createdAt;
    }
    period = { fromDate: from, toDate: to };
    calculatedAt = latest.toISOString();
  }

  if (sampleCount < minSampleSize) {
    return {
      eventType,
      sampleCount,
      stats: null,
      reason: 'INSUFFICIENT_SAMPLE',
      period,
      calculatedAt,
    };
  }

  return {
    eventType,
    sampleCount,
    stats: {
      d1: computeHorizon(rows, 1),
      d5: computeHorizon(rows, 5),
      d20: computeHorizon(rows, 20),
    },
    reason: null,
    period,
    calculatedAt,
  };
}
