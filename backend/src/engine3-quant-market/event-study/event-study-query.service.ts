import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { mean, median, percentile } from './utils/statistics';

/** D+N 초과수익 분포 요약 (DAR-402). 표본 없으면 null 필드. */
export interface ArDistribution {
  count: number;
  mean: number | null;
  median: number | null;
  p5: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
}

@Injectable()
export class EventStudyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findResults(filters: {
    eventType?: string;
    marketType?: string;
    /** true → 표본<30 미유의(INSUFFICIENT) 데이터한계 항목까지 포함. 기본 false(READY만) */
    includeInsufficient?: boolean;
  }) {
    const { eventType, marketType = 'ALL', includeInsufficient = false } = filters;
    return this.prisma.eventStudyResult.findMany({
      where: {
        ...(eventType ? { eventType } : {}),
        marketType,
        status: includeInsufficient ? { in: ['READY', 'INSUFFICIENT'] } : 'READY',
      },
      orderBy: { calculatedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 기업별 이벤트 스터디 통계 (DAR-190).
   *
   * EventStudyResult 는 시장 전체(이벤트 유형 × 시장 × 버킷) 집계라 corpCode 컬럼이 없다.
   * 종목별로 의미 있는 건 "이 기업이 실제로 제출한 공시 유형의 시장 반응 통계"이므로:
   *   1) DisclosureEvent 에서 해당 기업의 distinct eventType 을 구하고
   *   2) 그 유형들의 시장 전체 EventStudyResult 를 반환한다(표본은 시장 전체 = 통계적 유의성 유지).
   *
   * 공시 이벤트가 없는(=신규/미수집) 기업은 빈 배열을 반환 → 모바일은 빈상태(에러 아님)로 표시.
   * bucketKey 는 시장 전체 버킷 그대로라 기존 관측치 드릴다운(findObservations)과 정합한다.
   */
  async findResultsByCorpCode(params: {
    corpCode: string;
    eventType?: string;
    marketType?: string;
    includeInsufficient?: boolean;
  }) {
    const { corpCode, eventType, marketType = 'ALL', includeInsufficient = false } = params;

    // 이 기업이 보유한 공시 이벤트 유형(중복 제거)
    const companyEvents = await this.prisma.disclosureEvent.findMany({
      where: { corpCode },
      select: { eventType: true },
      distinct: ['eventType'],
    });
    const companyEventTypes = companyEvents.map((e) => e.eventType as string);
    if (companyEventTypes.length === 0) return [];

    // eventType 쿼리가 있으면 기업 보유 유형과의 교집합으로 제한
    const eventTypeFilter = eventType
      ? companyEventTypes.filter((t) => t === eventType)
      : companyEventTypes;
    if (eventTypeFilter.length === 0) return [];

    return this.prisma.eventStudyResult.findMany({
      where: {
        eventType: { in: eventTypeFilter },
        marketType,
        status: includeInsufficient ? { in: ['READY', 'INSUFFICIENT'] } : 'READY',
      },
      orderBy: { calculatedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 버킷 구성 개별 관측치 드릴다운 (DAR-166).
   *
   * bucketKey 로 식별되는 버킷의 개별 공시별 관측치(EventStudyObservation)를
   * 최신(d0Date desc) 순 페이지네이션으로 반환한다. 관측치 모델은 marketType 이 없어
   * 시장 무관 풀(= ALL 버킷과 동일 표본)이다. 빈 버킷이면 items=[] 로 흡수한다.
   *
   * - bucketKey 형식 `{EVENT_TYPE}__{suffix}` 자체가 eventType 을 내포 → bucketKey 단독으로 정합.
   * - 각 관측치는 누적 초과수익(CAR) D+5/D+20 요약과 기업명을 함께 노출(표본 투명성).
   */
  async findObservations(params: {
    bucketKey: string;
    eventType?: string;
    limit?: number;
    offset?: number;
  }) {
    const { bucketKey, eventType } = params;
    const limit = clampLimit(params.limit);
    const offset = Math.max(0, params.offset ?? 0);

    const where = {
      bucketKey,
      ...(eventType ? { eventType } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.eventStudyObservation.count({ where }),
      this.prisma.eventStudyObservation.findMany({
        where,
        orderBy: [{ d0Date: 'desc' as const }, { id: 'asc' as const }],
        skip: offset,
        take: limit,
      }),
    ]);

    // 기업명 배치 조회(논리 FK — Prisma relation 없음)
    const corpCodes = Array.from(new Set(rows.map(r => r.corpCode)));
    const companies = corpCodes.length
      ? await this.prisma.company.findMany({
          where: { corpCode: { in: corpCodes } },
          select: { corpCode: true, corpName: true, stockCode: true },
        })
      : [];
    const companyByCorp = new Map(companies.map(c => [c.corpCode, c]));

    const items = rows.map(r => {
      const car = (r.cumulativeAR ?? {}) as Record<string, number>;
      const company = companyByCorp.get(r.corpCode);
      return {
        eventId: r.eventId,
        rcpNo: r.rcpNo,
        corpCode: r.corpCode,
        corpName: company?.corpName ?? null,
        stockCode: company?.stockCode ?? null,
        eventType: r.eventType,
        bucketKey: r.bucketKey,
        d0Date: r.d0Date,
        carD5: car['d5'] ?? null,
        carD20: car['d20'] ?? null,
        maxDrawdown: r.maxDrawdown,
        isUpD5: r.isUpD5,
        isCrashD5: r.isCrashD5,
      };
    });

    return {
      bucketKey,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
      items,
    };
  }

  /**
   * 버킷의 D+N 초과수익 **분포** 요약 (DAR-402).
   *
   * 산술평균(EventStudyResult.avgArD20)은 극단 이상치에 지배돼 거짓 신호를 만든다.
   * 개별 관측치(EventStudyObservation.cumulativeAR)에서 D+5/D+20 누적 AR 의 중앙값·분위수를
   * 직접 산출해, 평균과 중앙값의 괴리(=이상치 오염)를 표면화한다.
   *
   * 관측치 모델은 marketType 이 없어 시장 무관 풀(= ALL 버킷 표본)이다.
   * 표본이 비면 모든 분포 필드 null(에러 아님).
   */
  async getDistribution(params: { bucketKey: string; eventType?: string }): Promise<{
    bucketKey: string;
    count: number;
    d5: ArDistribution;
    d20: ArDistribution;
  }> {
    const { bucketKey, eventType } = params;
    const where = {
      bucketKey,
      ...(eventType ? { eventType } : {}),
    };

    const rows = await this.prisma.eventStudyObservation.findMany({
      where,
      select: { cumulativeAR: true },
    });

    const d5s: number[] = [];
    const d20s: number[] = [];
    for (const r of rows) {
      const car = (r.cumulativeAR ?? {}) as Record<string, number>;
      if (typeof car['d5'] === 'number') d5s.push(car['d5']);
      if (typeof car['d20'] === 'number') d20s.push(car['d20']);
    }

    return {
      bucketKey,
      count: rows.length,
      d5: summarizeDistribution(d5s),
      d20: summarizeDistribution(d20s),
    };
  }

  /**
   * eventType별 대표 robust D+20 초과수익 (DAR-408 — event-edge 전략 선별 입력).
   *
   * 러너의 신호 필터는 eventType 단위라(버킷 무관) eventType별 단일 대표값이 필요하다.
   * 같은 eventType 에 fine 버킷이 여럿이면 coarse(__ALL__) 부모 버킷이 전체 표본 집계라 우선,
   * 없으면(단일 fine 버킷) 표본 최다 버킷을 대표로 쓴다. status READY/INSUFFICIENT 모두 포함하되
   * 선별 게이트(임계치·최소표본)는 호출 측(EventEdgeSelectorService)이 적용한다.
   *
   * marketType 기본 ALL(시장 무관 풀). 표본 없으면 빈 배열(에러 아님).
   */
  async findRobustEdges(marketType = 'ALL'): Promise<RobustEdge[]> {
    const rows = await this.prisma.eventStudyResult.findMany({
      where: { marketType, status: { in: ['READY', 'INSUFFICIENT'] } },
      select: {
        eventType: true,
        bucketKey: true,
        winsorizedMeanArD20: true,
        medianArD20: true,
        avgArD20: true,
        sampleCount: true,
        status: true,
      },
    });

    // eventType별 대표 버킷 선택: __ALL__ coarse 우선 → 표본 최다.
    const byEventType = new Map<string, RobustEdge>();
    for (const r of rows) {
      const candidate: RobustEdge = {
        eventType: r.eventType,
        bucketKey: r.bucketKey,
        winsorizedMeanArD20: r.winsorizedMeanArD20,
        medianArD20: r.medianArD20,
        avgArD20: r.avgArD20,
        sampleCount: r.sampleCount,
        status: r.status,
      };
      const existing = byEventType.get(r.eventType);
      if (!existing || isPreferredRepresentative(candidate, existing)) {
        byEventType.set(r.eventType, candidate);
      }
    }
    return Array.from(byEventType.values());
  }
}

/** 동일 eventType 두 버킷 중 대표 선택: __ALL__ coarse 우선 → 표본 최다. */
function isPreferredRepresentative(candidate: RobustEdge, existing: RobustEdge): boolean {
  const COARSE = '__ALL__';
  const candCoarse = candidate.bucketKey === COARSE;
  const existCoarse = existing.bucketKey === COARSE;
  if (candCoarse !== existCoarse) return candCoarse; // coarse 우선
  return candidate.sampleCount > existing.sampleCount; // 동급이면 표본 최다
}

/** event-edge robust 선별용 eventType별 대표 robust D+20 초과수익 (DAR-408). */
export interface RobustEdge {
  eventType: string;
  bucketKey: string;
  /** winsorized 평균(5%/95% clip) — 없으면 null(미재계산 행). */
  winsorizedMeanArD20: number | null;
  /** 중앙값 — winsorized 폴백. */
  medianArD20: number | null;
  /** 참고용 산술평균(오염 가능 — 선별엔 미사용). */
  avgArD20: number;
  sampleCount: number;
  status: string;
}

/** 수익률 배열 → 분포 요약(평균·중앙값·분위수). 빈 배열은 count=0 + null 필드. */
function summarizeDistribution(values: number[]): ArDistribution {
  if (values.length === 0) {
    return { count: 0, mean: null, median: null, p5: null, p25: null, p75: null, p95: null };
  }
  return {
    count: values.length,
    mean: mean(values),
    median: median(values),
    p5: percentile(values, 0.05),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
  };
}

/** 페이지 크기 보정: 1~100, 기본 20 */
function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit) || limit <= 0) return 20;
  return Math.min(100, Math.floor(limit));
}
