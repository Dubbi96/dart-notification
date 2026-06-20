// backend/src/common/storage/raw-text-store.service.spec.ts
// DAR-395: RawTextStore 오프로드/lazy-load/캐시/컬럼 우선 폴백 단위 테스트.

import { ObjectStorageService } from './object-storage.types';
import { RawTextStoreService } from './raw-text-store.service';

/** 인메모리 가짜 객체 스토리지(호출 횟수 관측 포함). */
class FakeStorage extends ObjectStorageService {
  readonly driver = 'local' as const;
  readonly map = new Map<string, string>();
  getCalls = 0;
  isConfigured(): boolean {
    return true;
  }
  async put(key: string, content: string): Promise<void> {
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
}

describe('RawTextStoreService (DAR-395)', () => {
  let storage: FakeStorage;
  let store: RawTextStoreService;

  beforeEach(() => {
    storage = new FakeStorage();
    store = new RawTextStoreService(storage);
  });

  it('keyFor 는 rcpNo 기반 안정 키(SSOT)', () => {
    expect(RawTextStoreService.keyFor('20260101000001')).toBe(
      'disclosure-rawtext/20260101000001.txt.gz',
    );
  });

  it('offload 는 키 반환 + 스토리지에 저장(멱등 덮어쓰기)', async () => {
    const key = await store.offload('r1', '원문');
    expect(key).toBe('disclosure-rawtext/r1.txt.gz');
    expect(storage.map.get(key)).toBe('원문');
    // 재오프로드(같은 키 덮어쓰기) 무해.
    await store.offload('r1', '원문수정');
    expect(storage.map.get(key)).toBe('원문수정');
  });

  it('load: rawText 컬럼이 남아있으면 스토리지 조회 없이 그대로(미오프로드분)', async () => {
    const text = await store.load({ rcpNo: 'r1', rawText: '컬럼원문' });
    expect(text).toBe('컬럼원문');
    expect(storage.getCalls).toBe(0);
  });

  it('load: 컬럼 비고 포인터 있으면 lazy fetch, 두 번째는 캐시(스토리지 1회)', async () => {
    const key = await store.offload('r2', '오프로드원문');
    // 캐시를 비우기 위해 새 인스턴스(오프로드 시 set 된 캐시 회피).
    store = new RawTextStoreService(storage);
    const ref = { rcpNo: 'r2', rawText: null, rawTextS3Key: key };
    expect(await store.load(ref)).toBe('오프로드원문');
    expect(await store.load(ref)).toBe('오프로드원문');
    expect(storage.getCalls).toBe(1); // 두 번째는 캐시 히트
  });

  it('load: 컬럼도 포인터도 없으면 null', async () => {
    expect(await store.load({ rcpNo: 'r3' })).toBeNull();
  });

  it('load: 포인터 fetch 실패는 graceful null', async () => {
    const text = await store.load({
      rcpNo: 'r4',
      rawText: null,
      rawTextS3Key: 'disclosure-rawtext/does-not-exist.txt.gz',
    });
    expect(text).toBeNull();
  });

  it('driver/isConfigured 위임', () => {
    expect(store.driver).toBe('local');
    expect(store.isConfigured()).toBe(true);
  });
});
