// backend/src/storage-ops/storage-health.service.ts
// DAR-397: 용량 모니터링 — DB 크기·테이블별·rawText 오프로드 진행·객체 스토리지 용량·로컬 임계 경고.
//
// read-only. 멀티이어 백필로 데이터가 폭증해도 로컬이 비대해지지 않는지 한눈에 본다.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.types';
import { humanBytes } from './bytes';
import { StorageHealth, TableSize } from './storage-ops.types';

/** rawText 객체 prefix(RawTextStoreService.keyFor 규약과 일치). */
const RAWTEXT_PREFIX = 'disclosure-rawtext/';

/** 로컬 DB 크기 경고 기본 임계(5GB). env LOCAL_DB_SIZE_WARN_BYTES 로 덮어쓰기. */
const DEFAULT_DB_WARN_BYTES = 5 * 1024 * 1024 * 1024;

/** 용량 상위 테이블 표시 개수. */
const TOP_TABLES = 12;

/** $queryRaw float8 행(2GB+ 안전: float8 은 2^53 까지 정수 정확). */
interface DbSizeRow {
  bytes: number;
}
interface TableSizeRow {
  table: string;
  bytes: number;
}

@Injectable()
export class StorageHealthService {
  private readonly logger = new Logger(StorageHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly config: ConfigService,
  ) {}

  /** 용량 모니터 단일 스냅샷(read-only). */
  async getHealth(now: Date = new Date()): Promise<StorageHealth> {
    const [dbSize, tables, offload, objectStats, rawFilesWithPath] =
      await Promise.all([
        this.queryDbSize(),
        this.queryTableSizes(),
        this.queryOffloadProgress(),
        this.storage.stats(RAWTEXT_PREFIX),
        this.prisma.disclosureDocument.count({
          where: { rawFilePath: { not: null } },
        }),
      ]);

    const dbWarnBytes = this.config.get<number>(
      'LOCAL_DB_SIZE_WARN_BYTES',
      DEFAULT_DB_WARN_BYTES,
    );
    const dbOverThreshold = dbSize > dbWarnBytes;

    const warnings: string[] = [];
    if (dbOverThreshold) {
      warnings.push(
        `로컬 DB 크기 ${humanBytes(dbSize)} 가 임계 ${humanBytes(dbWarnBytes)} 초과 — ` +
          `오프로드 드레인/VACUUM 점검 필요.`,
      );
    }
    if (offload.remaining > 0 && this.storage.isConfigured()) {
      warnings.push(
        `미오프로드 rawText 문서 ${offload.remaining}건 잔존 — 드레이너 진행 중(완료율 ${Math.round(
          offload.completionRatio * 100,
        )}%).`,
      );
    }
    if (rawFilesWithPath > 0) {
      warnings.push(
        `로컬 원시 파일(rawFilePath) ${rawFilesWithPath}건 잔존 — cleanup-local-artifacts 로 회수 가능.`,
      );
    }

    return {
      generatedAt: now.toISOString(),
      database: {
        sizeBytes: dbSize,
        sizePretty: humanBytes(dbSize),
        tables,
      },
      rawTextOffload: offload,
      objectStorage: {
        driver: this.storage.driver,
        configured: this.storage.isConfigured(),
        rawTextPrefix: RAWTEXT_PREFIX,
        objectCount: objectStats.objectCount,
        totalBytes: objectStats.totalBytes,
        totalPretty: humanBytes(objectStats.totalBytes),
        statsAvailable: objectStats.available,
      },
      localArtifacts: {
        rawFilesWithPath,
        objectStoreBytes:
          this.storage.driver === 'local' ? objectStats.totalBytes : 0,
      },
      thresholds: {
        dbWarnBytes,
        dbOverThreshold,
        warnings,
      },
    };
  }

  /** 전체 DB 크기(float8 바이트). */
  private async queryDbSize(): Promise<number> {
    const rows = await this.prisma.$queryRaw<DbSizeRow[]>(Prisma.sql`
      SELECT pg_database_size(current_database())::float8 AS bytes
    `);
    return rows[0]?.bytes ?? 0;
  }

  /** 용량 상위 테이블(테이블+인덱스+TOAST 총합, desc). */
  private async queryTableSizes(): Promise<TableSize[]> {
    const rows = await this.prisma.$queryRaw<TableSizeRow[]>(Prisma.sql`
      SELECT c.relname AS "table",
             pg_total_relation_size(c.oid)::float8 AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT ${TOP_TABLES}
    `);
    return rows.map((r) => ({
      table: r.table,
      totalBytes: r.bytes,
      totalPretty: humanBytes(r.bytes),
    }));
  }

  /** rawText 오프로드 진행(prisma 카운트 — drain 서비스와 동일 게이트). */
  private async queryOffloadProgress(): Promise<
    StorageHealth['rawTextOffload']
  > {
    const [remaining, offloaded, totalDone] = await Promise.all([
      this.prisma.disclosureDocument.count({
        where: { parseStatus: ParseStatus.DONE, rawText: { not: null } },
      }),
      this.prisma.disclosureDocument.count({
        where: { rawTextS3Key: { not: null } },
      }),
      this.prisma.disclosureDocument.count({
        where: { parseStatus: ParseStatus.DONE },
      }),
    ]);
    const denom = offloaded + remaining;
    return {
      remaining,
      offloaded,
      totalDone,
      completionRatio:
        denom > 0 ? Math.round((offloaded / denom) * 100) / 100 : 1,
    };
  }
}
