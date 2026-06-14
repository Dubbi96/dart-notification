import { parseAllowedOrigins, resolveCorsOrigin } from './cors-origin';

describe('cors-origin (DAR-252)', () => {
  describe('parseAllowedOrigins', () => {
    it('undefined/null/빈문자 → 빈 배열', () => {
      expect(parseAllowedOrigins(undefined)).toEqual([]);
      expect(parseAllowedOrigins(null)).toEqual([]);
      expect(parseAllowedOrigins('')).toEqual([]);
      expect(parseAllowedOrigins('   ')).toEqual([]);
    });

    it('콤마구분 파싱 + 공백 trim + 빈 항목 제거', () => {
      expect(
        parseAllowedOrigins(' https://a.com , https://b.com ,, '),
      ).toEqual(['https://a.com', 'https://b.com']);
    });

    it('단일 origin', () => {
      expect(parseAllowedOrigins('https://app.example.com')).toEqual([
        'https://app.example.com',
      ]);
    });
  });

  describe('resolveCorsOrigin', () => {
    it('개발환경(!isProd)은 화이트리스트와 무관하게 true(전체 반영)', () => {
      expect(resolveCorsOrigin(false, undefined)).toBe(true);
      expect(resolveCorsOrigin(false, 'https://a.com')).toBe(true);
    });

    it('운영(isProd) + 화이트리스트 설정 → 배열 반환', () => {
      expect(
        resolveCorsOrigin(true, 'https://a.com,https://b.com'),
      ).toEqual(['https://a.com', 'https://b.com']);
    });

    it('운영(isProd) + 화이트리스트 미설정 → false(cross-origin 전면 차단)', () => {
      expect(resolveCorsOrigin(true, undefined)).toBe(false);
      expect(resolveCorsOrigin(true, '')).toBe(false);
      expect(resolveCorsOrigin(true, '   ,  ')).toBe(false);
    });
  });
});
