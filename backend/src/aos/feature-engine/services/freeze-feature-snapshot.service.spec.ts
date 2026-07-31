import { FreezeFeatureSnapshotService } from './freeze-feature-snapshot.service';

describe('FreezeFeatureSnapshotService', () => {
  it('append-only createMany(skipDuplicates)로 동일 snapshot 재시도를 멱등 처리한다', async () => {
    const rows = new Set<string>();
    const createMany = jest.fn(async ({ data, skipDuplicates }: any) => {
      expect(skipDuplicates).toBe(true);
      for (const row of data) rows.add(row.contentHash);
      return { count: 1 };
    });
    const prisma = {
      featureSnapshot: {
        createMany,
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'feature-1' }),
      },
    } as any;
    const service = new FreezeFeatureSnapshotService(prisma);
    const value = {
      corpCode: '00126380',
      stockCode: '005930',
      asOf: new Date('2026-07-31T10:05:00.000Z'),
      marketSessionDate: '20260731',
      schemaVersion: 'legacy-buy-score.v1',
      features: { scoreInput: 1 },
      sourceRefs: { price: '005930:20260731' },
      quality: { missingFeatureKeys: [], staleFeatureKeys: [], validationErrors: [] },
    } as const;

    const first = await service.freeze(value);
    const second = await service.freeze(value);

    expect(second.contentHash).toBe(first.contentHash);
    expect(rows.size).toBe(1);
    expect(createMany).toHaveBeenCalledTimes(2);
    expect((prisma.featureSnapshot as any).update).toBeUndefined();
    expect((prisma.featureSnapshot as any).delete).toBeUndefined();

    await expect(service.freezeWithId(value)).resolves.toEqual(
      expect.objectContaining({ id: 'feature-1', contentHash: first.contentHash }),
    );
  });
});
