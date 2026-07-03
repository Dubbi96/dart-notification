// backend/src/common/storage/etf-daily-raw-store.service.spec.ts
// DAR-490: EtfDailyRawStore 저장(gzip·결정적 키)·round-trip·graceful throw 단위 테스트. (raw-html-store.spec 미러)

import {
  LifecycleRule,
  ObjectStorageService,
  ObjectStorageStats,
  PutObjectOptions,
} from './object-storage.types';
import { decodeFromStorage, encodeForStorage } from './gzip-codec';
import { EtfDailyRawStoreService } from './etf-daily-raw-store.service';

/** 인메모리 가짜 객체 스토리지(put 옵션·gzip 실제 인코딩 관측 포함). */
class FakeStorage extends ObjectStorageService {
  readonly driver = 'local' as const;
  readonly bytes = new Map<string, Buffer>();
  readonly opts = new Map<string, PutObjectOptions | undefined>();
  putCalls = 0;
  isConfigured(): boolean {
    return true;
  }
  async put(key: string, content: string, options?: PutObjectOptions): Promise<void> {
    this.putCalls++;
    this.opts.set(key, options);
    this.bytes.set(key, encodeForStorage(content, options?.compress ?? false));
  }
  async get(key: string): Promise<string> {
    const b = this.bytes.get(key);
    if (b === undefined) throw new Error(`missing: ${key}`);
    return decodeFromStorage(b, key);
  }
  async exists(key: string): Promise<boolean> {
    return this.bytes.has(key);
  }
  async delete(key: string): Promise<void> {
    this.bytes.delete(key);
  }
  async stats(prefix = ''): Promise<ObjectStorageStats> {
    return { prefix, objectCount: this.bytes.size, totalBytes: 0, available: true };
  }
  async applyLifecycle(_rules: LifecycleRule[]): Promise<boolean> {
    return false;
  }
}

describe('EtfDailyRawStoreService (DAR-490)', () => {
  it('keyFor — 결정적 키 규약 etf-daily-raw/{code}/{start}-{end}.json.gz', () => {
    expect(EtfDailyRawStoreService.keyFor('069500', '20200101', '20200410')).toBe(
      'etf-daily-raw/069500/20200101-20200410.json.gz',
    );
  });

  it('save — gzip 압축·application/json 콘텐츠타입으로 put, 반환 키 = keyFor', async () => {
    const storage = new FakeStorage();
    const store = new EtfDailyRawStoreService(storage);
    const raw = { output2: [{ stck_bsop_date: '20200102', stck_clpr: '10000' }] };

    const key = await store.save('069500', '20200101', '20200410', raw);

    expect(key).toBe('etf-daily-raw/069500/20200101-20200410.json.gz');
    expect(storage.putCalls).toBe(1);
    expect(storage.opts.get(key)).toEqual({
      compress: true,
      contentType: 'application/json; charset=utf-8',
    });
  });

  it('save round-trip — 저장한 원본 JSON 을 그대로 복원(gunzip)', async () => {
    const storage = new FakeStorage();
    const store = new EtfDailyRawStoreService(storage);
    const raw = { rt_cd: '0', output2: [{ stck_bsop_date: '20200102', stck_clpr: '9,900' }] };

    const key = await store.save('360750', '20200101', '20200410', raw);
    const restored = JSON.parse(await storage.get(key));

    expect(restored).toEqual(raw);
  });

  it('멱등 — 동일 구간 재저장은 같은 키 덮어쓰기', async () => {
    const storage = new FakeStorage();
    const store = new EtfDailyRawStoreService(storage);

    const k1 = await store.save('069500', '20200101', '20200410', { v: 1 });
    const k2 = await store.save('069500', '20200101', '20200410', { v: 2 });

    expect(k1).toBe(k2);
    expect(JSON.parse(await storage.get(k1))).toEqual({ v: 2 });
  });

  it('put 실패는 throw(호출측이 best-effort 흡수)', async () => {
    const storage = new FakeStorage();
    jest.spyOn(storage, 'put').mockRejectedValueOnce(new Error('S3 down'));
    const store = new EtfDailyRawStoreService(storage);

    await expect(store.save('069500', '20200101', '20200410', {})).rejects.toThrow('S3 down');
  });

  it('driver/isConfigured 위임 관측', () => {
    const storage = new FakeStorage();
    const store = new EtfDailyRawStoreService(storage);
    expect(store.driver).toBe('local');
    expect(store.isConfigured()).toBe(true);
  });
});
