// backend/src/engine1-disclosure/pipeline/tables-offload-drain.service.spec.ts
// DAR-399: tables 오프로드 드레이너 — 배치 오프로드/컬럼 비우기(DbNull)/실패 graceful/진행 리포트.

import { ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TablesStoreService } from '../../common/storage/tables-store.service';
import { TablesOffloadDrainService } from './tables-offload-drain.service';

describe('TablesOffloadDrainService (DAR-399)', () => {
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
  let service: TablesOffloadDrainService;

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
    service = new TablesOffloadDrainService(
      prisma as unknown as PrismaService,
      store as unknown as TablesStoreService,
    );
  });

  it('DONE+tables 보유 문서를 오프로드하고 컬럼을 DbNull 로 비운다(키 저장)', async () => {
    prisma.disclosureDocument.findMany.mockResolvedValue([
      { rcpNo: 'r1', tables: [{ rows: [['a']] }] },
      { rcpNo: 'r2', tables: [{ rows: [['b']] }] },
    ]);
    store.offload
      .mockResolvedValueOnce('disclosure-tables/r1.json.gz')
      .mockResolvedValueOnce('disclosure-tables/r2.json.gz');
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(0) // remaining
      .mockResolvedValueOnce(2); // totalOffloaded

    const res = await service.drainOnce({ limit: 10 });

    expect(res.scanned).toBe(2);
    expect(res.offloaded).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.remaining).toBe(0);
    expect(res.totalOffloaded).toBe(2);
    expect(store.offload).toHaveBeenCalledTimes(2);
    // tables=DbNull(SQL NULL) + 키 저장 — TOAST 회수 대상화.
    expect(prisma.disclosureDocument.update).toHaveBeenCalledWith({
      where: { rcpNo: 'r1' },
      data: { tables: Prisma.DbNull, tablesS3Key: 'disclosure-tables/r1.json.gz' },
    });
    // 대상 쿼리는 DONE + tables not DbNull.
    expect(prisma.disclosureDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parseStatus: ParseStatus.DONE, tables: { not: Prisma.DbNull } },
        orderBy: { rcpNo: 'asc' },
        take: 10,
      }),
    );
  });

  it('오프로드 실패는 graceful — 해당 건 컬럼 보존(update 안 함), 다음 건 진행', async () => {
    prisma.disclosureDocument.findMany.mockResolvedValue([
      { rcpNo: 'bad', tables: [{ rows: [['x']] }] },
      { rcpNo: 'ok', tables: [{ rows: [['y']] }] },
    ]);
    store.offload
      .mockRejectedValueOnce(new Error('S3 down'))
      .mockResolvedValueOnce('disclosure-tables/ok.json.gz');
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(1) // remaining(bad 남음)
      .mockResolvedValueOnce(1);

    const res = await service.drainOnce({ limit: 10 });

    expect(res.offloaded).toBe(1);
    expect(res.failed).toBe(1);
    expect(prisma.disclosureDocument.update).toHaveBeenCalledTimes(1);
    expect(prisma.disclosureDocument.update).toHaveBeenCalledWith({
      where: { rcpNo: 'ok' },
      data: { tables: Prisma.DbNull, tablesS3Key: 'disclosure-tables/ok.json.gz' },
    });
  });

  it('limit=0 → 스캔/오프로드 없이 진행 카운트만 보고(부하 0)', async () => {
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(58123) // remaining
      .mockResolvedValueOnce(0); // totalOffloaded

    const res = await service.drainOnce({ limit: 0 });

    expect(res.scanned).toBe(0);
    expect(res.offloaded).toBe(0);
    expect(res.remaining).toBe(58123);
    expect(prisma.disclosureDocument.findMany).not.toHaveBeenCalled();
    expect(store.offload).not.toHaveBeenCalled();
  });

  it('getProgress: 완료율 = offloaded/(offloaded+remaining)', async () => {
    prisma.disclosureDocument.count
      .mockResolvedValueOnce(25) // remaining
      .mockResolvedValueOnce(75) // offloaded
      .mockResolvedValueOnce(100); // totalDone

    const p = await service.getProgress(new Date('2026-06-21T00:00:00Z'));

    expect(p.remaining).toBe(25);
    expect(p.offloaded).toBe(75);
    expect(p.completionRatio).toBe(0.75);
    expect(p.driver).toBe('local');
    expect(p.storageConfigured).toBe(true);
  });
});
