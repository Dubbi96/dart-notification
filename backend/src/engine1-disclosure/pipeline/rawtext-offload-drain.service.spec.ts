// backend/src/engine1-disclosure/pipeline/rawtext-offload-drain.service.spec.ts
// DAR-395: rawText 오프로드 드레이너 — 배치 오프로드/컬럼 비우기/실패 graceful/진행 리포트.

import { ParseStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RawTextStoreService } from '../../common/storage/raw-text-store.service';
import { RawTextOffloadDrainService } from './rawtext-offload-drain.service';

describe('RawTextOffloadDrainService (DAR-395)', () => {
  let prisma: {
    disclosureDocument: {
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };
  let store: {
    offload: jest.Mock;
    driver: string;
    isConfigured: jest.Mock;
  };
  let service: RawTextOffloadDrainService;

  beforeEach(() => {
    prisma = {
      disclosureDocument: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    store = {
      offload: jest.fn(),
      driver: 'local',
      isConfigured: jest.fn().mockReturnValue(true),
    };
    service = new RawTextOffloadDrainService(
      prisma as unknown as PrismaService,
      store as unknown as RawTextStoreService,
    );
  });

  it('DONE+rawText 보유 문서를 오프로드하고 컬럼을 비운다(키 저장)', async () => {
    prisma.disclosureDocument.findMany.mockResolvedValue([
      { rcpNo: 'r1', rawText: '원문1' },
      { rcpNo: 'r2', rawText: '원문2' },
    ]);
    store.offload
      .mockResolvedValueOnce('disclosure-rawtext/r1.txt.gz')
      .mockResolvedValueOnce('disclosure-rawtext/r2.txt.gz');
    // remaining=0, totalOffloaded=2
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2);

    const res = await service.drainOnce({ limit: 10 });

    expect(res.scanned).toBe(2);
    expect(res.offloaded).toBe(2);
    expect(res.failed).toBe(0);
    expect(store.offload).toHaveBeenCalledTimes(2);
    // 각 문서 rawText=null + 키 저장으로 update.
    expect(prisma.disclosureDocument.update).toHaveBeenCalledWith({
      where: { rcpNo: 'r1' },
      data: { rawText: null, rawTextS3Key: 'disclosure-rawtext/r1.txt.gz' },
    });
    // 대상 쿼리는 DONE + rawText not null.
    expect(prisma.disclosureDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parseStatus: ParseStatus.DONE, rawText: { not: null } },
        orderBy: { rcpNo: 'asc' },
      }),
    );
  });

  it('한 건 오프로드 실패는 배치를 깨지 않고 rawText 보존(컬럼 미변경)', async () => {
    prisma.disclosureDocument.findMany.mockResolvedValue([
      { rcpNo: 'ok', rawText: 'a' },
      { rcpNo: 'bad', rawText: 'b' },
    ]);
    store.offload
      .mockResolvedValueOnce('disclosure-rawtext/ok.txt.gz')
      .mockRejectedValueOnce(new Error('S3 down'));
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(1) // remaining(아직 bad 남음)
      .mockResolvedValueOnce(1);

    const res = await service.drainOnce({ limit: 10 });

    expect(res.offloaded).toBe(1);
    expect(res.failed).toBe(1);
    // 실패 건은 update 호출 안 함(rawText 보존) → 성공 건만 update.
    expect(prisma.disclosureDocument.update).toHaveBeenCalledTimes(1);
    expect(prisma.disclosureDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rcpNo: 'ok' } }),
    );
  });

  it('limit=0 이면 스캔/오프로드 0(잔여만 집계)', async () => {
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    const res = await service.drainOnce({ limit: 0 });
    expect(res.scanned).toBe(0);
    expect(res.offloaded).toBe(0);
    expect(prisma.disclosureDocument.findMany).not.toHaveBeenCalled();
    expect(res.remaining).toBe(5);
  });

  it('드라이버/구성 상태를 결과에 정직 표기', async () => {
    prisma.disclosureDocument.findMany.mockResolvedValue([]);
    const res = await service.drainOnce();
    expect(res.driver).toBe('local');
    expect(res.storageConfigured).toBe(true);
  });

  describe('getProgress', () => {
    it('잔여/오프로드/완료율을 계산한다', async () => {
      // remaining=20, offloaded=80, totalDone=100
      prisma.disclosureDocument.count
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(100);
      const p = await service.getProgress(new Date('2026-06-20T00:00:00Z'));
      expect(p.remaining).toBe(20);
      expect(p.offloaded).toBe(80);
      expect(p.totalDone).toBe(100);
      expect(p.completionRatio).toBe(0.8); // 80/(80+20)
      expect(p.driver).toBe('local');
    });

    it('분모 0이면 완료율 1(옮길 게 없음)', async () => {
      prisma.disclosureDocument.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      const p = await service.getProgress();
      expect(p.completionRatio).toBe(1);
    });
  });
});
