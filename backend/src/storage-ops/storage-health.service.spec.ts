// backend/src/storage-ops/storage-health.service.spec.ts
// DAR-397: 용량 모니터 — DB/테이블 크기·오프로드 진행·객체 통계·임계 경고 단위 테스트.

import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.types';
import { StorageHealthService } from './storage-health.service';

/** count where → 분류 키. */
function classifyCount(where: Record<string, unknown> = {}): string {
  if (where.rawText) return 'remaining';
  if (where.rawTextS3Key) return 'offloaded';
  if (where.rawFilePath) return 'rawFiles';
  return 'totalDone';
}

interface Counts {
  remaining: number;
  offloaded: number;
  totalDone: number;
  rawFiles: number;
}

function makePrisma(
  counts: Counts,
  dbBytes: number,
  tables: Array<{ table: string; bytes: number }>,
): PrismaService {
  const queryRaw = jest
    .fn()
    .mockResolvedValueOnce([{ bytes: dbBytes }]) // queryDbSize
    .mockResolvedValueOnce(tables); // queryTableSizes
  const count = jest.fn(
    ({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve(counts[classifyCount(where) as keyof Counts]),
  );
  return {
    $queryRaw: queryRaw,
    disclosureDocument: { count },
  } as unknown as PrismaService;
}

function makeStorage(
  driver: 'local' | 's3',
  configured: boolean,
  stats: { objectCount: number; totalBytes: number; available: boolean },
): ObjectStorageService {
  return {
    driver,
    isConfigured: () => configured,
    stats: jest.fn(async (prefix = '') => ({ prefix, ...stats })),
  } as unknown as ObjectStorageService;
}

function makeConfig(warnBytes?: number): ConfigService {
  return {
    get: (key: string, def: unknown) =>
      key === 'LOCAL_DB_SIZE_WARN_BYTES' && warnBytes !== undefined
        ? warnBytes
        : def,
  } as unknown as ConfigService;
}

const NOW = new Date('2026-06-20T00:00:00.000Z');

describe('StorageHealthService (DAR-397)', () => {
  it('DB 크기·테이블·오프로드·객체통계를 정직하게 집계', async () => {
    const prisma = makePrisma(
      { remaining: 100, offloaded: 900, totalDone: 1000, rawFiles: 0 },
      2_000_000_000,
      [
        { table: 'stock_daily_prices', bytes: 2_000_000_000 },
        { table: 'disclosure_documents', bytes: 50_000_000 },
      ],
    );
    const storage = makeStorage('s3', true, {
      objectCount: 900,
      totalBytes: 12_345_678,
      available: true,
    });
    const svc = new StorageHealthService(prisma, storage, makeConfig());

    const health = await svc.getHealth(NOW);

    expect(health.generatedAt).toBe(NOW.toISOString());
    expect(health.database.sizeBytes).toBe(2_000_000_000);
    expect(health.database.sizePretty).toBe('1.86 GB');
    expect(health.database.tables[0]).toEqual({
      table: 'stock_daily_prices',
      totalBytes: 2_000_000_000,
      totalPretty: '1.86 GB',
    });
    expect(health.rawTextOffload).toEqual({
      remaining: 100,
      offloaded: 900,
      totalDone: 1000,
      completionRatio: 0.9, // 900/(900+100)
    });
    expect(health.objectStorage).toMatchObject({
      driver: 's3',
      configured: true,
      rawTextPrefix: 'disclosure-rawtext/',
      objectCount: 900,
      totalBytes: 12_345_678,
      statsAvailable: true,
    });
  });

  it('DB 크기 임계 초과·미오프로드·로컬원시파일 → 경고 누적', async () => {
    const prisma = makePrisma(
      { remaining: 50, offloaded: 10, totalDone: 60, rawFiles: 7 },
      6_000_000_000, // > 5GB 기본 임계
      [],
    );
    const storage = makeStorage('s3', true, {
      objectCount: 10,
      totalBytes: 1000,
      available: true,
    });
    const svc = new StorageHealthService(prisma, storage, makeConfig());

    const health = await svc.getHealth(NOW);

    expect(health.thresholds.dbOverThreshold).toBe(true);
    expect(health.thresholds.warnings).toHaveLength(3);
    expect(health.thresholds.warnings[0]).toContain('임계');
    expect(health.localArtifacts.rawFilesWithPath).toBe(7);
  });

  it('임계 이하·완전 오프로드 → 경고 없음, completionRatio 분모0이면 1', async () => {
    const prisma = makePrisma(
      { remaining: 0, offloaded: 0, totalDone: 0, rawFiles: 0 },
      1_000_000,
      [],
    );
    const storage = makeStorage('s3', true, {
      objectCount: 0,
      totalBytes: 0,
      available: true,
    });
    const svc = new StorageHealthService(prisma, storage, makeConfig());

    const health = await svc.getHealth(NOW);

    expect(health.thresholds.warnings).toHaveLength(0);
    expect(health.rawTextOffload.completionRatio).toBe(1);
  });

  it('커스텀 임계(env) 반영 + 로컬 드라이버는 objectStoreBytes 노출', async () => {
    const prisma = makePrisma(
      { remaining: 0, offloaded: 5, totalDone: 5, rawFiles: 0 },
      2_000_000,
      [],
    );
    const storage = makeStorage('local', true, {
      objectCount: 5,
      totalBytes: 4096,
      available: true,
    });
    const svc = new StorageHealthService(prisma, storage, makeConfig(1_000_000));

    const health = await svc.getHealth(NOW);

    expect(health.thresholds.dbWarnBytes).toBe(1_000_000);
    expect(health.thresholds.dbOverThreshold).toBe(true); // 2MB > 1MB
    expect(health.localArtifacts.objectStoreBytes).toBe(4096);
  });
});
