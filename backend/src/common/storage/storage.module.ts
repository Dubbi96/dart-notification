// backend/src/common/storage/storage.module.ts
// DAR-395: 객체 스토리지 전역 모듈 — ObjectStorageService(드라이버 선택 팩토리) + 콜드 데이터 스토어
//   (RawTextStoreService·TablesStoreService·RawHtmlStoreService[DAR-401]).
//
// @Global: engine1(파싱/드레인 오프로드)·engine2(AI excerpt 조회)가 import 없이 주입받는다.
// 드라이버 선택: STORAGE_DRIVER=s3 이고 S3 구성+SDK 가용 시 S3, 아니면 로컬(graceful 폴백·비차단).

import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from './object-storage.types';
import { LocalObjectStorageService } from './local-object-storage.service';
import { S3ObjectStorageService } from './s3-object-storage.service';
import { createAwsS3Backend, S3Config } from './s3-backend';
import { RawTextStoreService } from './raw-text-store.service';
import { TablesStoreService } from './tables-store.service';
import { RawHtmlStoreService } from './raw-html-store.service';
import { EtfDailyRawStoreService } from './etf-daily-raw-store.service';

/**
 * env → ObjectStorageService 인스턴스 해석.
 * S3 선택이지만 미구성/SDK 부재면 경고 후 로컬로 폴백(기능 비차단 — 자격증명만 후속 주입).
 */
export function resolveObjectStorage(
  config: ConfigService,
): ObjectStorageService {
  const logger = new Logger('StorageModule');
  const driver = config.get<string>('STORAGE_DRIVER', 'local');
  const localPath = config.get<string>(
    'OBJECT_STORAGE_LOCAL_PATH',
    config.get<string>('LOCAL_STORAGE_PATH', './storage') + '/objects',
  );

  if (driver === 's3') {
    const s3cfg: Partial<S3Config> = {
      region: config.get<string>('AWS_REGION'),
      bucket: config.get<string>('S3_BUCKET'),
      accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY'),
      endpoint: config.get<string>('S3_ENDPOINT'),
      prefix: config.get<string>('S3_PREFIX'),
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
    };
    const backend = createAwsS3Backend(s3cfg);
    if (backend) {
      logger.log(
        `객체 스토리지: S3 (bucket=${s3cfg.bucket}, region=${s3cfg.region}, prefix=${s3cfg.prefix ?? ''})`,
      );
      return new S3ObjectStorageService(backend, s3cfg.prefix ?? '');
    }
    logger.warn(
      'STORAGE_DRIVER=s3 이나 버킷/자격증명 미구성 또는 SDK 부재 → 로컬 폴백(기능 비차단).',
    );
  }

  logger.log(`객체 스토리지: 로컬 (path=${localPath})`);
  return new LocalObjectStorageService(localPath);
}

@Global()
@Module({
  providers: [
    {
      provide: ObjectStorageService,
      inject: [ConfigService],
      useFactory: resolveObjectStorage,
    },
    RawTextStoreService,
    TablesStoreService,
    RawHtmlStoreService,
    // DAR-490: ETF 과거 일봉 백필의 KIS 원본 응답(JSON) 콜드 보관 스토어.
    EtfDailyRawStoreService,
  ],
  exports: [
    ObjectStorageService,
    RawTextStoreService,
    TablesStoreService,
    RawHtmlStoreService,
    EtfDailyRawStoreService,
  ],
})
export class StorageModule {}
