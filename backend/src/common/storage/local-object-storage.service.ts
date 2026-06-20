// backend/src/common/storage/local-object-storage.service.ts
// DAR-395: 로컬 파일시스템 객체 스토리지(개발 환경 + S3 미구성 시 graceful 폴백).
//
// S3 와 동일한 키 규약을 로컬 디렉터리에 매핑한다 → 코드 경로는 드라이버에 무관하게 동일.
// 핵심: 오프로드 대상이 로컬 파일이어도 Postgres 행(rawText 컬럼) 밖으로 나가므로 DB 는 경량화된다.

import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  ObjectStorageDriver,
  ObjectStorageService,
  PutObjectOptions,
} from './object-storage.types';
import { decodeFromStorage, encodeForStorage } from './gzip-codec';

/**
 * 로컬 파일시스템 구현.
 * 저장 경로: {root}/{key}. 기본 root = OBJECT_STORAGE_LOCAL_PATH || './storage/objects'.
 * 키에 '..' 가 섞여 루트를 탈출하지 못하도록 정규화 가드를 둔다.
 */
export class LocalObjectStorageService extends ObjectStorageService {
  readonly driver: ObjectStorageDriver = 'local';
  private readonly logger = new Logger(LocalObjectStorageService.name);
  private readonly root: string;

  constructor(rootPath: string) {
    super();
    this.root = path.resolve(rootPath);
  }

  /** local 은 항상 사용 가능. */
  isConfigured(): boolean {
    return true;
  }

  async put(
    key: string,
    content: string,
    options: PutObjectOptions = {},
  ): Promise<void> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const bytes = encodeForStorage(content, options.compress ?? false);
    await fs.writeFile(filePath, bytes);
    this.logger.debug(`로컬 객체 저장: ${key} (${bytes.length}B)`);
  }

  async get(key: string): Promise<string> {
    const bytes = await fs.readFile(this.resolveKey(key));
    return decodeFromStorage(bytes, key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch {
      // 없으면 무시(멱등 삭제).
    }
  }

  /** key → 절대경로. 루트 탈출(../) 방지. */
  private resolveKey(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`잘못된 스토리지 키(루트 탈출): ${key}`);
    }
    return resolved;
  }
}
