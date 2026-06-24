// backend/src/storage-ops/storage-maintenance.service.ts
// DAR-397: 디스크 회수(VACUUM)·로컬 원시 파일 정리·콜드 라이프사이클 적용.
//
// ★rawText offload(컬럼 null) 만으로는 디스크가 줄지 않는다(dead tuple). VACUUM FULL/pg_repack 으로
//   실제 회수해야 1.7GB→수십MB 가 디스크에 반영된다(전후 크기 리포트).
// ★rawFilePath 로컬 원시 HTML/XML 은 읽는 코드가 없는 순수 산출물 → S3 오프로드와 무관하게
//   삭제·컬럼 비움으로 로컬을 직접 줄인다.

import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.types';
import { RAWTEXT_LIFECYCLE_RULES } from '../common/storage/s3-backend';
import { humanBytes } from './bytes';
import {
  LifecycleApplyResult,
  LocalCleanupResult,
  VacuumResult,
} from './storage-ops.types';

/**
 * VACUUM 허용 테이블(SQL injection 방지 화이트리스트 — 물리 @@map 명).
 * 용량 큰 콜드/append 테이블만. 키=사용자 입력 alias, 값=물리 테이블명.
 */
export const VACUUM_TABLES: Record<string, string> = {
  disclosure_documents: 'disclosure_documents',
  stock_daily_prices: 'stock_daily_prices',
  stock_minute_prices: 'stock_minute_prices',
  disclosure_events: 'disclosure_events',
};

/** 로컬 정리 1회 배치 기본/최대. */
const DEFAULT_CLEANUP_LIMIT = 500;
const MAX_CLEANUP_LIMIT = 5000;

interface SizeRow {
  bytes: number;
}

@Injectable()
export class StorageMaintenanceService {
  private readonly logger = new Logger(StorageMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * VACUUM (FULL) 로 디스크 실회수. 전후 pg_total_relation_size 리포트.
   * ★full=true(기본)는 ACCESS EXCLUSIVE 락 + 테이블 재작성 → 운영자 수동·오프피크 전용.
   *   full=false 는 일반 VACUUM(락 약함·디스크 회수 제한적, dead tuple 재사용만).
   * 테이블은 화이트리스트로만 — 미허용 입력은 throw(주입 방지).
   */
  async reclaimDisk(
    tableAlias = 'disclosure_documents',
    full = true,
  ): Promise<VacuumResult> {
    const table = VACUUM_TABLES[tableAlias];
    if (!table) {
      throw new Error(
        `VACUUM 미허용 테이블: ${tableAlias} (허용: ${Object.keys(VACUUM_TABLES).join(', ')})`,
      );
    }
    const startedAt = Date.now();
    const beforeBytes = await this.tableSize(table);

    // VACUUM 은 트랜잭션 내 실행 불가 → $executeRawUnsafe 단일문(테이블은 화이트리스트 상수).
    const verb = full ? 'VACUUM (FULL, ANALYZE)' : 'VACUUM (ANALYZE)';
    this.logger.log(`${verb} ${table} 시작 (before=${humanBytes(beforeBytes)})`);
    await this.prisma.$executeRawUnsafe(`${verb} ${table}`);

    const afterBytes = await this.tableSize(table);
    const reclaimedBytes = Math.max(0, beforeBytes - afterBytes);
    const result: VacuumResult = {
      table,
      beforeBytes,
      beforePretty: humanBytes(beforeBytes),
      afterBytes,
      afterPretty: humanBytes(afterBytes),
      reclaimedBytes,
      reclaimedPretty: humanBytes(reclaimedBytes),
      full,
      durationMs: Date.now() - startedAt,
    };
    this.logger.log(
      `${verb} ${table} 완료: ${result.beforePretty}→${result.afterPretty} ` +
        `(회수 ${result.reclaimedPretty}, ${result.durationMs}ms)`,
    );
    return result;
  }

  /**
   * 로컬 원시 파일(rawFilePath) 회수 — 읽는 코드가 없는 순수 산출물.
   * DONE 문서의 rawFilePath 파일을 삭제(+컬럼 null), 빈 부모 디렉터리 정리. graceful per-file.
   * 멱등: rawFilePath=null 은 미선택 → 재실행 무해.
   */
  async cleanupLocalArtifacts(limit = DEFAULT_CLEANUP_LIMIT): Promise<LocalCleanupResult> {
    const startedAt = Date.now();
    const take = clamp(limit, 0, MAX_CLEANUP_LIMIT);

    let scanned = 0;
    let deletedFiles = 0;
    let freedBytes = 0;
    let clearedColumns = 0;

    if (take > 0) {
      const candidates = await this.prisma.disclosureDocument.findMany({
        where: {
          parseStatus: ParseStatus.DONE,
          rawFilePath: { not: null },
        },
        orderBy: { rcpNo: 'asc' },
        take,
        select: { rcpNo: true, rawFilePath: true },
      });
      scanned = candidates.length;

      for (const { rcpNo, rawFilePath } of candidates) {
        if (!rawFilePath) continue;
        try {
          const st = await fs.stat(rawFilePath).catch(() => null);
          if (st && st.isFile()) {
            freedBytes += st.size;
            await fs.unlink(rawFilePath);
            deletedFiles++;
            // 빈 부모 디렉터리(rcpNo 폴더) 정리(비어있지 않으면 무시).
            await fs.rmdir(path.dirname(rawFilePath)).catch(() => undefined);
          }
          // 파일 부재여도 컬럼은 비운다(로컬 산출물 추적 정직화).
          await this.prisma.disclosureDocument.update({
            where: { rcpNo },
            data: { rawFilePath: null },
          });
          clearedColumns++;
        } catch (err) {
          this.logger.warn(
            `로컬 원시 파일 정리 실패(보존): rcpNo=${rcpNo}: ${(err as Error).message}`,
          );
        }
      }
    }

    const remaining = await this.prisma.disclosureDocument.count({
      where: { parseStatus: ParseStatus.DONE, rawFilePath: { not: null } },
    });

    const result: LocalCleanupResult = {
      scanned,
      deletedFiles,
      freedBytes,
      freedPretty: humanBytes(freedBytes),
      clearedColumns,
      remaining,
      durationMs: Date.now() - startedAt,
    };
    this.logger.log(
      `로컬 원시 파일 정리: 스캔=${scanned}/삭제=${deletedFiles}/컬럼비움=${clearedColumns}, ` +
        `회수=${result.freedPretty}, 잔여=${remaining}`,
    );
    return result;
  }

  /**
   * 콜드 라이프사이클 적용(idempotent) — rawText 객체 prefix 의 STANDARD_IA/GLACIER 전환.
   * 로컬/미구성 드라이버는 no-op(applied=false). S3 만 실제 적용.
   */
  async applyLifecycle(): Promise<LifecycleApplyResult> {
    const applied = await this.storage.applyLifecycle(RAWTEXT_LIFECYCLE_RULES);
    return {
      driver: this.storage.driver,
      applied,
      ruleCount: RAWTEXT_LIFECYCLE_RULES.length,
      rules: RAWTEXT_LIFECYCLE_RULES.map((r) => ({
        id: r.id,
        prefix: r.prefix,
        transitions: r.transitions.map((t) => `${t.storageClass}@${t.days}d`),
      })),
    };
  }

  /** 테이블 총 크기(float8 바이트). */
  private async tableSize(table: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<SizeRow[]>(Prisma.sql`
      SELECT pg_total_relation_size(${table}::regclass)::float8 AS bytes
    `);
    return rows[0]?.bytes ?? 0;
  }
}

/** n 을 [min, max] 로 클램프. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
