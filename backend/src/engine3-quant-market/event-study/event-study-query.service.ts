import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EventStudyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findResults(filters: { eventType?: string; marketType?: string }) {
    const { eventType, marketType = 'ALL' } = filters;
    return this.prisma.eventStudyResult.findMany({
      where: {
        ...(eventType ? { eventType } : {}),
        marketType,
        status: 'READY',
      },
      orderBy: { calculatedAt: 'desc' },
      take: 50,
    });
  }
}
