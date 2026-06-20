// backend/src/common/storage/s3-object-storage.service.ts
// DAR-395: S3(또는 호환 객체 스토리지) 구현. 네트워크 호출은 S3Backend 인터페이스 뒤로 격리해
//          gzip/키/prefix 로직을 SDK·네트워크 없이 단위 테스트할 수 있게 한다.
//
// 실제 AWS SDK 어댑터(AwsS3Backend)는 s3-backend.ts 에서 lazy-require 로 생성한다 —
// @aws-sdk/client-s3 미설치/자격증명 미설정 시 팩토리가 null 을 반환해 로컬로 폴백한다(비차단).

import { Logger } from '@nestjs/common';
import {
  ObjectStorageDriver,
  ObjectStorageService,
  PutObjectOptions,
} from './object-storage.types';
import { decodeFromStorage, encodeForStorage, isGzipKey } from './gzip-codec';

/**
 * S3 저수준 백엔드 — SDK 네트워크 호출만 담당(gzip/키 정책은 상위 서비스 소유).
 * 테스트는 인메모리 가짜 백엔드를 주입해 put/get 라운드트립을 검증한다.
 */
export interface S3Backend {
  putObject(input: {
    key: string;
    body: Buffer;
    contentType?: string;
    contentEncoding?: string;
  }): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  headObject(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
}

/**
 * S3 객체 스토리지.
 * - prefix: 모든 키 앞에 붙는 버킷 내 경로(예: 'prod/'). 환경 분리/공유 버킷용.
 * - gzip: compress 옵션 시 gzip 인코딩 + ContentEncoding=gzip 메타데이터.
 */
export class S3ObjectStorageService extends ObjectStorageService {
  readonly driver: ObjectStorageDriver = 's3';
  private readonly logger = new Logger(S3ObjectStorageService.name);

  constructor(
    private readonly backend: S3Backend,
    private readonly prefix: string = '',
  ) {
    super();
  }

  /** 백엔드가 주입되어 있으면 구성 완료(팩토리가 자격증명 검증 후에만 생성). */
  isConfigured(): boolean {
    return true;
  }

  async put(
    key: string,
    content: string,
    options: PutObjectOptions = {},
  ): Promise<void> {
    const compress = options.compress ?? false;
    const body = encodeForStorage(content, compress);
    await this.backend.putObject({
      key: this.withPrefix(key),
      body,
      contentType: options.contentType ?? 'text/plain; charset=utf-8',
      contentEncoding: compress ? 'gzip' : undefined,
    });
    this.logger.debug(`S3 객체 저장: ${key} (${body.length}B)`);
  }

  async get(key: string): Promise<string> {
    const bytes = await this.backend.getObject(this.withPrefix(key));
    // 디코딩 판정은 논리 키(prefix 무관) 의 '.gz' 접미사로 한다.
    return decodeFromStorage(bytes, isGzipKey(key) ? key : '');
  }

  async exists(key: string): Promise<boolean> {
    return this.backend.headObject(this.withPrefix(key));
  }

  async delete(key: string): Promise<void> {
    await this.backend.deleteObject(this.withPrefix(key));
  }

  /** 논리 키에 버킷 내 prefix 부착(중복 슬래시 정규화). */
  private withPrefix(key: string): string {
    if (!this.prefix) return key;
    const p = this.prefix.endsWith('/') ? this.prefix : `${this.prefix}/`;
    return `${p}${key}`.replace(/\/{2,}/g, '/');
  }
}
