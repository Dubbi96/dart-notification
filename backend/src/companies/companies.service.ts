import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit: number = 10) {
    const companies = await this.prisma.company.findMany({
      where: {
        corpName: {
          contains: query,
          mode: 'insensitive',
        },
      },
      take: Math.min(limit, 20),
      select: {
        id: true,
        corpCode: true,
        corpName: true,
        stockCode: true,
        market: true,
      },
    });

    return companies;
  }

  async findByCorpCode(corpCode: string) {
    const company = await this.prisma.company.findUnique({
      where: { corpCode },
      select: {
        id: true,
        corpCode: true,
        corpName: true,
        stockCode: true,
        market: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }
}
