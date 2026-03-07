import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QueryDisclosureDto, SearchDisclosureDto } from './dto/query-disclosure.dto';

@Injectable()
export class DisclosuresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryDisclosureDto) {
    const { page = 1, limit = 20, corpCode, disclosureType } = query;

    const where: Prisma.DisclosureWhereInput = {
      ...(corpCode && { corpCode }),
      ...(disclosureType && { disclosureType }),
    };

    const [items, total] = await Promise.all([
      this.prisma.disclosure.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { rcpDt: 'desc' },
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

  async findOne(id: string) {
    const disclosure = await this.prisma.disclosure.findUnique({
      where: { id },
    });

    if (!disclosure) {
      throw new NotFoundException('Disclosure not found');
    }

    return {
      ...disclosure,
      dartUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${disclosure.rcpNo}`,
    };
  }

  async search(query: SearchDisclosureDto) {
    const { q, page = 1, limit = 20 } = query;

    const where: Prisma.DisclosureWhereInput = {
      OR: [
        { reportName: { contains: q, mode: 'insensitive' } },
        { corpName: { contains: q, mode: 'insensitive' } },
      ],
    };

    const [items, total] = await Promise.all([
      this.prisma.disclosure.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { rcpDt: 'desc' },
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
