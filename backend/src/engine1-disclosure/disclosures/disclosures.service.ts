import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QueryDisclosureDto, SearchDisclosureDto } from './dto/query-disclosure.dto';

@Injectable()
export class DisclosuresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryDisclosureDto, userId?: string) {
    const { page = 1, limit = 20, corpCode, disclosureType, watchlistOnly, keywords } = query;

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

  async findOne(rcpNo: string) {
    const disclosure = await this.prisma.disclosure.findUnique({
      where: { rcpNo },
      include: {
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

    return {
      ...disclosure,
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

  async search(query: SearchDisclosureDto) {
    const { q, page = 1, limit = 20, disclosureType } = query;

    const where: Prisma.DisclosureWhereInput = {
      OR: [
        { reportName: { contains: q, mode: 'insensitive' } },
        { corpName: { contains: q, mode: 'insensitive' } },
      ],
      ...(disclosureType && { disclosureType }),
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
}
