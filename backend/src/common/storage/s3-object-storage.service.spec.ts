// backend/src/common/storage/s3-object-storage.service.spec.ts
// DAR-395: S3 객체 스토리지 — 인메모리 가짜 백엔드로 gzip/prefix/라운드트립 검증(네트워크 없음).

import { S3Backend, S3ObjectStorageService } from './s3-object-storage.service';
import { decodeFromStorage } from './gzip-codec';

/** 인메모리 가짜 S3 백엔드 — putObject 가 받은 바이트를 보관. */
class FakeS3Backend implements S3Backend {
  readonly store = new Map<
    string,
    { body: Buffer; contentType?: string; contentEncoding?: string }
  >();

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType?: string;
    contentEncoding?: string;
  }): Promise<void> {
    this.store.set(input.key, {
      body: input.body,
      contentType: input.contentType,
      contentEncoding: input.contentEncoding,
    });
  }
  async getObject(key: string): Promise<Buffer> {
    const v = this.store.get(key);
    if (!v) throw new Error(`NoSuchKey: ${key}`);
    return v.body;
  }
  async headObject(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async deleteObject(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('S3ObjectStorageService (DAR-395)', () => {
  let backend: FakeS3Backend;

  beforeEach(() => {
    backend = new FakeS3Backend();
  });

  it('driver=s3, isConfigured=true', () => {
    const s3 = new S3ObjectStorageService(backend);
    expect(s3.driver).toBe('s3');
    expect(s3.isConfigured()).toBe(true);
  });

  it('gzip put → 백엔드에 gzip 바이트 + ContentEncoding=gzip 저장, get 라운드트립', async () => {
    const s3 = new S3ObjectStorageService(backend);
    const key = 'disclosure-rawtext/r1.txt.gz';
    const content = '공시 원문 데이터';
    await s3.put(key, content, { compress: true });

    const stored = backend.store.get(key)!;
    expect(stored.contentEncoding).toBe('gzip');
    expect(stored.body[0]).toBe(0x1f); // gzip magic
    expect(decodeFromStorage(stored.body, key)).toBe(content);

    expect(await s3.get(key)).toBe(content);
  });

  it('prefix 가 모든 키에 부착되고 get/exists/delete 가 prefix 키를 사용', async () => {
    const s3 = new S3ObjectStorageService(backend, 'prod');
    const key = 'disclosure-rawtext/r2.txt.gz';
    await s3.put(key, 'v', { compress: true });

    // 백엔드에는 prefix 부착된 키로 저장.
    expect(backend.store.has(`prod/${key}`)).toBe(true);
    expect(await s3.exists(key)).toBe(true);
    expect(await s3.get(key)).toBe('v');
    await s3.delete(key);
    expect(await s3.exists(key)).toBe(false);
  });

  it('비압축 put 은 ContentEncoding 미설정', async () => {
    const s3 = new S3ObjectStorageService(backend);
    await s3.put('plain.txt', 'hello', { compress: false });
    expect(backend.store.get('plain.txt')!.contentEncoding).toBeUndefined();
    expect(await s3.get('plain.txt')).toBe('hello');
  });
});
