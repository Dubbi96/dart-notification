// backend/src/common/storage/raw-html-store.service.ts
// DAR-401: 공시 원본 HTML(fetch 시점의 index.html 원문) 저장 스토어 — 쓰기(저장)·읽기(lazy fetch)
//          의 단일 출처. engine1(파싱 파이프라인 fetch 단계)이 소유한다. 기존 로컬 디스크
//          저장(LocalStorageService — storage/{rcpNo}/index.html, 23GB 누적·런타임 미사용)을
//          S3/객체 스토리지로 고정한다. rawText(DAR-395)/tables(DAR-399) 오프로드와 동일 설계.
//
// 키 규약: disclosure-rawhtml/{rcpNo}.html.gz (gzip 압축). DB 는 rawHtmlS3Key 포인터만 보유.

import { Injectable, Logger } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.types';

/** load() 입력 — 저장된 포인터(rawHtmlS3Key)로 원본 HTML 을 lazy fetch. */
export interface RawHtmlRef {
  rcpNo: string;
  rawHtmlS3Key?: string | null;
}

/** 읽기 캐시 상한(콜드 원본 HTML — 재파싱 배치 중 동일 rcpNo 반복조회 흡수). 원본 HTML 은
 *  rawText/표보다 크므로(태그 포함 전문) 캐시를 작게 둔다. */
const READ_CACHE_MAX = 32;

@Injectable()
export class RawHtmlStoreService {
  private readonly logger = new Logger(RawHtmlStoreService.name);
  /** 단순 LRU 근사(삽입순 Map, 초과 시 가장 오래된 항목 제거). */
  private readonly readCache = new Map<string, string>();

  constructor(private readonly storage: ObjectStorageService) {}

  /** rcpNo → 객체 키(SSOT). 정적이라 다른 모듈/데이터 마이그레이션도 키를 재현할 수 있다. */
  static keyFor(rcpNo: string): string {
    return `disclosure-rawhtml/${rcpNo}.html.gz`;
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
   * 원본 HTML 저장(gzip 업로드). 반환 키를 DB rawHtmlS3Key 에 저장한다(로컬 디스크 write 없음).
   * 멱등: 동일 rcpNo 재저장은 같은 키 덮어쓰기. 실패 시 throw(호출측이 graceful 처리 결정).
   */
  async save(rcpNo: string, html: string): Promise<string> {
    const key = RawHtmlStoreService.keyFor(rcpNo);
    await this.storage.put(key, html, {
      compress: true,
      contentType: 'text/html; charset=utf-8',
    });
    this.readCache.set(key, html);
    this.trimCache();
    return key;
  }

  /**
   * 원본 HTML 조회(읽기 경로 — 재파싱 등). 포인터(rawHtmlS3Key)로 lazy fetch.
   * 포인터가 없거나 fetch 실패면 null(graceful — 호출측이 빈 입력으로 진행).
   */
  async load(ref: RawHtmlRef): Promise<string | null> {
    const key = ref.rawHtmlS3Key;
    if (!key) {
      return null;
    }
    const cached = this.readCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const html = await this.storage.get(key);
      this.readCache.set(key, html);
      this.trimCache();
      return html;
    } catch (err) {
      this.logger.warn(
        `원본 HTML lazy fetch 실패: rcpNo=${ref.rcpNo} key=${key}: ${(err as Error).message}`,
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
