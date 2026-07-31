import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { buildMarketRegimeSnapshot } from '../domain/decision-ledger';
import { MarketRegimeSnapshotInput } from '../domain/decision-ledger.types';

@Injectable()
export class FreezeMarketRegimeSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async freeze(input: MarketRegimeSnapshotInput) {
    const snapshot = buildMarketRegimeSnapshot(input);
    await this.prisma.marketRegimeSnapshot.createMany({
      data: [
        {
          market: snapshot.market,
          asOf: new Date(snapshot.asOf),
          marketSessionDate: snapshot.marketSessionDate,
          schemaVersion: snapshot.schemaVersion,
          regimeKey: snapshot.regimeKey,
          confidence: snapshot.confidence,
          factsJson: snapshot.facts as Prisma.InputJsonValue,
          sourceRefsJson: snapshot.sourceRefs as Prisma.InputJsonValue,
          qualityJson: snapshot.quality as Prisma.InputJsonValue,
          contentHash: snapshot.contentHash,
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.prisma.marketRegimeSnapshot.findFirstOrThrow({
      where: {
        market: snapshot.market,
        asOf: new Date(snapshot.asOf),
        schemaVersion: snapshot.schemaVersion,
        contentHash: snapshot.contentHash,
      },
      select: { id: true },
    });
    return Object.freeze({ id: row.id, ...snapshot });
  }
}
