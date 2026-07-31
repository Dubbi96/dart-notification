import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DecisionParityQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(from: Date, to: Date) {
    const rows = await this.prisma.signalDecision.groupBy({
      by: ['parityStatus'],
      where: { mode: 'LEGACY_PARITY', evaluatedAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    const counts = { MATCH: 0, MISMATCH: 0, NOT_COMPARED: 0 };
    for (const row of rows) counts[row.parityStatus] = row._count._all;
    const compared = counts.MATCH + counts.MISMATCH;
    return Object.freeze({
      from: from.toISOString(),
      to: to.toISOString(),
      ...counts,
      compared,
      matchRate: compared === 0 ? null : counts.MATCH / compared,
    });
  }
}
