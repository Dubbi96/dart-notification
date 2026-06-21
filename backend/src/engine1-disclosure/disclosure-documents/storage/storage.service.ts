// backend/src/disclosure-documents/storage/storage.service.ts
// StorageService 추상화 인터페이스 + LocalStorageService 구현 (M1)
//
// @deprecated DAR-401: 공시 원본 HTML 저장이 S3/객체 스토리지(common/storage RawHtmlStoreService,
//   키 disclosure-rawhtml/{rcpNo}.html.gz)로 고정되면서 이 로컬 디스크 저장/조회 경로(storage/{rcpNo}/
//   index.html)는 더 이상 파이프라인에서 사용되지 않는다. provider 등록도 해제됨(disclosure-documents.module).
//   신규 코드는 LocalStorageService.read/exists/save 에 의존하지 말 것 — RawHtmlStoreService.load() 사용.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 스토리지 추상화 인터페이스
 * STORAGE_DRIVER=local → LocalStorageService
 * STORAGE_DRIVER=s3    → S3StorageService (후속 M에서 구현)
 */
export abstract class StorageService {
  /** 파일 저장. returns 저장 경로(key) */
  abstract save(
    rcpNo: string,
    filename: string,
    content: string,
  ): Promise<string>;

  abstract read(filePath: string): Promise<string>;
  abstract exists(filePath: string): Promise<boolean>;
}

/**
 * 로컬 파일시스템 기반 구현 (개발 환경)
 * 저장 경로: {LOCAL_STORAGE_PATH}/{rcpNo}/{filename}
 * 기본값: ./storage/{rcpNo}/{filename}
 */
@Injectable()
export class LocalStorageService extends StorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly rootPath: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.rootPath = this.configService.get<string>(
      'LOCAL_STORAGE_PATH',
      './storage',
    );
  }

  async save(rcpNo: string, filename: string, content: string): Promise<string> {
    const dirPath = path.join(this.rootPath, rcpNo);
    const filePath = path.join(dirPath, filename);

    try {
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      this.logger.debug(`저장 완료: ${filePath}`);
    } catch (error) {
      this.logger.warn(
        `로컬 저장 실패 (${filePath}): ${(error as Error).message}`,
      );
    }

    return filePath;
  }

  async read(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    return fs.existsSync(filePath);
  }
}
