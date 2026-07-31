import { ConfigService } from '@nestjs/config';

import { FeatureSnapshotDualWriteService } from './feature-snapshot-dual-write.service';

const snapshotInput = {
  corpCode: '00126380',
  stockCode: '005930',
  asOf: new Date('2026-07-31T10:05:00.000Z'),
  marketSessionDate: '20260731',
  schemaVersion: 'legacy-buy-score.v1',
  features: { scoreInput: 1 },
  sourceRefs: { price: '005930:20260731' },
  quality: { missingFeatureKeys: [], staleFeatureKeys: [], validationErrors: [] },
} as const;

describe('FeatureSnapshotDualWriteService', () => {
  it('flag 기본 OFF이면 DB writer를 호출하지 않는다', async () => {
    const freezer = { freezeWithId: jest.fn() } as any;
    const config = { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService;
    const service = new FeatureSnapshotDualWriteService(config, freezer);

    expect(service.isEnabled()).toBe(false);
    await expect(service.tryFreeze(snapshotInput)).resolves.toEqual({ status: 'DISABLED' });
    expect(freezer.freezeWithId).not.toHaveBeenCalled();
  });

  it('flag ON이면 snapshot hash를 반환한다', async () => {
    const freezer = {
      freezeWithId: jest.fn().mockResolvedValue({ id: 'feature-1', contentHash: 'a'.repeat(64) }),
    } as any;
    const config = { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService;
    const service = new FeatureSnapshotDualWriteService(config, freezer);

    expect(service.isEnabled()).toBe(true);
    await expect(service.tryFreeze(snapshotInput)).resolves.toEqual({
      status: 'WRITTEN',
      snapshotId: 'feature-1',
      contentHash: 'a'.repeat(64),
    });
  });

  it('writer 실패를 격리해 legacy 경로에 예외를 전파하지 않는다', async () => {
    const freezer = {
      freezeWithId: jest.fn().mockRejectedValue(new Error('sensitive db detail')),
    } as any;
    const config = { get: jest.fn().mockReturnValue(true) } as unknown as ConfigService;
    const service = new FeatureSnapshotDualWriteService(config, freezer);

    await expect(service.tryFreeze(snapshotInput)).resolves.toEqual({ status: 'FAILED' });
  });
});
