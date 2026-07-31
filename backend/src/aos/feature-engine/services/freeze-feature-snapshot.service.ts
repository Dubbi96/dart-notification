import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { buildFeatureSnapshot } from '../domain/feature-snapshot';
import { CanonicalFeatureSnapshot, FeatureSnapshotInput } from '../domain/feature-snapshot.types';

/**
 * FeatureSnapshot append-only writer.
 *
 * createMany(skipDuplicates)만 사용해 DB의 UPDATE/DELETE 금지 trigger와 충돌하지 않으며,
 * 재시도는 자연키 unique index에서 멱등 처리한다.
 */
@Injectable()
export class FreezeFeatureSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async freeze(input: FeatureSnapshotInput): Promise<CanonicalFeatureSnapshot> {
    const snapshot = buildFeatureSnapshot(input);
    await this.persist(snapshot);
    return snapshot;
  }

  async freezeWithId(
    input: FeatureSnapshotInput,
  ): Promise<CanonicalFeatureSnapshot & { readonly id: string }> {
    const snapshot = buildFeatureSnapshot(input);
    await this.persist(snapshot);
    const row = await this.prisma.featureSnapshot.findFirstOrThrow({
      where: {
        instrumentType: snapshot.instrumentType,
        corpCode: snapshot.corpCode,
        stockCode: snapshot.stockCode,
        asOf: new Date(snapshot.asOf),
        schemaVersion: snapshot.schemaVersion,
        contentHash: snapshot.contentHash,
      },
      select: { id: true },
    });
    return Object.freeze({ id: row.id, ...snapshot });
  }

  private async persist(snapshot: CanonicalFeatureSnapshot): Promise<void> {
    await this.prisma.featureSnapshot.createMany({
      data: [
        {
          instrumentType: snapshot.instrumentType,
          corpCode: snapshot.corpCode,
          stockCode: snapshot.stockCode,
          asOf: new Date(snapshot.asOf),
          marketSessionDate: snapshot.marketSessionDate,
          schemaVersion: snapshot.schemaVersion,
          featuresJson: snapshot.features as unknown as Prisma.InputJsonValue,
          sourceRefsJson: snapshot.sourceRefs as unknown as Prisma.InputJsonValue,
          qualityJson: snapshot.quality as unknown as Prisma.InputJsonValue,
          contentHash: snapshot.contentHash,
        },
      ],
      skipDuplicates: true,
    });
  }
}
