// backend/src/common/storage/raw-text-store.service.ts
// DAR-395: 공시 원문(DisclosureDocument.rawText) 오프로드 스토어 — 쓰기(오프로드)·읽기(lazy fetch)
//          의 단일 출처. engine1(파싱 완료/마이그레이션 드레인)·engine2(AI excerpt 조회)가 공유한다.
//
// 키 규약: disclosure-rawtext/{rcpNo}.txt.gz (gzip 압축). DB 는 rawTextS3Key 포인터만 보유.

import { Injectable, Logger } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.types';

/** load() 입력 — 컬럼(rawText)이 남아있으면 우선, 없으면 포인터(rawTextS3Key) lazy fetch. */
export interface RawTextRef {
  rcpNo: string;
  rawText?: string | null;
  rawTextS3Key?: string | null;
}

/** 읽기 캐시 상한(콜드 원문 — 재추출 배치 중 동일 rcpNo 반복조회 흡수). */
const READ_CACHE_MAX = 256;

@Injectable()
export class RawTextStoreService {
  private readonly logger = new Logger(RawTextStoreService.name);
  /** 단순 LRU 근사(삽입순 Map, 초과 시 가장 오래된 항목 제거). */
  private readonly readCache = new Map<string, string>();

  constructor(private readonly storage: ObjectStorageService) {}

  /** rcpNo → 객체 키(SSOT). 정적이라 다른 모듈도 키를 재현할 수 있다. */
  static keyFor(rcpNo: string): string {
    return `disclosure-rawtext/${rcpNo}.txt.gz`;
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
   * 원문 오프로드(gzip 업로드). 반환 키를 DB rawTextS3Key 에 저장하고 rawText 컬럼은 비운다.
   * 멱등: 동일 rcpNo 재오프로드는 같은 키 덮어쓰기. 실패 시 throw(호출측이 DB rawText 보존 결정).
   */
  async offload(rcpNo: string, rawText: string): Promise<string> {
    const key = RawTextStoreService.keyFor(rcpNo);
    await this.storage.put(key, rawText, {
      compress: true,
      contentType: 'text/plain; charset=utf-8',
    });
    this.readCache.set(key, rawText);
    this.trimCache();
    return key;
  }

  /**
   * 원문 조회(읽기 경로). rawText 컬럼이 남아있으면 그대로(미오프로드분), 아니면 포인터로 lazy fetch.
   * 둘 다 없거나 fetch 실패면 null(graceful — 호출측이 빈 입력으로 진행).
   */
  async load(ref: RawTextRef): Promise<string | null> {
    if (ref.rawText != null && ref.rawText !== '') {
      return ref.rawText;
    }
    const key = ref.rawTextS3Key;
    if (!key) {
      return null;
    }
    const cached = this.readCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const text = await this.storage.get(key);
      this.readCache.set(key, text);
      this.trimCache();
      return text;
    } catch (err) {
      this.logger.warn(
        `원문 lazy fetch 실패: rcpNo=${ref.rcpNo} key=${key}: ${(err as Error).message}`,
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
