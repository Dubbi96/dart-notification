// backend/src/common/storage/tables-store.service.ts
// DAR-399: 공시 파싱 표(DisclosureDocument.tables) 오프로드 스토어 — 쓰기(오프로드)·읽기(lazy fetch)
//          의 단일 출처. engine1(파싱 완료 시 즉시 오프로드 / 과거분 드레인 / SHARE_BUYBACK 폴백
//          스캔 lazy fetch)이 공유한다. rawText 오프로드(RawTextStoreService)와 동일 설계.
//
// 키 규약: disclosure-tables/{rcpNo}.json.gz (JSON 직렬화 후 gzip). DB 는 tablesS3Key 포인터만 보유.
// ★tables 가 disclosure_documents TOAST 의 진짜 bulk(실측 ~1.6GB)다 — rawText offload(DAR-395)는 부분.

import { Injectable, Logger } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.types';

/** load() 입력 — 컬럼(tables)이 남아있으면 우선, 없으면 포인터(tablesS3Key) lazy fetch. */
export interface TablesRef {
  rcpNo: string;
  /** DB tables 컬럼(미오프로드분). 배열이면 그대로 사용. */
  tables?: unknown;
  /** 오프로드된 tables 객체 키. */
  tablesS3Key?: string | null;
}

/** 읽기 캐시 상한(콜드 표 — 재추출/폴백 배치 중 동일 rcpNo 반복조회 흡수). 표는 rawText보다
 *  크므로(평균 ~28KB) 캐시를 작게 둔다. */
const READ_CACHE_MAX = 64;

@Injectable()
export class TablesStoreService {
  private readonly logger = new Logger(TablesStoreService.name);
  /** 단순 LRU 근사(삽입순 Map, 초과 시 가장 오래된 항목 제거). 파싱된 배열을 보관. */
  private readonly readCache = new Map<string, unknown>();

  constructor(private readonly storage: ObjectStorageService) {}

  /** rcpNo → 객체 키(SSOT). 정적이라 다른 모듈도 키를 재현할 수 있다. */
  static keyFor(rcpNo: string): string {
    return `disclosure-tables/${rcpNo}.json.gz`;
  }

  /** 활성 스토리지 드라이버(관측). */
  get driver(): string {
    return this.storage.driver;
  }

  /** 외부 스토리지(S3) 구성 여부(관측·진단). */
  isConfigured(): boolean {
    return this.storage.isConfigured();
  }

  /**
   * 표 오프로드(JSON 직렬화 + gzip 업로드). 반환 키를 DB tablesS3Key 에 저장하고 tables 컬럼은 비운다.
   * 멱등: 동일 rcpNo 재오프로드는 같은 키 덮어쓰기. 실패 시 throw(호출측이 DB tables 보존 결정).
   */
  async offload(rcpNo: string, tables: unknown): Promise<string> {
    const key = TablesStoreService.keyFor(rcpNo);
    const json = JSON.stringify(tables ?? []);
    await this.storage.put(key, json, {
      compress: true,
      contentType: 'application/json; charset=utf-8',
    });
    this.readCache.set(key, tables);
    this.trimCache();
    return key;
  }

  /**
   * 표 조회(읽기 경로). tables 컬럼이 배열로 남아있으면 그대로(미오프로드분), 아니면 포인터로 lazy fetch.
   * 둘 다 없거나 fetch/parse 실패면 null(graceful — 호출측이 빈 입력으로 진행: 폴백 스캔만 비활성).
   */
  async load(ref: TablesRef): Promise<unknown | null> {
    if (Array.isArray(ref.tables)) {
      return ref.tables;
    }
    const key = ref.tablesS3Key;
    if (!key) {
      return null;
    }
    const cached = this.readCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const json = await this.storage.get(key);
      const parsed = JSON.parse(json) as unknown;
      this.readCache.set(key, parsed);
      this.trimCache();
      return parsed;
    } catch (err) {
      this.logger.warn(
        `tables lazy fetch 실패: rcpNo=${ref.rcpNo} key=${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private trimCache(): void {
    while (this.readCache.size > READ_CACHE_MAX) {
      const oldest = this.readCache.keys().next().value;
      if (oldest === undefined) break;
      this.readCache.delete(oldest);
    }
  }
}
