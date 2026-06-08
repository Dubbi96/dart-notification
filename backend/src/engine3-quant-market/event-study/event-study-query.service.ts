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
}
