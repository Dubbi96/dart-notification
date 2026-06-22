import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QueryDisclosureDto, SearchDisclosureDto } from './dto/query-disclosure.dto';
import {
  tokenize,
  normalizePeriod,
  scoreDisclosure,
  compareRecency,
  RELEVANCE_SCAN_LIMIT,
} from './search.util';

@Injectable()
export class DisclosuresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryDisclosureDto, userId?: string) {
    const { page = 1, limit = 20, corpCode, disclosureType, watchlistOnly, keywords, from, to } = query;
    const period = normalizePeriod(from, to);

    let watchlistCorpCodes: string[] | undefined;
    if (watchlistOnly) {
      if (!userId) {
        // 미인증 상태에서 관심목록 필터 → 빈 결과
        return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
      }
      const watchlist = await this.prisma.watchList.findMany({
        where: { userId },
        select: { corpCode: true },
      });
      watchlistCorpCodes = watchlist.map((w) => w.corpCode);
      if (watchlistCorpCodes.length === 0) {
        return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
      }
    }

    const where: Prisma.DisclosureWhereInput = {
      ...(corpCode && { corpCode }),
      ...(disclosureType && { disclosureType }),
      ...(watchlistCorpCodes && { corpCode: { in: watchlistCorpCodes } }),
      ...(keywords && keywords.length > 0 && {
        OR: keywords.map((kw) => ({
          reportName: { contains: kw, mode: 'insensitive' as const },
        })),
      }),
      ...(period && { rcpDt: period }),
    };

    const [items, total] = await Promise.all([
      this.prisma.disclosure.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ rcpDt: 'desc' }, { rcpNo: 'desc' }],
      }),
      this.prisma.disclosure.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * '오늘의 공시' 집계 (DAR-420)
   * - '오늘' = 최신 가용 공시일 = max(rcpDt)의 날짜 파트(YYYYMMDD).
   *   환경시계 today가 아니라 실제 데이터 최신일을 쓴다(env-today 0건 / 전체 누적 1.37M 둘 다 오답).
   *   단타 tradeDate가 최신 가용일 기준인 것과 동일한 point-in-time 정합.
   * - 게스트 조회 가능. 백필 여부 무관(홈 피드와 동일하게 전량 카운트).
   * - rcpDt는 'YYYYMMDD' 또는 'YYYYMMDDHHmmss' 혼재 → 날짜 prefix(앞 8자리)로 동일일 판정.
   *   startsWith(LIKE 'date%')는 @@index([rcpDt]) 범위 스캔으로 커버된다.
   */
  async getTodayCount(): Promise<{ date: string | null; count: number }> {
    const latest = await this.prisma.disclosure.findFirst({
      orderBy: [{ rcpDt: 'desc' }],
      select: { rcpDt: true },
    });
    if (!latest) {
      return { date: null, count: 0 };
    }
    const date = latest.rcpDt.slice(0, 8); // YYYYMMDD
    const count = await this.prisma.disclosure.count({
      where: { rcpDt: { startsWith: date } },
    });
    return { date, count };
  }

  async findOne(rcpNo: string) {
    const disclosure = await this.prisma.disclosure.findUnique({
      where: { rcpNo },
      include: {
        // DAR-188: 종목코드(6자리)는 Company에만 존재 — 상세 응답에 평탄화해 노출.
        //   corpCode(8자리 고유번호)와 혼동 금지(공시상세 "종목코드" 라벨 버그 수정).
        company: { select: { stockCode: true } },
        // M2: 이벤트 추출 결과 포함 (없으면 null)
        disclosureEvent: {
          select: {
            eventType: true,
            extractedData: true,
            polarity: true,
            confidence: true,
            extractionStatus: true,
            isAiAssisted: true,
            isAmendment: true,
            originalRcpNo: true,
            extractedAt: true,
          },
        },
      },
    });

    if (!disclosure) {
      throw new NotFoundException('Disclosure not found');
    }

    // include로 끌어온 company는 응답 형태 일관성을 위해 제거하고 stockCode만 평탄화.
    const { company, ...rest } = disclosure;

    return {
      ...rest,
      // DAR-188: 종목코드 6자리(비상장·미연동 시 null). 클라이언트는 null이면 라벨 정정/숨김.
      stockCode: company?.stockCode ?? null,
      dartUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${disclosure.rcpNo}`,
      // event 필드: M2 추출 결과 (미추출 시 null)
      event: disclosure.disclosureEvent ?? null,
    };
  }

  async findAnalysis(rcpNo: string) {
    const [analyses, persona] = await Promise.all([
      this.prisma.disclosureAnalysis.findMany({
        where: { rcpNo },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.personaAnalysis.findUnique({ where: { rcpNo } }),
    ]);

    return {
      rcpNo,
      analyses: analyses.map((a) => ({
        task: a.task,
        level: a.level,
        result: a.resultJson,
        createdAt: a.createdAt.toISOString(),
      })),
      personaAnalysis: persona
        ? {
            result: persona.resultJson,
            createdAt: persona.createdAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * SEO식(스마트) 검색 (DAR-45)
   * - 다중필드: reportName · corpName · flrName · Company.stockCode
   * - 토큰 분해: 공백 단위로 분해해 토큰 간 AND, 각 토큰은 필드 간 OR
   *   (예: "삼성 유상증자" → "삼성"·"유상증자" 둘 다 어느 필드든 매칭)
   * - 정렬: latest(최신순, 기본) | relevance(관련도순)
   * - 무마이그레이션 구현: 관련도는 최근 RELEVANCE_SCAN_LIMIT건 스캔 후 메모리 재정렬.
   */
  async search(query: SearchDisclosureDto) {
    const { q, page = 1, limit = 20, disclosureType, from, to, sort = 'latest' } = query;

    const tokens = tokenize(q);
    const period = normalizePeriod(from, to);

    const where: Prisma.DisclosureWhereInput = {
      ...(tokens.length > 0 && {
        AND: tokens.map((token) => ({
          OR: [
            { reportName: { contains: token, mode: 'insensitive' as const } },
            { corpName: { contains: token, mode: 'insensitive' as const } },
            { flrName: { contains: token, mode: 'insensitive' as const } },
            { company: { stockCode: { contains: token, mode: 'insensitive' as const } } },
          ],
        })),
      }),
      ...(disclosureType && { disclosureType }),
      ...(period && { rcpDt: period }),
    };

    // 관련도 정렬: 최근 N건을 스캔해 메모리에서 점수순 재정렬 (DB LIKE는 관련도 정렬 불가).
    if (sort === 'relevance' && tokens.length > 0) {
      const normalized = q.trim().toLowerCase();
      const [scanned, total] = await Promise.all([
        this.prisma.disclosure.findMany({
          where,
          take: RELEVANCE_SCAN_LIMIT,
          orderBy: [{ rcpDt: 'desc' }, { rcpNo: 'desc' }],
          include: { company: { select: { stockCode: true } } },
        }),
        this.prisma.disclosure.count({ where }),
      ]);

      const ranked = scanned
        .map((d) => ({
          d,
          score: scoreDisclosure(
            { ...d, stockCode: d.company?.stockCode ?? null },
            tokens,
            normalized,
          ),
        }))
        .sort((a, b) => b.score - a.score || compareRecency(a.d, b.d))
        // include로 끌어온 company는 응답 형태 일관성을 위해 제거.
        .map(({ d }) => {
          const { company, ...rest } = d;
          void company;
          return rest;
        });

      const items = ranked.slice((page - 1) * limit, (page - 1) * limit + limit);

      return {
        items,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          sort: 'relevance' as const,
          scanned: scanned.length,
        },
      };
    }

    // 최신순(기본): DB 정렬 + 페이지네이션.
    const [items, total] = await Promise.all([
      this.prisma.disclosure.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ rcpDt: 'desc' }, { rcpNo: 'desc' }],
      }),
      this.prisma.disclosure.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        sort: 'latest' as const,
      },
    };
  }
}
