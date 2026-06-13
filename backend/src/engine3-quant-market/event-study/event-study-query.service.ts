import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
}

/** 페이지 크기 보정: 1~100, 기본 20 */
function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit) || limit <= 0) return 20;
  return Math.min(100, Math.floor(limit));
}
