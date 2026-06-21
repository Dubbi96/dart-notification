// backend/src/common/storage/tables-store.service.spec.ts
// DAR-399: tables 오프로드 스토어 — JSON 직렬화 오프로드/lazy fetch/캐시/graceful 회귀.

import { TablesStoreService } from './tables-store.service';
import { ObjectStorageService } from './object-storage.types';
import { encodeForStorage, decodeFromStorage } from './gzip-codec';

/** 인메모리 객체 스토리지(드라이버 무관 동작 검증) — gzip 라운드트립 포함. */
class FakeStorage extends ObjectStorageService {
  readonly driver = 'local' as const;
  readonly store = new Map<string, Buffer>();
  putCalls = 0;
  getCalls = 0;
  isConfigured(): boolean {
    return true;
  }
  async put(key: string, content: string, options?: { compress?: boolean }): Promise<void> {
    this.putCalls++;
    this.store.set(key, encodeForStorage(content, options?.compress ?? false));
  }
  async get(key: string): Promise<string> {
    this.getCalls++;
    const bytes = this.store.get(key);
    if (!bytes) throw new Error(`not found: ${key}`);
    return decodeFromStorage(bytes, key);
  }
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const SAMPLE_TABLES = [
  { title: '주요 계약', rows: [['항목', '값'], ['계약금액', '1,000,000,000']] },
  { title: '재무', rows: [['매출', '10,000,000,000']] },
];

describe('TablesStoreService (DAR-399)', () => {
  it('keyFor 는 rcpNo 기반 결정적 키(.json.gz)', () => {
    expect(TablesStoreService.keyFor('20250101000001')).toBe(
      'disclosure-tables/20250101000001.json.gz',
    );
  });

  it('offload → load 라운드트립: JSON 구조가 byte-identical 복원된다', async () => {
    const storage = new FakeStorage();
    const store = new TablesStoreService(storage);

    const key = await store.offload('r1', SAMPLE_TABLES);
    expect(key).toBe('disclosure-tables/r1.json.gz');
    expect(storage.putCalls).toBe(1);

    // 컬럼이 비었다고 가정(오프로드 후) → 포인터로 lazy fetch
    const loaded = await store.load({ rcpNo: 'r1', tables: null, tablesS3Key: key });
    expect(loaded).toEqual(SAMPLE_TABLES);
  });

  it('gzip 압축 저장: 평문보다 작은 바이트(콜드 표 용량 절감)', async () => {
    const storage = new FakeStorage();
    const store = new TablesStoreService(storage);
    const big = Array.from({ length: 200 }, (_, i) => ({
      title: `t${i}`,
      rows: [['a', 'b', 'c']],
    }));
    await store.offload('big', big);
    const stored = storage.store.get('disclosure-tables/big.json.gz')!;
    expect(stored.length).toBeLessThan(Buffer.byteLength(JSON.stringify(big), 'utf-8'));
  });

  it('load: 컬럼(tables)이 배열로 남아있으면 그대로 사용(미오프로드분 — fetch 안 함)', async () => {
    const storage = new FakeStorage();
    const store = new TablesStoreService(storage);
    const loaded = await store.load({ rcpNo: 'r2', tables: SAMPLE_TABLES, tablesS3Key: null });
    expect(loaded).toEqual(SAMPLE_TABLES);
    expect(storage.getCalls).toBe(0);
  });

  it('load: 두 번째 조회는 캐시 히트(스토리지 재호출 없음)', async () => {
    const storage = new FakeStorage();
    const store = new TablesStoreService(storage);
    const key = await store.offload('r3', SAMPLE_TABLES);
    storage.store.set(key, storage.store.get(key)!); // 보장
    // offload 가 캐시에 넣으므로 첫 load 도 캐시 히트일 수 있음 → 캐시 비활성 경로 검증 위해 새 스토어
    const store2 = new TablesStoreService(storage);
    await store2.load({ rcpNo: 'r3', tablesS3Key: key });
    const after1 = storage.getCalls;
    await store2.load({ rcpNo: 'r3', tablesS3Key: key });
    expect(storage.getCalls).toBe(after1); // 두 번째는 캐시
  });

  it('load: 컬럼 없음 + 키 없음 → null(graceful)', async () => {
    const store = new TablesStoreService(new FakeStorage());
    expect(await store.load({ rcpNo: 'x' })).toBeNull();
  });

  it('load: fetch 실패 → null(graceful·throw 안 함)', async () => {
    const store = new TablesStoreService(new FakeStorage());
    const loaded = await store.load({ rcpNo: 'missing', tablesS3Key: 'disclosure-tables/missing.json.gz' });
    expect(loaded).toBeNull();
  });
});
