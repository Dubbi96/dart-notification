// backend/src/storage-ops/bytes.spec.ts
// DAR-397: humanBytes 순수·결정론.

import { humanBytes } from './bytes';

describe('humanBytes (DAR-397)', () => {
  it('0/음수/비유한 → 0 B', () => {
    expect(humanBytes(0)).toBe('0 B');
    expect(humanBytes(-100)).toBe('0 B');
    expect(humanBytes(NaN)).toBe('0 B');
    expect(humanBytes(Infinity)).toBe('0 B');
  });

  it('B 단위는 정수(소수 없음)', () => {
    expect(humanBytes(1)).toBe('1 B');
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(1023)).toBe('1023 B');
  });

  it('1024 경계에서 다음 단위로 승급', () => {
    expect(humanBytes(1024)).toBe('1 KB');
    expect(humanBytes(1024 * 1024)).toBe('1 MB');
    expect(humanBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('소수 둘째자리 반올림(예: 1.7GB)', () => {
    expect(humanBytes(1_740_000_000)).toBe('1.62 GB');
    expect(humanBytes(409)).toBe('409 B');
  });

  it('TB/PB 까지 승급', () => {
    expect(humanBytes(1024 ** 4)).toBe('1 TB');
    expect(humanBytes(1024 ** 5)).toBe('1 PB');
    // PB 초과도 PB 로 고정(단위 배열 상한).
    expect(humanBytes(1024 ** 6)).toBe('1024 PB');
  });
});
