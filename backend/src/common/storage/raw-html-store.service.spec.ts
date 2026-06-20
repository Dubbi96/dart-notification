// backend/src/common/storage/raw-html-store.service.spec.ts
// DAR-401: RawHtmlStore 저장/lazy-load/캐시/graceful 단위 테스트. (raw-text-store.spec 미러)

import {
  LifecycleRule,
  ObjectStorageService,
  ObjectStorageStats,
} from './object-storage.types';
import { RawHtmlStoreService } from './raw-html-store.service';

/** 인메모리 가짜 객체 스토리지(호출 횟수 관측 포함). */
class FakeStorage extends ObjectStorageService {
  readonly driver = 'local' as const;
  readonly map = new Map<string, string>();
  putCalls = 0;
  getCalls = 0;
  isConfigured(): boolean {
    return true;
  }
  async put(key: string, content: string): Promise<void> {
    this.putCalls++;
    this.map.set(key, content);
  }
  async get(key: string): Promise<string> {
    this.getCalls++;
    const v = this.map.get(key);
    if (v === undefined) throw new Error(`missing: ${key}`);
    return v;
  }
  async exists(key: string): Promise<boolean> {
    return this.map.has(key);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async stats(prefix = ''): Promise<ObjectStorageStats> {
    let totalBytes = 0;
    let objectCount = 0;
    for (const [k, v] of this.map) {
      if (k.startsWith(prefix)) {
        objectCount++;
        totalBytes += Buffer.byteLength(v);
      }
    }
    return { prefix, objectCount, totalBytes, available: true };
  }
  async applyLifecycle(_rules: LifecycleRule[]): Promise<boolean> {
    return false;
  }
}

describe('RawHtmlStoreService (DAR-401)', () => {
  let storage: FakeStorage;
  let store: RawHtmlStoreService;

  beforeEach(() => {
    storage = new FakeStorage();
    store = new RawHtmlStoreService(storage);
  });

  it('keyFor 는 rcpNo 기반 안정 키(SSOT) — disclosure-rawhtml/{rcpNo}.html.gz', () => {
    expect(RawHtmlStoreService.keyFor('20260101000001')).toBe(
      'disclosure-rawhtml/20260101000001.html.gz',
    );
  });

  it('save 는 키 반환 + 스토리지에 저장(멱등 덮어쓰기)', async () => {
    const key = await store.save('r1', '<html>본문</html>');
    expect(key).toBe('disclosure-rawhtml/r1.html.gz');
    expect(storage.map.get(key)).toBe('<html>본문</html>');
    // 재저장(같은 키 덮어쓰기) 무해.
    await store.save('r1', '<html>수정</html>');
    expect(storage.map.get(key)).toBe('<html>수정</html>');
  });

  it('load: 포인터로 lazy fetch, 두 번째는 캐시(스토리지 1회)', async () => {
    const key = await store.save('r2', '<html>오프로드</html>');
    // 캐시를 비우기 위해 새 인스턴스(save 시 set 된 캐시 회피).
    store = new RawHtmlStoreService(storage);
    const ref = { rcpNo: 'r2', rawHtmlS3Key: key };
    expect(await store.load(ref)).toBe('<html>오프로드</html>');
    expect(await store.load(ref)).toBe('<html>오프로드</html>');
    expect(storage.getCalls).toBe(1); // 두 번째는 캐시 히트
  });

  it('load: 포인터 없으면 스토리지 조회 없이 null', async () => {
    expect(await store.load({ rcpNo: 'r3' })).toBeNull();
    expect(await store.load({ rcpNo: 'r3', rawHtmlS3Key: null })).toBeNull();
    expect(storage.getCalls).toBe(0);
  });

  it('load: 포인터 fetch 실패는 graceful null', async () => {
    const html = await store.load({
      rcpNo: 'r4',
      rawHtmlS3Key: 'disclosure-rawhtml/does-not-exist.html.gz',
    });
    expect(html).toBeNull();
  });

  it('driver/isConfigured 위임', () => {
    expect(store.driver).toBe('local');
    expect(store.isConfigured()).toBe(true);
  });
});
