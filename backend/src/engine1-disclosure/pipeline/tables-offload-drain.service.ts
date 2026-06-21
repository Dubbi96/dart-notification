// backend/src/engine1-disclosure/pipeline/tables-offload-drain.service.ts
// DAR-399: 기존 ~1.6GB tables JSONB → 객체 스토리지(S3/로컬) 백그라운드 마이그레이션 드레이너.
//
// 신규 파싱분은 파싱 완료 시점에 곧바로 오프로드되지만(disclosure-documents.service), 이미 DB 에
// 쌓인 과거 tables(58k 문서·~1.6GB)는 본 드레이너가 점진·재개가능하게 옮긴 뒤 컬럼을 비운다(DB 경량화).
// 디스크 회수(VACUUM)는 운영 단계(docs/deployment.md). 멱등: 동일 rcpNo 재오프로드는 같은 키 덮어쓰기.
// rawText 오프로드 드레이너(DAR-395)와 동일 설계 — tables 가 TOAST 의 진짜 bulk.

import { Injectable, Logger } from '@nestjs/common';
import { ParseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TablesStoreService } from '../../common/storage/tables-store.service';

/** 1회 드레인 기본/최대 배치(객체 업로드 비용·DB 부하 균형). */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** 오프로드 드레인 1회 결과(관측·테스트·recorder itemCount). 정직 로그. */
export interface TablesOffloadDrainResult {
  /** 이번 배치에서 오프로드 시도한 (tables 보유) 문서 수. */
  scanned: number;
  /** 오프로드 성공(tables 비움 + 키 저장) 건수. */
  offloaded: number;
  /** 오프로드 실패(스토리지 오류 — tables 보존) 건수. */
  failed: number;
  /** 잔여(정직 진행성): 아직 tables 컬럼이 남은 문서 수. */
  remaining: number;
  /** 누적 오프로드 완료(tablesS3Key 보유) 문서 수. */
  totalOffloaded: number;
  /** 활성 스토리지 드라이버('s3'|'local'). 폴백 여부 표면화. */
  driver: string;
  /** 외부 스토리지(S3) 구성 여부. */
  storageConfigured: boolean;
  /** 소요(ms). */
  durationMs: number;
}

/** 오프로드 진행 리포트(read-only). */
export interface TablesOffloadProgress {
  generatedAt: string;
  /** tables 컬럼이 남은(미오프로드) DONE 문서 수. */
  remaining: number;
  /** tablesS3Key 보유(오프로드 완료) 문서 수. */
  offloaded: number;
  /** 전체 DONE 문서 수(분모). */
  totalDone: number;
  /** offloaded / (offloaded + remaining), 0~1 소수 둘째자리. 분모 0이면 1. */
  completionRatio: number;
  driver: string;
  storageConfigured: boolean;
}

/** drainOnce 옵션 — 수동/테스트 한도 덮어쓰기. */
export interface TablesOffloadDrainOptions {
  limit?: number;
}

/**
 * TablesOffloadDrainService (DAR-399) — 과거 tables 객체 스토리지 이전 드레이너.
 *
 * ★대상: parseStatus=DONE 이고 tables 가 남은(미오프로드) 문서. rcpNo 오름차순 커서로 재개가능.
 * ★멱등: offload(rcpNo) 는 동일 키 덮어쓰기 → 재실행 무해. 컬럼 비우기는 1회성(이미 null 이면 미선택).
 * ★graceful: 한 건 오프로드 실패가 배치를 깨지 않는다(tables 보존 후 다음 건 진행).
 * ★점진: 1회 배치 상한 → 일/분 배치로 1.6GB 를 나눠 옮긴다(즉시 전량 불가, remaining 으로 정직 표기).
 */
@Injectable()
export class TablesOffloadDrainService {
  private readonly logger = new Logger(TablesOffloadDrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tablesStore: TablesStoreService,
  ) {}

  /** 1회 드레인 — tables 보유 DONE 문서를 배치만큼 객체 스토리지로 오프로드 후 컬럼 비움. */
  async drainOnce(
    options: TablesOffloadDrainOptions = {},
  ): Promise<TablesOffloadDrainResult> {
    const startedAt = Date.now();
    const limit = clamp(options.limit ?? DEFAULT_LIMIT, 0, MAX_LIMIT);

    let scanned = 0;
    let offloaded = 0;
    let failed = 0;

    if (limit > 0) {
      const candidates = await this.prisma.disclosureDocument.findMany({
        where: {
          parseStatus: ParseStatus.DONE,
          tables: { not: Prisma.DbNull },
        },
        orderBy: { rcpNo: 'asc' },
        take: limit,
        select: { rcpNo: true, tables: true },
      });
      scanned = candidates.length;

      for (const { rcpNo, tables } of candidates) {
        if (tables == null) continue; // 방어(where 가 보장하지만 타입 좁히기)
        try {
          const key = await this.tablesStore.offload(rcpNo, tables);
          await this.prisma.disclosureDocument.update({
            where: { rcpNo },
            data: { tables: Prisma.DbNull, tablesS3Key: key },
          });
          offloaded++;
        } catch (err) {
          failed++;
          this.logger.warn(
            `tables 오프로드 실패(보존·재시도 예정): rcpNo=${rcpNo}: ${(err as Error).message}`,
          );
        }
      }
    }

    const [remaining, totalOffloaded] = await Promise.all([
      this.prisma.disclosureDocument.count({
        where: { parseStatus: ParseStatus.DONE, tables: { not: Prisma.DbNull } },
      }),
      this.prisma.disclosureDocument.count({
        where: { tablesS3Key: { not: null } },
      }),
    ]);

    const result: TablesOffloadDrainResult = {
      scanned,
      offloaded,
      failed,
      remaining,
      totalOffloaded,
      driver: this.tablesStore.driver,
      storageConfigured: this.tablesStore.isConfigured(),
      durationMs: Date.now() - startedAt,
    };

    this.logger.log(
      `tables 오프로드 드레인 완료: 스캔=${scanned}/성공=${offloaded}/실패=${failed}, ` +
        `잔여=${remaining}, 누적오프로드=${totalOffloaded}, 드라이버=${result.driver}, ` +
        `소요=${result.durationMs}ms`,
    );

    return result;
  }

  /** 오프로드 진행 리포트(read-only). */
  async getProgress(now: Date = new Date()): Promise<TablesOffloadProgress> {
    const [remaining, offloaded, totalDone] = await Promise.all([
      this.prisma.disclosureDocument.count({
        where: { parseStatus: ParseStatus.DONE, tables: { not: Prisma.DbNull } },
      }),
      this.prisma.disclosureDocument.count({
        where: { tablesS3Key: { not: null } },
      }),
      this.prisma.disclosureDocument.count({
        where: { parseStatus: ParseStatus.DONE },
      }),
    ]);
    const denom = offloaded + remaining;
    return {
      generatedAt: now.toISOString(),
      remaining,
      offloaded,
      totalDone,
      completionRatio: denom > 0 ? Math.round((offloaded / denom) * 100) / 100 : 1,
      driver: this.tablesStore.driver,
      storageConfigured: this.tablesStore.isConfigured(),
    };
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** n 을 [min, max] 로 클램프(정수 가정). */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
