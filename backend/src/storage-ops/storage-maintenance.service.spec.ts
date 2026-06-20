// backend/src/storage-ops/storage-maintenance.service.spec.ts
// DAR-397: 디스크 회수(VACUUM 화이트리스트·전후 리포트)·로컬 정리·라이프사이클 단위 테스트.

const fsMock = {
  stat: jest.fn(),
  unlink: jest.fn(),
  rmdir: jest.fn(),
};
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: fsMock,
}));

import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.types';
import { RAWTEXT_LIFECYCLE_RULES } from '../common/storage/s3-backend';
import { StorageMaintenanceService } from './storage-maintenance.service';

function makeStorage(driver: 'local' | 's3', applied: boolean) {
  const applyLifecycle = jest.fn(async () => applied);
  return {
    storage: { driver, applyLifecycle } as unknown as ObjectStorageService,
    applyLifecycle,
  };
}

describe('StorageMaintenanceService (DAR-397)', () => {
  beforeEach(() => {
    fsMock.stat.mockReset();
    fsMock.unlink.mockReset();
    fsMock.rmdir.mockReset();
  });

  describe('reclaimDisk (VACUUM)', () => {
    it('화이트리스트 외 테이블은 throw(주입 방지)', async () => {
      const prisma = {} as unknown as PrismaService;
      const svc = new StorageMaintenanceService(
        prisma,
        makeStorage('local', false).storage,
      );
      await expect(svc.reclaimDisk('users')).rejects.toThrow('미허용');
      await expect(svc.reclaimDisk('disclosure_documents; DROP')).rejects.toThrow(
        '미허용',
      );
    });

    it('VACUUM FULL 실행 + 전후 크기로 회수 바이트 산출', async () => {
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ bytes: 1_700_000_000 }]) // before
        .mockResolvedValueOnce([{ bytes: 40_000_000 }]); // after
      const executeRawUnsafe = jest.fn().mockResolvedValue(0);
      const prisma = {
        $queryRaw: queryRaw,
        $executeRawUnsafe: executeRawUnsafe,
      } as unknown as PrismaService;
      const svc = new StorageMaintenanceService(
        prisma,
        makeStorage('local', false).storage,
      );

      const res = await svc.reclaimDisk('disclosure_documents', true);

      expect(executeRawUnsafe).toHaveBeenCalledWith(
        'VACUUM (FULL, ANALYZE) disclosure_documents',
      );
      expect(res.beforeBytes).toBe(1_700_000_000);
      expect(res.afterBytes).toBe(40_000_000);
      expect(res.reclaimedBytes).toBe(1_660_000_000);
      expect(res.reclaimedPretty).toBe('1.55 GB');
      expect(res.full).toBe(true);
    });

    it('full=false 는 일반 VACUUM(락 약함)', async () => {
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ bytes: 100 }])
        .mockResolvedValueOnce([{ bytes: 100 }]);
      const executeRawUnsafe = jest.fn().mockResolvedValue(0);
      const prisma = {
        $queryRaw: queryRaw,
        $executeRawUnsafe: executeRawUnsafe,
      } as unknown as PrismaService;
      const svc = new StorageMaintenanceService(
        prisma,
        makeStorage('local', false).storage,
      );

      const res = await svc.reclaimDisk('disclosure_documents', false);
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        'VACUUM (ANALYZE) disclosure_documents',
      );
      expect(res.reclaimedBytes).toBe(0); // 회수 음수 가드
    });
  });

  describe('cleanupLocalArtifacts', () => {
    it('로컬 원시 파일 삭제 + 컬럼 비움 + 회수 바이트 합산', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { rcpNo: 'A', rawFilePath: '/s/A/index.html' },
        { rcpNo: 'B', rawFilePath: '/s/B/index.html' },
      ]);
      const update = jest.fn().mockResolvedValue({});
      const count = jest.fn().mockResolvedValue(0);
      const prisma = {
        disclosureDocument: { findMany, update, count },
      } as unknown as PrismaService;

      fsMock.stat.mockResolvedValue({ isFile: () => true, size: 1024 });
      fsMock.unlink.mockResolvedValue(undefined);
      fsMock.rmdir.mockResolvedValue(undefined);

      const svc = new StorageMaintenanceService(
        prisma,
        makeStorage('local', false).storage,
      );
      const res = await svc.cleanupLocalArtifacts(100);

      expect(res.scanned).toBe(2);
      expect(res.deletedFiles).toBe(2);
      expect(res.freedBytes).toBe(2048);
      expect(res.clearedColumns).toBe(2);
      expect(res.remaining).toBe(0);
      expect(fsMock.unlink).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith({
        where: { rcpNo: 'A' },
        data: { rawFilePath: null },
      });
    });

    it('파일 부재여도 컬럼은 비운다(정직화·삭제는 0)', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([{ rcpNo: 'A', rawFilePath: '/gone/index.html' }]);
      const update = jest.fn().mockResolvedValue({});
      const count = jest.fn().mockResolvedValue(0);
      const prisma = {
        disclosureDocument: { findMany, update, count },
      } as unknown as PrismaService;

      fsMock.stat.mockRejectedValue(new Error('ENOENT'));

      const svc = new StorageMaintenanceService(
        prisma,
        makeStorage('local', false).storage,
      );
      const res = await svc.cleanupLocalArtifacts();

      expect(res.deletedFiles).toBe(0);
      expect(res.clearedColumns).toBe(1);
      expect(fsMock.unlink).not.toHaveBeenCalled();
    });

    it('limit=0 은 스캔 없이 잔여만 조회', async () => {
      const findMany = jest.fn();
      const count = jest.fn().mockResolvedValue(42);
      const prisma = {
        disclosureDocument: { findMany, count, update: jest.fn() },
      } as unknown as PrismaService;
      const svc = new StorageMaintenanceService(
        prisma,
        makeStorage('local', false).storage,
      );
      const res = await svc.cleanupLocalArtifacts(0);
      expect(findMany).not.toHaveBeenCalled();
      expect(res.scanned).toBe(0);
      expect(res.remaining).toBe(42);
    });
  });

  describe('applyLifecycle', () => {
    it('S3 드라이버 → 적용(applied=true) + 규칙 요약', async () => {
      const { storage, applyLifecycle } = makeStorage('s3', true);
      const svc = new StorageMaintenanceService(
        {} as unknown as PrismaService,
        storage,
      );
      const res = await svc.applyLifecycle();

      expect(applyLifecycle).toHaveBeenCalledWith(RAWTEXT_LIFECYCLE_RULES);
      expect(res.applied).toBe(true);
      expect(res.driver).toBe('s3');
      expect(res.ruleCount).toBe(RAWTEXT_LIFECYCLE_RULES.length);
      expect(res.rules[0].transitions).toEqual([
        'STANDARD_IA@30d',
        'GLACIER@90d',
      ]);
    });

    it('로컬 드라이버 → no-op(applied=false)', async () => {
      const { storage } = makeStorage('local', false);
      const svc = new StorageMaintenanceService(
        {} as unknown as PrismaService,
        storage,
      );
      const res = await svc.applyLifecycle();
      expect(res.applied).toBe(false);
      expect(res.driver).toBe('local');
    });
  });
});
