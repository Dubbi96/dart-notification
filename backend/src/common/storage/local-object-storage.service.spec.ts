// backend/src/common/storage/local-object-storage.service.spec.ts
// DAR-395: 로컬 객체 스토리지 put/get/exists/delete 라운드트립 + 루트 탈출 가드.

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalObjectStorageService } from './local-object-storage.service';

describe('LocalObjectStorageService (DAR-395)', () => {
  let root: string;
  let storage: LocalObjectStorageService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dar395-local-'));
    storage = new LocalObjectStorageService(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('driver=local, 항상 isConfigured=true', () => {
    expect(storage.driver).toBe('local');
    expect(storage.isConfigured()).toBe(true);
  });

  it('gzip put → get 라운드트립(.gz 키 자동 해제)', async () => {
    const key = 'disclosure-rawtext/20260101000001.txt.gz';
    const content = '원문 콜드 데이터 — DB 밖 오프로드';
    await storage.put(key, content, { compress: true });

    // 실제 파일은 gzip 바이트(원문보다 magic 헤더 보유).
    const onDisk = await fs.readFile(path.join(root, key));
    expect(onDisk[0]).toBe(0x1f);
    expect(onDisk[1]).toBe(0x8b);

    expect(await storage.get(key)).toBe(content);
  });

  it('비압축 put → get 라운드트립', async () => {
    const key = 'plain/a.txt';
    await storage.put(key, 'hello', { compress: false });
    expect(await storage.get(key)).toBe('hello');
  });

  it('exists/delete 동작(멱등 삭제)', async () => {
    const key = 'd/x.txt.gz';
    expect(await storage.exists(key)).toBe(false);
    await storage.put(key, 'v', { compress: true });
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    // 없는 키 재삭제도 throw 하지 않음.
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('루트 탈출(../) 키는 거부한다', async () => {
    await expect(
      storage.put('../escape.txt', 'x', { compress: false }),
    ).rejects.toThrow(/루트 탈출/);
  });

  // ─── DAR-397: 용량 통계 + 라이프사이클(no-op) ──────────────────────────────

  it('stats: prefix 하위 객체수/바이트 재귀 합산', async () => {
    await storage.put('disclosure-rawtext/a.txt.gz', 'aaa', { compress: false });
    await storage.put('disclosure-rawtext/sub/b.txt.gz', 'bbbbb', {
      compress: false,
    });
    await storage.put('other/c.txt', 'zzzz', { compress: false });

    const st = await storage.stats('disclosure-rawtext/');
    expect(st.prefix).toBe('disclosure-rawtext/');
    expect(st.objectCount).toBe(2);
    expect(st.totalBytes).toBe(
      Buffer.byteLength('aaa') + Buffer.byteLength('bbbbb'),
    );
    expect(st.available).toBe(true);

    // 전체(prefix 미지정) 는 3건.
    const all = await storage.stats();
    expect(all.objectCount).toBe(3);
  });

  it('stats: 디렉터리 부재 prefix 는 빈 통계(graceful)', async () => {
    const st = await storage.stats('nonexistent/');
    expect(st).toEqual({
      prefix: 'nonexistent/',
      objectCount: 0,
      totalBytes: 0,
      available: true,
    });
  });

  it('applyLifecycle: 로컬은 미지원(no-op) → false', async () => {
    expect(await storage.applyLifecycle([])).toBe(false);
  });
});
