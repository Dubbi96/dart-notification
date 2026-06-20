// backend/src/common/storage/s3-object-storage.service.spec.ts
// DAR-395: S3 객체 스토리지 — 인메모리 가짜 백엔드로 gzip/prefix/라운드트립 검증(네트워크 없음).

import { S3Backend, S3ObjectStorageService } from './s3-object-storage.service';
import { decodeFromStorage } from './gzip-codec';
import { LifecycleRule } from './object-storage.types';

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
  lifecycleRules: LifecycleRule[] | null = null;
  async listObjects(
    prefix: string,
  ): Promise<{ count: number; totalBytes: number }> {
    let count = 0;
    let totalBytes = 0;
    for (const [k, v] of this.store) {
      if (k.startsWith(prefix)) {
        count++;
        totalBytes += v.body.length;
      }
    }
    return { count, totalBytes };
  }
  async putLifecycleConfiguration(rules: LifecycleRule[]): Promise<void> {
    this.lifecycleRules = rules;
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

  // ─── DAR-397: 용량 통계 + 콜드 라이프사이클 ────────────────────────────────

  it('stats: prefix 부착 후 backend.listObjects 합산', async () => {
    const s3 = new S3ObjectStorageService(backend, 'prod');
    await s3.put('disclosure-rawtext/a.txt.gz', 'aa', { compress: false });
    await s3.put('disclosure-rawtext/b.txt.gz', 'bbbb', { compress: false });

    const st = await s3.stats('disclosure-rawtext/');
    expect(st.objectCount).toBe(2);
    expect(st.available).toBe(true);
    expect(st.totalBytes).toBeGreaterThan(0);
  });

  it('stats: backend list 실패 시 available=false graceful', async () => {
    jest
      .spyOn(backend, 'listObjects')
      .mockRejectedValueOnce(new Error('AccessDenied'));
    const s3 = new S3ObjectStorageService(backend);
    const st = await s3.stats('disclosure-rawtext/');
    expect(st).toEqual({
      prefix: 'disclosure-rawtext/',
      objectCount: 0,
      totalBytes: 0,
      available: false,
    });
  });

  it('applyLifecycle: 규칙 prefix 에 버킷 prefix 부착 후 적용 → true', async () => {
    const s3 = new S3ObjectStorageService(backend, 'prod');
    const ok = await s3.applyLifecycle([
      {
        id: 'r',
        prefix: 'disclosure-rawtext/',
        transitions: [{ storageClass: 'GLACIER', days: 90 }],
      },
    ]);
    expect(ok).toBe(true);
    expect(backend.lifecycleRules).toEqual([
      {
        id: 'r',
        prefix: 'prod/disclosure-rawtext/',
        transitions: [{ storageClass: 'GLACIER', days: 90 }],
      },
    ]);
  });
});
