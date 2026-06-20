// backend/src/common/storage/storage.module.spec.ts
// DAR-395: 드라이버 선택 팩토리 — 기본 로컬 + S3 미구성 시 graceful 로컬 폴백.

import { ConfigService } from '@nestjs/config';
import { resolveObjectStorage } from './storage.module';
import { LocalObjectStorageService } from './local-object-storage.service';

/** Map 기반 가짜 ConfigService(get(key, default)). */
function fakeConfig(env: Record<string, string>): ConfigService {
  return {
    get: (key: string, def?: unknown) => (key in env ? env[key] : def),
  } as unknown as ConfigService;
}

describe('resolveObjectStorage 팩토리 (DAR-395)', () => {
  it('기본(STORAGE_DRIVER 미설정) → 로컬', () => {
    const storage = resolveObjectStorage(fakeConfig({}));
    expect(storage).toBeInstanceOf(LocalObjectStorageService);
    expect(storage.driver).toBe('local');
  });

  it('STORAGE_DRIVER=local → 로컬', () => {
    const storage = resolveObjectStorage(
      fakeConfig({ STORAGE_DRIVER: 'local' }),
    );
    expect(storage.driver).toBe('local');
  });

  it('STORAGE_DRIVER=s3 이나 버킷/자격증명 미구성 → 로컬 폴백(비차단)', () => {
    const storage = resolveObjectStorage(fakeConfig({ STORAGE_DRIVER: 's3' }));
    // SDK·구성 부재 → graceful 로컬 폴백.
    expect(storage.driver).toBe('local');
  });

  it('STORAGE_DRIVER=s3 + 구성 충족이나 SDK 미설치 → 로컬 폴백(현 환경)', () => {
    const storage = resolveObjectStorage(
      fakeConfig({
        STORAGE_DRIVER: 's3',
        AWS_REGION: 'ap-northeast-2',
        S3_BUCKET: 'my-bucket',
        AWS_ACCESS_KEY_ID: 'k',
        AWS_SECRET_ACCESS_KEY: 's',
      }),
    );
    // @aws-sdk/client-s3 미설치 환경 → 로컬 폴백. 설치 환경이면 s3 가 되며 그 역시 정상.
    expect(['local', 's3']).toContain(storage.driver);
  });
});
