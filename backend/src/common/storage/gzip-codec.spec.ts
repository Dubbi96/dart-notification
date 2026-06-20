// backend/src/common/storage/gzip-codec.spec.ts
// DAR-395: gzip 코덱 라운드트립·키 판정 단위 테스트.

import { gunzipSync } from 'zlib';
import {
  decodeFromStorage,
  encodeForStorage,
  isGzipKey,
} from './gzip-codec';

describe('gzip-codec (DAR-395)', () => {
  const sample = '삼성전자 유상증자 결정 공시 원문 — rawText 콜드 데이터 12345';

  describe('isGzipKey', () => {
    it('.gz 로 끝나면 true', () => {
      expect(isGzipKey('disclosure-rawtext/123.txt.gz')).toBe(true);
    });
    it('.gz 가 아니면 false', () => {
      expect(isGzipKey('disclosure-rawtext/123.txt')).toBe(false);
      expect(isGzipKey('')).toBe(false);
    });
  });

  describe('encode/decode 라운드트립', () => {
    it('compress=true: gzip 인코딩 후 .gz 키로 해제하면 원문 복원', () => {
      const bytes = encodeForStorage(sample, true);
      // 실제 gzip 바이트인지 확인(magic 0x1f 0x8b).
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
      expect(gunzipSync(bytes).toString('utf-8')).toBe(sample);
      expect(decodeFromStorage(bytes, 'x.txt.gz')).toBe(sample);
    });

    it('compress=false: 평문 바이트, 비-gz 키로 그대로 복원', () => {
      const bytes = encodeForStorage(sample, false);
      expect(bytes.toString('utf-8')).toBe(sample);
      expect(decodeFromStorage(bytes, 'x.txt')).toBe(sample);
    });

    it('빈 문자열도 라운드트립', () => {
      const bytes = encodeForStorage('', true);
      expect(decodeFromStorage(bytes, 'x.gz')).toBe('');
    });

    it('압축은 큰 반복 텍스트에서 원문보다 작다', () => {
      const big = 'A'.repeat(100_000);
      const gz = encodeForStorage(big, true);
      expect(gz.length).toBeLessThan(big.length);
    });
  });
});
